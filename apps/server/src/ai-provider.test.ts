import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEEPSEEK_CONTEXT_WINDOW, DEEPSEEK_MAX_TOKENS, DEEPSEEK_REASONING_EFFORT, ModelProvider, credentialWindow, effectiveContextWindow } from './ai/provider';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** An SSE body assembled from raw text parts, so a data line can be split across chunks. */
function sse(parts: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) { for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close(); },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const frame = (data: unknown) => 'data: ' + JSON.stringify(data) + '\n\n';

function catalog(models: Record<string, unknown>[]) {
  return { data: models.map(model => ({ type: 'chat', capabilities: { tools: { supported: true } }, cost: { text: { input: { price: 1 } } }, ...model })) };
}

test('DeepSeek V4 context windows are budgeted at 1M when the catalog omits or lowers them', async () => {
  const provider = new ModelProvider((async () => json(catalog([
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', limit: { context: 128000 } },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    { id: 'deepseek-v3', name: 'DeepSeek V3', limit: { context: 64000 } },
    { id: 'kimi-k2', name: 'Kimi K2', limit: { context: 256000 } },
  ]))) as typeof fetch);
  const models = await provider.models('opencode-go');
  assert.equal(models.find(model => model.id === 'deepseek-v4.1-flash')?.contextWindow, DEEPSEEK_CONTEXT_WINDOW);
  assert.equal(models.find(model => model.id === 'deepseek-v4-pro')?.contextWindow, DEEPSEEK_CONTEXT_WINDOW);
  assert.equal(models.find(model => model.id === 'deepseek-v3')?.contextWindow, 64000);
  assert.equal(models.find(model => model.id === 'kimi-k2')?.contextWindow, 256000);
  assert.equal(effectiveContextWindow('deepseek-v4.1-flash', 0), DEEPSEEK_CONTEXT_WINDOW);
  assert.equal(effectiveContextWindow('deepseek-chat', 0), 0);
});

test('DeepSeek completions send maximum reasoning effort and room for reasoning tokens', async () => {
  const bodies: any[] = [];
  const provider = new ModelProvider((async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return json({
      choices: [{ message: { role: 'assistant', content: 'The tide turns.', reasoning_content: 'Considered the harbor and the keeper.' } }],
      usage: { cost: 0.02 },
    });
  }) as typeof fetch);
  const response = await provider.complete('opencode-go', 'key', 'deepseek-v4.1-flash', [{ role: 'user', content: 'Go' }], [], new AbortController().signal, 'campaign');
  assert.equal(bodies[0].reasoning_effort, DEEPSEEK_REASONING_EFFORT);
  assert.equal(bodies[0].max_tokens, DEEPSEEK_MAX_TOKENS);
  assert.equal(response.message.reasoning_content, 'Considered the harbor and the keeper.');

  await provider.complete('opencode-go', 'key', 'deepseek-v4.1-flash', [{ role: 'user', content: 'Summarize' }], [], new AbortController().signal, 'campaign', { maxTokens: 1800 });
  assert.equal(bodies[1].max_tokens, 1800, 'compaction keeps its own small budget');
  assert.equal(bodies[1].reasoning_effort, DEEPSEEK_REASONING_EFFORT);
});

test('non-DeepSeek models keep the existing request shape', async () => {
  const bodies: any[] = [];
  const provider = new ModelProvider((async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return json({ choices: [{ message: { role: 'assistant', content: 'Ready.' } }], usage: { cost: 0 } });
  }) as typeof fetch);
  await provider.complete('opencode-go', 'key', 'gpt-6.1-sol', [{ role: 'user', content: 'Go' }], [], new AbortController().signal, 'campaign');
  assert.equal(bodies[0].reasoning_effort, undefined);
  assert.equal(bodies[0].max_tokens, 2400);
  assert.equal(bodies[0].stream, false);
});

test('streaming completions accumulate content, reasoning and cost from SSE, skipping malformed frames', async () => {
  const bodies: any[] = [];
  const provider = new ModelProvider((async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return sse([
      'event: message\n',
      frame({ choices: [{ delta: { role: 'assistant', reasoning_content: 'Weigh the harbor. ' } }] }),
      frame({ choices: [{ delta: { content: 'The tide ' } }] }),
      // One data line split across two network chunks.
      'data: {"choices":[{"delta":{"content":"turns"',
      '}}]}\n\n',
      ': keep-alive\n',
      'data: not json\n\n',
      frame({ choices: [{ delta: { content: '.' } }], usage: { cost: 0.03 } }),
      'data: [DONE]\n\n',
    ]);
  }) as typeof fetch);
  const deltas: string[] = [];
  const response = await provider.complete('opencode-go', 'key', 'gpt-6.1-sol', [{ role: 'user', content: 'Go' }], [], new AbortController().signal, 'campaign', { onDelta: delta => deltas.push(delta) });
  assert.equal(bodies[0].stream, true);
  assert.deepEqual(bodies[0].stream_options, { include_usage: true });
  assert.equal(response.message.content, 'The tide turns.');
  assert.deepEqual(deltas, ['The tide ', 'turns', '.']);
  assert.equal(response.message.reasoning_content, 'Weigh the harbor. ');
  assert.equal(response.cost, 0.03);
});

test('streaming completions merge split tool-call chunks by index and never stream their arguments', async () => {
  const provider = new ModelProvider((async () => sse([
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'create_scene', arguments: '' } }] } }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"name":' } }] } }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"The lighthouse"}' } }] } }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'get_context', arguments: '{}' } }] } }] }),
    'data: [DONE]\n\n',
  ])) as typeof fetch);
  const deltas: string[] = [];
  const response = await provider.complete('opencode-go', 'key', 'gpt-6.1-sol', [{ role: 'user', content: 'Go' }], [], new AbortController().signal, 'campaign', { onDelta: delta => deltas.push(delta) });
  assert.equal(response.message.content, null);
  assert.deepEqual(response.message.tool_calls, [
    { id: 'call_a', type: 'function', function: { name: 'create_scene', arguments: '{"name":"The lighthouse"}' } },
    { id: 'call_b', type: 'function', function: { name: 'get_context', arguments: '{}' } },
  ]);
  assert.deepEqual(deltas, [], 'tool arguments are never handed to onDelta');
});

test('a provider that answers a streaming request with JSON is read as a normal completion', async () => {
  const provider = new ModelProvider((async () => json({ choices: [{ message: { role: 'assistant', content: 'Plain reply.' } }], usage: { cost: 0.01 } })) as typeof fetch);
  const deltas: string[] = [];
  const response = await provider.complete('opencode-go', 'key', 'gpt-6.1-sol', [{ role: 'user', content: 'Go' }], [], new AbortController().signal, 'campaign', { onDelta: delta => deltas.push(delta) });
  assert.equal(response.message.content, 'Plain reply.');
  assert.equal(response.cost, 0.01);
  assert.deepEqual(deltas, []);
});

test('a provider that rejects the streaming request retries once without it', async () => {
  const bodies: any[] = [];
  const provider = new ModelProvider((async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return body.stream ? json({ error: 'unsupported stream' }, 400) : json({ choices: [{ message: { role: 'assistant', content: 'Fell back.' } }] });
  }) as typeof fetch);
  const response = await provider.complete('opencode-go', 'key', 'gpt-6.1-sol', [{ role: 'user', content: 'Go' }], [], new AbortController().signal, 'campaign', { onDelta: () => {} });
  assert.equal(response.message.content, 'Fell back.');
  assert.deepEqual(bodies.map(body => body.stream), [true, false]);
});

test('a provider that goes silent fails the request with a clear error instead of hanging', async () => {
  const provider = new ModelProvider((async (_url, init) => {
    const signal = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }) as typeof fetch, 20, 1000);
  await assert.rejects(provider.complete('opencode-go', 'key', 'test-gm', [{ role: 'user', content: 'Hi' }], [], new AbortController().signal, 'session'), /stopped responding/);
});

test('a stream that keeps sending reasoning stays alive past the idle limit', async () => {
  const encoder = new TextEncoder();
  const provider = new ModelProvider((async () => new Response(new ReadableStream({
    async start(controller) {
      for (let n = 0; n < 6; n++) { controller.enqueue(encoder.encode(frame({ choices: [{ delta: { reasoning_content: 'hm' } }] }))); await new Promise(resolve => setTimeout(resolve, 10)); }
      controller.enqueue(encoder.encode(frame({ choices: [{ delta: { content: 'Done.' } }] }) + 'data: [DONE]\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch, 30, 5000);
  const result = await provider.complete('opencode-go', 'key', 'test-gm', [{ role: 'user', content: 'Hi' }], [], new AbortController().signal, 'session', { onDelta: () => {} });
  assert.equal(result.message.content, 'Done.');
});

test('a user context limit caps the budgeted window but never raises it', () => {
  assert.equal(credentialWindow('deepseek-v4.1-flash', 1000000, 0), 1000000);
  assert.equal(credentialWindow('deepseek-v4.1-flash', 1000000, 128000), 128000);
  assert.equal(credentialWindow('kimi-k2', 256000, 400000), 256000);
  assert.equal(credentialWindow('unknown', 0, 64000), 64000);
});
