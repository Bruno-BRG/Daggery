import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fixture, finished } from './ai-test-kit';

/** An SSE body, so the fixture provider answers a streaming request the way a real provider would. */
function sse(parts: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) { for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close(); },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const frame = (data: unknown) => 'data: ' + JSON.stringify(data) + '\n\n';

test('a GM turn publishes narration deltas to the campaign and never streams tool arguments', async () => {
  let calls = 0;
  const f = await fixture(() => {
    calls++;
    if (calls === 1) {
      // A tool call whose arguments carry a GM-only secret, split across index-keyed chunks.
      return sse([
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'secret', type: 'function', function: { name: 'set_memory', arguments: '{"memory":"THE-HIDDEN-' } }] } }] }),
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'SECRET"}' } }] } }] }),
        'data: [DONE]\n\n',
      ]);
    }
    return sse([
      frame({ choices: [{ delta: { content: 'The harbor ' } }] }),
      frame({ choices: [{ delta: { content: 'is quiet.' } }] }),
      'data: [DONE]\n\n',
    ]);
  });
  try {
    f.ai.start(f.user.id, f.campaign, { requestId: 'stream-1', message: 'Look around.' });
    const state = await finished(f.ai, f.user.id, f.campaign);
    assert.equal(state.run?.status, 'complete');
    assert.equal(f.deltas.length > 0, true, 'narration deltas were published');
    assert.equal(f.deltas.map(delta => delta.text).join(''), 'The harbor is quiet.');
    assert.ok(f.deltas.every(delta => delta.campaign === f.campaign && delta.turn === state.run!.id && delta.chat === state.activeChatId));
    assert.ok(!f.deltas.some(delta => delta.text.includes('THE-HIDDEN-SECRET')), 'tool arguments never reach the stream');
    assert.equal(state.messages.at(-1)?.text, 'The harbor is quiet.', 'the persisted message stays the source of truth');
  } finally { await f.close(); }
});

test('prose in a reply that goes on to call tools never streams, and a long one is withdrawn', async () => {
  let calls = 0;
  const long = 'PLAN-SECRET ' + 'x'.repeat(500);
  const f = await fixture(() => {
    calls++;
    const tool = (id: string) => frame({ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name: 'get_context', arguments: '{}' } }] } }] });
    if (calls === 1) return sse([frame({ choices: [{ delta: { content: 'I will make the innkeeper SHORT-SECRET.' } }] }), tool('a'), 'data: [DONE]\n\n']);
    if (calls === 2) return sse([frame({ choices: [{ delta: { content: long } }] }), tool('b'), 'data: [DONE]\n\n']);
    return sse([frame({ choices: [{ delta: { content: 'Rain on the docks.' } }] }), 'data: [DONE]\n\n']);
  });
  try {
    f.ai.start(f.user.id, f.campaign, { requestId: 'stream-hold', message: 'Look around.' });
    const state = await finished(f.ai, f.user.id, f.campaign);
    assert.equal(state.run?.status, 'complete');
    assert.ok(!f.deltas.some(delta => delta.text.includes('SHORT-SECRET')), 'short pre-tool prose is held and dropped');
    const clear = f.deltas.findIndex(delta => delta.text === '');
    assert.ok(clear > 0, 'a long tool-round reply that already streamed is cleared');
    const last = f.deltas.at(-1)!;
    assert.equal(last.text, 'Rain on the docks.');
    assert.ok(last.round > f.deltas[0]!.round, 'the narration arrives in a later round, replacing the withdrawn text');
  } finally { await f.close(); }
});

test('a provider that answers with JSON still completes the turn without streaming', async () => {
  const f = await fixture(() => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Plain reply.' } }], usage: { cost: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  try {
    f.ai.start(f.user.id, f.campaign, { requestId: 'stream-json', message: 'Look around.' });
    const state = await finished(f.ai, f.user.id, f.campaign);
    assert.equal(state.run?.status, 'complete');
    assert.equal(state.messages.at(-1)?.text, 'Plain reply.');
    assert.deepEqual(f.deltas, [], 'a non-streaming reply publishes no deltas');
  } finally { await f.close(); }
});
