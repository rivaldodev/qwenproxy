import { Context } from 'hono';
import { stream as honoStream } from 'hono/streaming';
import { v4 as uuidv4 } from 'uuid';
import { createQwenStream } from '../services/qwen.ts';
import { registry } from '../tools/registry.ts';
import { executeToolCalls } from '../tools/executor.ts';
import { StreamingToolParser } from '../tools/parser.ts';
import { normalizePromptTools, toolCallToTag, type PromptToolDefinition } from '../tools/format.ts';
import { robustParseJSON } from '../utils/json.ts';
import type { ParsedToolCall, ToolCallResult } from '../tools/types.ts';

type ResponseInputPart = {
  type?: string;
  text?: string;
  content?: string;
};

type ResponseInputMessage = {
  role?: string;
  content?: string | ResponseInputPart[] | Array<{ type?: string; text?: string }>;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
};

type QwenCompletion = {
  content: string;
  toolCalls: ParsedToolCall[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
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

function inputToMessages(input: unknown, instructions?: string): ResponseInputMessage[] {
  const messages: ResponseInputMessage[] = [];

  if (instructions && instructions.trim()) {
    messages.push({ role: 'system', content: instructions.trim() });
  }

  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const item of input as ResponseInputMessage[]) {
      messages.push({ ...item, role: item.role || 'user' });
    }
  } else if (input) {
    messages.push({ role: 'user', content: contentToText(input) });
  }

  return messages;
}

function toolsInstructions(tools: PromptToolDefinition[]): string {
  if (tools.length === 0) return '';

  return `# TOOLS AVAILABLE
You have access to the following tools:
${JSON.stringify(tools, null, 2)}

# TOOL CALLING FORMAT (MANDATORY)
To use a tool, output JSON wrapped exactly in these tags:
<tool_call>
{"name": "tool_name", "arguments": {"param_name": "value"}}
</tool_call>

RULES:
1. Use JSON only inside <tool_call> blocks.
2. If you need a tool, output only <tool_call> blocks and wait for tool results.
3. After tool results are provided, write the final answer as normal user-facing text, not as JSON.
4. Do not prefix the final answer with SEARCHING, JSON, or status labels.
`;
}

function messagesToPrompt(messages: ResponseInputMessage[], tools: PromptToolDefinition[]): string {
  const sections: string[] = [];
  const toolText = toolsInstructions(tools);

  if (toolText) {
    sections.push(toolText);
  }

  for (const message of messages) {
    const role = message.role || 'user';
    const content = contentToText(message.content);

    if (role === 'system') {
      sections.push(`System: ${content}`);
    } else if (role === 'assistant') {
      let assistantContent = content;
      if (Array.isArray(message.tool_calls)) {
        for (const tc of message.tool_calls) {
          const tag = toolCallToTag(tc);
          if (tag) assistantContent += `\n${tag}`;
        }
      }
      sections.push(`Assistant: ${assistantContent.trim()}`);
    } else if (role === 'tool' || role === 'function') {
      sections.push(`Tool Response (${message.name || message.tool_call_id || 'tool'}): ${content}`);
    } else {
      sections.push(`${role[0]?.toUpperCase() || 'U'}${role.slice(1)}: ${content}`);
    }
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

function isAutoExecuteEnabled(c: Context, body: any): boolean {
  const header = c.req.header('x-auto-execute-tools') || '';
  return body.auto_execute_tools === true
    || header.toLowerCase() === 'true'
    || process.env.AUTO_EXECUTE_TOOLS?.toLowerCase() === 'true';
}

function normalizeAssistantText(text: string): string {
  const trimmed = text.trim();
  const withoutSearchPrefix = trimmed.replace(/^SEARCHING\s*/i, '').trim();
  if (!withoutSearchPrefix.startsWith('{')) return trimmed;

  try {
    const parsed = robustParseJSON(withoutSearchPrefix);
    if (!parsed || typeof parsed.message !== 'string') return trimmed;

    let finalText = parsed.message.trim();
    if (Array.isArray(parsed.fontes) && parsed.fontes.length > 0) {
      const sources = parsed.fontes
        .filter((source: unknown) => typeof source === 'string' && source.trim())
        .map((source: string) => `- ${source.trim()}`)
        .join('\n');

      if (sources && !finalText.includes('## Fontes')) {
        finalText += `\n\n## Fontes\n${sources}`;
      }
    }

    return finalText || trimmed;
  } catch {
    return trimmed;
  }
}

async function collectQwenCompletion(
  prompt: string,
  enableThinking: boolean,
  model: string,
): Promise<QwenCompletion> {
  const result = await createQwenStream(prompt, enableThinking, model, null);
  const reader = result.stream.getReader();
  const decoder = new TextDecoder();
  const state = { lastFullContent: '', currentThoughtIndex: 0 };
  const toolParser = new StreamingToolParser();
  let buffer = '';
  let outputText = '';
  let inputTokens = Math.ceil(prompt.length / 3.5);
  let outputTokens = 0;
  const toolCalls: ParsedToolCall[] = [];

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
          const parsed = toolParser.feed(text);
          outputText += parsed.text;
          toolCalls.push(...parsed.toolCalls);
        }
      } catch {
        // Ignore partial chunks.
      }
    }
  }

  const flushed = toolParser.flush();
  outputText += flushed.text;
  toolCalls.push(...flushed.toolCalls);

  return {
    content: outputText,
    toolCalls,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }
  };
}

function assistantToolMessage(content: string, toolCalls: ParsedToolCall[]): ResponseInputMessage {
  return {
    role: 'assistant',
    content,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments)
      }
    }))
  };
}

function toolResultMessage(result: ToolCallResult): ResponseInputMessage {
  return {
    role: 'tool',
    tool_call_id: result.toolCallId,
    name: result.name,
    content: result.result
  };
}

async function runAutoExecuteResponses(
  messages: ResponseInputMessage[],
  model: string,
  enableThinking: boolean
): Promise<{ text: string; usage: QwenCompletion['usage'] }> {
  const maxTurns = Number(process.env.AUTO_EXECUTE_MAX_TURNS || '10');
  const tools = normalizePromptTools(registry.toOpenAITools());
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  for (let turn = 0; turn < maxTurns; turn++) {
    const prompt = messagesToPrompt(messages, tools);
    const completion = await collectQwenCompletion(prompt, enableThinking, model);
    usage.input_tokens += completion.usage.input_tokens;
    usage.output_tokens += completion.usage.output_tokens;
    usage.total_tokens += completion.usage.total_tokens;

    if (completion.toolCalls.length === 0) {
      return {
        text: normalizeAssistantText(completion.content),
        usage
      };
    }

    const toolResults = await executeToolCalls(completion.toolCalls, {
      messages,
      turn,
      model
    });

    messages.push(assistantToolMessage(completion.content, completion.toolCalls));
    messages.push(...toolResults.map(toolResultMessage));
  }

  throw new Error(`Execution loop exceeded maximum turns (${maxTurns}). The agent may be stuck in a cycle.`);
}

export async function responses(c: Context) {
  try {
    const body = await c.req.json();
    const model = body.model || 'qwen3.6-plus';
    const isStream = body.stream ?? false;
    const messages = inputToMessages(body.input, body.instructions);
    const prompt = messagesToPrompt(messages, normalizePromptTools(body.tools));
    const enableThinking = !model.includes('no-thinking');
    const responseId = `resp_${uuidv4()}`;
    const autoExecute = isAutoExecuteEnabled(c, body);

    if (autoExecute) {
      const { text, usage } = await runAutoExecuteResponses(messages, model, enableThinking);

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

          if (text) {
            await writeEvent('response.output_text.delta', {
              response_id: responseId,
              output_index: 0,
              content_index: 0,
              delta: text
            });
          }

          await writeEvent('response.completed', responsePayload(responseId, model, text, usage));
          await streamWriter.write('data: [DONE]\n\n');
        });
      }

      return c.json(responsePayload(responseId, model, text, usage));
    }

    const result = await createQwenStream(prompt, enableThinking, model, null);

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
