import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { completion, fixture, json, runTurn, summaryReply } from './ai-test-kit';

test('reasoning_content survives a tool round and is sent back to the model', async () => {
  let calls = 0;
  let roundTrip: string | undefined;
  const f = await fixture(request => {
    if (!request.tools) return summaryReply();
    calls++;
    if (calls === 1) {
      return json({
        choices: [{
          message: {
            role: 'assistant', content: null, reasoning_content: 'I should read the table first.',
            tool_calls: [{ id: 'ctx-1', type: 'function', function: { name: 'get_context', arguments: '{}' } }],
          },
        }],
        usage: { cost: 0 },
      });
    }
    const assistant = (request.body.messages as { role: string; reasoning_content?: string }[]).find(message => message.role === 'assistant');
    roundTrip = assistant?.reasoning_content;
    return completion('You stand at the harbor. What do you do?');
  });
  try {
    const { state } = await runTurn(f, 'Begin.');
    assert.equal(state.run?.status, 'complete');
    assert.equal(roundTrip, 'I should read the table first.', 'the tool loop keeps reasoning_content on the assistant message');
  } finally { await f.close(); }
});
