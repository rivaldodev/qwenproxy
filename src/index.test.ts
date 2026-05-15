import test from 'node:test';
import assert from 'node:assert';

process.env.TEST_MOCK_PLAYWRIGHT = 'true';
// Ensure API_KEY is empty by default for existing tests
process.env.API_KEY = '';

import { app } from './index.ts';
import { initPlaywright, closePlaywright } from './services/playwright.ts';
import { registry } from './tools/registry.ts';

test('Health check endpoint returns status ok', async () => {
  const req = new Request('http://localhost/health');
  const res = await app.fetch(req);
  
  assert.strictEqual(res.status, 200);
  
  const body = await res.json();
  assert.deepStrictEqual(body, { status: 'ok' });
});

test('Login page renders a browser form', async () => {
  const req = new Request('http://localhost/login');
  const res = await app.fetch(req);

  assert.strictEqual(res.status, 200);
  const body = await res.text();
  assert.match(body, /QwenProxy Login/);
  assert.match(body, /Sessão remota/);
  assert.match(body, /Controles/);
});

test('Login screenshot endpoint returns a PNG image', async () => {
  const req = new Request('http://localhost/login/screenshot');
  const res = await app.fetch(req);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('Content-Type'), 'image/png');

  const body = await res.arrayBuffer();
  assert.ok(body.byteLength > 0);
});

test('Login route respects API key protection', async () => {
  const originalApiKey = process.env.API_KEY;
  process.env.API_KEY = 'test-login-key';

  try {
    const unauthorized = await app.fetch(new Request('http://localhost/login'));
    assert.strictEqual(unauthorized.status, 401);

    const authorized = await app.fetch(new Request('http://localhost/login?key=test-login-key'));
    assert.strictEqual(authorized.status, 200);
  } finally {
    process.env.API_KEY = originalApiKey;
  }
});

test('Login click endpoint accepts coordinates', async () => {
  const req = new Request('http://localhost/login/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: 100, y: 200 })
  });

  const res = await app.fetch(req);

  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body, { ok: true });
});

test('Models endpoint returns qwen3.6-plus and qwen3.6-plus-no-thinking', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'qwen3.6-plus', owned_by: 'qwen' }] }), { status: 200 });
    }
    return originalFetch(input);
  };

  try {
    const req = new Request('http://localhost/v1/models');
    const res = await app.fetch(req);
    
    assert.strictEqual(res.status, 200);
    
    const body = await res.json();
    assert.strictEqual(body.object, 'list');
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.some((m: any) => m.id === 'qwen3.6-plus'));
    assert.ok(body.data.some((m: any) => m.id === 'qwen3.6-plus-no-thinking'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Models endpoint supports model lookup and non-v1 alias', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'qwen3.6-plus', owned_by: 'qwen' }] }), { status: 200 });
    }
    return originalFetch(input);
  };

  try {
    const list = await app.fetch(new Request('http://localhost/models'));
    assert.strictEqual(list.status, 200);
    const listBody = await list.json();
    assert.ok(listBody.data.some((m: any) => m.id === 'qwen3.6-plus'));

    const byId = await app.fetch(new Request('http://localhost/v1/models/qwen3.6-plus'));
    assert.strictEqual(byId.status, 200);
    const model = await byId.json();
    assert.strictEqual(model.id, 'qwen3.6-plus');
    assert.strictEqual(model.object, 'model');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Unknown routes return OpenAI-compatible JSON errors', async () => {
  const res = await app.fetch(new Request('http://localhost/v1/unknown'));

  assert.strictEqual(res.status, 404);
  assert.match(res.headers.get('Content-Type') || '', /application\/json/);

  const body = await res.json();
  assert.strictEqual(body.error.type, 'invalid_request_error');
  assert.strictEqual(body.error.code, 'route_not_found');
  assert.match(body.error.message, /Route not found: GET \/v1\/unknown/);
});

test('Chat Completions endpoint with qwen3.6-plus (thinking enabled)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'qwen3.6-plus', owned_by: 'qwen' }] }), { status: 200 });
    }
    if (url.includes('/api/v2/chat/completions')) {
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"phase": "thinking_summary", "extra": {"summary_thought": {"content": ["Thinking..."]}}}}]}\n\n'));
          c.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"phase": "answer", "content": "Hello"}}]}\n\n'));
          c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          c.close();
        }
      });
      return new Response(stream, { status: 200 });
    }
    return originalFetch(input);
  };

  // Initialize playwright for this test
  await initPlaywright(false);

  try {
    const payload = {
      model: 'qwen3.6-plus',
      messages: [{ role: 'user', content: 'What is 99 * 182? Please think step by step.' }],
      stream: true
    };

    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Content-Type'), 'text/event-stream');

    const reader = res.body?.getReader();
    assert.ok(reader, 'Response should have a readable body');

    const decoder = new TextDecoder();
    let hasReasoning = false;
    let hasContent = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.trim() === 'data: [DONE]') {
          break;
        }
        if (line.startsWith('data: ')) {
          try {
            const dataStr = line.slice(6);
            if (dataStr !== '[DONE]') {
              const data = JSON.parse(dataStr);
              
              if (data.choices && data.choices[0] && data.choices[0].delta) {
              const delta = data.choices[0].delta;
              if (delta.content) {
                hasContent = true;
              }
                if (delta.reasoning_content) {
                  hasReasoning = true;
                }
              }
            }
          } catch (err) {
            // Partial JSON ignored
            // console.error("Parse error:", err);
          }
        }
      }
    }

    assert.ok(hasReasoning, 'Should have received streamed chunks with reasoning_content (Thinking enabled)');
    assert.ok(hasContent, 'Should have received streamed chunks with content');
  } finally {
    globalThis.fetch = originalFetch;
    await closePlaywright();
  }
});

test('Chat Completions endpoint returns JSON when stream is false', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/v2/chat/completions')) {
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"phase": "answer", "content": "Ola"}}], "usage": {"input_tokens": 3, "output_tokens": 1}}\n\n'));
          c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          c.close();
        }
      });
      return new Response(stream, { status: 200 });
    }
    return originalFetch(input);
  };

  await initPlaywright(false);

  try {
    const req = new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.6-plus',
        messages: [{ role: 'user', content: 'Ola' }],
        stream: false
      })
    });

    const res = await app.fetch(req);

    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('Content-Type') || '', /application\/json/);

    const body = await res.json();
    assert.strictEqual(body.object, 'chat.completion');
    assert.strictEqual(body.choices[0].message.role, 'assistant');
    assert.strictEqual(body.choices[0].message.content, 'Ola');
    assert.strictEqual(body.choices[0].finish_reason, 'stop');
    assert.strictEqual(body.usage.prompt_tokens, 3);
    assert.strictEqual(body.usage.completion_tokens, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await closePlaywright();
  }
});

test('Responses endpoint returns OpenAI response object', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/v2/chat/completions')) {
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"phase": "answer", "content": "OK"}}], "usage": {"input_tokens": 2, "output_tokens": 1}}\n\n'));
          c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          c.close();
        }
      });
      return new Response(stream, { status: 200 });
    }
    return originalFetch(input);
  };

  await initPlaywright(false);

  try {
    const req = new Request('http://localhost/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.6-plus',
        instructions: 'Responda curto.',
        input: 'Diga OK'
      })
    });

    const res = await app.fetch(req);

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.object, 'response');
    assert.strictEqual(body.status, 'completed');
    assert.strictEqual(body.output_text, 'OK');
    assert.strictEqual(body.output[0].content[0].text, 'OK');
    assert.strictEqual(body.usage.input_tokens, 2);
    assert.strictEqual(body.usage.output_tokens, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await closePlaywright();
  }
});

test('Responses endpoint supports non-v1 alias', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/v2/chat/completions')) {
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"phase": "answer", "content": "alias"}}]}\n\n'));
          c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          c.close();
        }
      });
      return new Response(stream, { status: 200 });
    }
    return originalFetch(input);
  };

  await initPlaywright(false);

  try {
    const req = new Request('http://localhost/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.6-plus',
        input: [{ role: 'user', content: 'test alias' }]
      })
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.output_text, 'alias');
  } finally {
    globalThis.fetch = originalFetch;
    await closePlaywright();
  }
});

test('Responses endpoint auto-executes registered tools when enabled', async () => {
  const originalFetch = globalThis.fetch;
  let qwenCalls = 0;

  registry.register(
    'test_lookup',
    'Lookup test information',
    {
      type: 'object',
      properties: {
        query: { type: 'string' }
      },
      required: ['query']
    },
    async (args) => `lookup result for ${args.query}`
  );

  globalThis.fetch = async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/v2/chat/completions')) {
      qwenCalls++;
      const stream = new ReadableStream({
        start(c) {
          if (qwenCalls === 1) {
            c.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"phase": "answer", "content": "<tool_call>{\\"name\\": \\"test_lookup\\", \\"arguments\\": {\\"query\\": \\"abc\\"}}</tool_call>"}}], "usage": {"input_tokens": 10, "output_tokens": 2}}\n\n'));
          } else {
            c.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"phase": "answer", "content": "Final answer from tool"}}], "usage": {"input_tokens": 11, "output_tokens": 3}}\n\n'));
          }
          c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          c.close();
        }
      });
      return new Response(stream, { status: 200 });
    }
    return originalFetch(input);
  };

  await initPlaywright(false);

  try {
    const req = new Request('http://localhost/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.6-plus-no-thinking',
        auto_execute_tools: true,
        input: 'Use the lookup tool'
      })
    });

    const res = await app.fetch(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.output_text, 'Final answer from tool');
    assert.strictEqual(body.usage.input_tokens, 21);
    assert.strictEqual(body.usage.output_tokens, 5);
    assert.strictEqual(qwenCalls, 2);
  } finally {
    registry.unregister('test_lookup');
    globalThis.fetch = originalFetch;
    await closePlaywright();
  }
});

test('API Key protection', async () => {
  const originalApiKey = process.env.API_KEY;
  process.env.API_KEY = 'test-api-key';

  try {
    // 1. Test request without API Key
    const req1 = new Request('http://localhost/v1/models');
    const res1 = await app.fetch(req1);
    assert.strictEqual(res1.status, 401, 'Should return 401 Unauthorized without API Key');

    // 2. Test request with wrong API Key
    const req2 = new Request('http://localhost/v1/models', {
      headers: { 'Authorization': 'Bearer wrong-key' }
    });
    const res2 = await app.fetch(req2);
    assert.strictEqual(res2.status, 401, 'Should return 401 Unauthorized with wrong API Key');

    // 3. Test request with malformed Authorization header. Hono's bearerAuth used
    // to return 400 Bad Request here, but the proxy should consistently return 401.
    const reqMalformed = new Request('http://localhost/v1/models', {
      headers: { 'Authorization': 'test-api-key' }
    });
    const resMalformed = await app.fetch(reqMalformed);
    assert.strictEqual(resMalformed.status, 401, 'Should return 401 Unauthorized with malformed Authorization header');

    // 4. Test request with correct API Key
    // Mock fetch for models list
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });

    try {
      const req3 = new Request('http://localhost/v1/models', {
        headers: { 'Authorization': 'Bearer test-api-key' }
      });
      const res3 = await app.fetch(req3);
      assert.strictEqual(res3.status, 200, 'Should return 200 OK with correct API Key');

      const req4 = new Request('http://localhost/v1/models', {
        headers: { 'X-API-Key': 'test-api-key' }
      });
      const res4 = await app.fetch(req4);
      assert.strictEqual(res4.status, 200, 'Should return 200 OK with X-API-Key');
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    process.env.API_KEY = originalApiKey;
  }
});
