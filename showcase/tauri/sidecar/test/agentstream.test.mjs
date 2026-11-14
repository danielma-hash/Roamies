// Failed agent requests must not crash the sidecar. Run: npm test
import assert from 'node:assert/strict';
import { AgentStream } from '@kenkaiiii/gg-agent';
import { agentEvents, stallWatch, IncompleteResponseError } from '../agentstream.mjs';

const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(e));

async function* failing() { yield { type: 'text_delta', text: 'Hi' }; throw new Error('Insufficient Balance'); }

// Regression: a provider error (no credits, bad sign-in) left an unhandled rejection that killed the sidecar.
const seen = [];
await assert.rejects(async () => {
  for await (const e of agentEvents(new AgentStream(failing(), () => {}))) seen.push(e.type);
}, /Insufficient Balance/, 'the error still reaches the caller');
assert.deepEqual(seen, ['text_delta'], 'events before the error still arrive');
await new Promise((r) => setTimeout(r, 50));
assert.deepEqual(unhandled, [], 'no unhandled rejection');

async function* ok() { yield { type: 'text_delta', text: 'OK' }; return 'done'; }
const types = [];
for await (const e of agentEvents(new AgentStream(ok(), () => {}))) types.push(e.type);
assert.deepEqual(types, ['text_delta'], 'a normal run is unchanged');
// The SDK ends normally after exhausted retries; a final truncation is not success,
// even when earlier text or tool results arrived. Intermediate continuations are fine.
for (const reason of ['empty_response', 'max_tokens', 'refusal', 'provider_error']) {
  async function* incomplete() {
    yield { type: 'text_delta', text: 'Partial answer' };
    yield { type: 'truncated', reason, continued: false };
    return 'done';
  }
  await assert.rejects(async () => {
    for await (const event of agentEvents(new AgentStream(incomplete(), () => {}))) {}
  }, error => error instanceof IncompleteResponseError && error.reason === reason);
}
async function* continued() {
  yield { type: 'truncated', reason: 'max_tokens', continued: true };
  yield { type: 'text_delta', text: 'Finished' };
  return 'done';
}
const recovered = [];
for await (const event of agentEvents(new AgentStream(continued(), () => {}))) recovered.push(event.type);
assert.deepEqual(recovered, ['truncated', 'text_delta']);
await new Promise(resolve => setTimeout(resolve, 25));
assert.deepEqual(unhandled, [], 'terminal truncations do not cause unhandled rejections');
// Regression: a request that stopped hearing back from the model waited forever with no word to the user.
{
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let stalls = 0;
  const w = stallWatch(60, () => stalls++);
  await wait(30); w.event({ type: 'text_delta' }); await wait(40);
  assert.equal(stalls, 0, 'each event restarts the wait');
  await wait(40);
  assert.equal(stalls, 1, 'silence past the limit stalls, once');
  let held = 0;
  const t = stallWatch(40, () => held++);
  t.event({ type: 'tool_call_start', toolCallId: 'a' }); await wait(80);
  assert.equal(held, 0, 'a running tool (maybe waiting on the user) pauses it');
  t.event({ type: 'tool_call_end', toolCallId: 'a' }); await wait(60);
  assert.equal(held, 1, 'the wait starts again once the tool is done');
  let stopped = 0;
  const u = stallWatch(30, () => stopped++); u.stop(); await wait(50);
  assert.equal(stopped, 0, 'stop() cancels it');
}
console.log('agent stream ok');
