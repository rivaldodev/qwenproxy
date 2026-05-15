import { Context } from 'hono';
import { stream as honoStream } from 'hono/streaming';
import { v4 as uuidv4 } from 'uuid';
import { createQwenStream } from '../services/qwen.ts';

type ResponseInputPart = {
  type?: string;
  text?: string;
  content?: string;
};

type ResponseInputMessage = {
  role?: string;
  content?: string | ResponseInputPart[] | Array<{ type?: string; text?: string }>;
};

function contentToText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((part: any) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.content === 'string') return part.content;
      return JSON.stringify(part);
    }).join('\n');
  }

  if (content && typeof content === 'object') {
    return JSON.stringify(content);
  }

  return '';
}

function inputToPrompt(input: unknown, instructions?: string): string {
  const sections: string[] = [];

  if (instructions && instructions.trim()) {
    sections.push(`System: ${instructions.trim()}`);
  }

  if (typeof input === 'string') {
    sections.push(`User: ${input}`);
  } else if (Array.isArray(input)) {
    for (const item of input as ResponseInputMessage[]) {
      const role = item.role || 'user';
      sections.push(`${role[0]?.toUpperCase() || 'U'}${role.slice(1)}: ${contentToText(item.content)}`);
    }
  } else if (input) {
    sections.push(`User: ${contentToText(input)}`);
  }

  return sections.join('\n\n').trim() + '\n\n';
}

function extractTextFromQwenChunk(
  chunk: any,
  state: { lastFullContent: string; currentThoughtIndex: number }
): string {
  if (!chunk.choices?.[0]?.delta) {
    return '';
  }

  const delta = chunk.choices[0].delta;
  if (delta.phase === 'answer' && delta.content !== undefined) {
    const nextContent = delta.content || '';
    if (!state.lastFullContent) {
      state.lastFullContent = nextContent;
      return nextContent === 'FINISHED' ? '' : nextContent;
    }

    if (nextContent === state.lastFullContent) {
      return '';
    }

    const text = nextContent.startsWith(state.lastFullContent)
      ? nextContent.slice(state.lastFullContent.length)
      : nextContent;
    state.lastFullContent += text;
    return text === 'FINISHED' ? '' : text;
  }

  return '';
}

function responsePayload(id: string, model: string, text: string, usage: any) {
  const createdAt = Math.floor(Date.now() / 1000);
  return {
    id,
    object: 'response',
    created_at: createdAt,
    status: 'completed',
    model,
    output: [{
      id: `msg_${uuidv4()}`,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text,
        annotations: []
      }]
    }],
    output_text: text,
    usage
  };
}

export async function responses(c: Context) {
  try {
    const body = await c.req.json();
    const model = body.model || 'qwen3.6-plus';
    const isStream = body.stream ?? false;
    const prompt = inputToPrompt(body.input, body.instructions);
    const enableThinking = !model.includes('no-thinking');
    const result = await createQwenStream(prompt, enableThinking, model, null);
    const responseId = `resp_${uuidv4()}`;

    if (isStream) {
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');

      return honoStream(c, async (streamWriter: any) => {
        const writeEvent = async (event: string, data: any) => {
          await streamWriter.write(`event: ${event}\n`);
          await streamWriter.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        await writeEvent('response.created', {
          id: responseId,
          object: 'response',
          created_at: Math.floor(Date.now() / 1000),
          status: 'in_progress',
          model
        });

        const reader = result.stream.getReader();
        const decoder = new TextDecoder();
        const state = { lastFullContent: '', currentThoughtIndex: 0 };
        let buffer = '';
        let outputText = '';
        let inputTokens = Math.ceil(prompt.length / 3.5);
        let outputTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') continue;

            try {
              const chunk = JSON.parse(dataStr);
              if (chunk.usage) {
                if (chunk.usage.input_tokens) inputTokens = chunk.usage.input_tokens;
                if (chunk.usage.output_tokens) outputTokens = chunk.usage.output_tokens;
              }

              const text = extractTextFromQwenChunk(chunk, state);
              if (text) {
                outputText += text;
                await writeEvent('response.output_text.delta', {
                  response_id: responseId,
                  output_index: 0,
                  content_index: 0,
                  delta: text
                });
              }
            } catch {
              // Ignore partial chunks.
            }
          }
        }

        const usage = {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens
        };

        await writeEvent('response.completed', responsePayload(responseId, model, outputText, usage));
        await streamWriter.write('data: [DONE]\n\n');
      });
    }

    const reader = result.stream.getReader();
    const decoder = new TextDecoder();
    const state = { lastFullContent: '', currentThoughtIndex: 0 };
    let buffer = '';
    let outputText = '';
    let inputTokens = Math.ceil(prompt.length / 3.5);
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') continue;

        try {
          const chunk = JSON.parse(dataStr);
          if (chunk.usage) {
            if (chunk.usage.input_tokens) inputTokens = chunk.usage.input_tokens;
            if (chunk.usage.output_tokens) outputTokens = chunk.usage.output_tokens;
          }
          outputText += extractTextFromQwenChunk(chunk, state);
        } catch {
          // Ignore partial chunks.
        }
      }
    }

    return c.json(responsePayload(responseId, model, outputText, {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }));
  } catch (error: any) {
    console.error('Error in responses:', error);
    return c.json({
      error: {
        message: error?.message || 'Failed to create response',
        type: 'server_error',
        code: 'response_failed'
      }
    }, 500);
  }
}
