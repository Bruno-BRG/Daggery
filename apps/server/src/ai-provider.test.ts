import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEEPSEEK_CONTEXT_WINDOW, DEEPSEEK_MAX_TOKENS, DEEPSEEK_REASONING_EFFORT, ModelProvider, effectiveContextWindow } from './ai/provider';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

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
});
