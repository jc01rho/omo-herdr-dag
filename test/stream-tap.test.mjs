import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityUpdate, tapStreams } from '../src/stream-tap.mjs';

const updateEvent = (kind, text, index = 0) => ({
  type: 'message_update', message: { role: 'assistant', content: [{ [kind]: text }] },
  assistantMessageEvent: { type: kind === 'text' ? 'text_delta' : 'thinking_delta', contentIndex: index, delta: text },
});

function fakeRuntime() {
  class AgentSession { _emit(event) { this.seen = [...(this.seen ?? []), event]; } }
  return { AgentSession, global: { [Symbol.for('omo.senpi-task.senpiBarrel')]: { module: { AgentSession } } } };
}

test('child events map to model activity phases with a sanitized tail', () => {
  const text = activityUpdate('st_task', updateEvent('text', `HEAD ${'가나다 '.repeat(80)} TAIL_끝`), 1000);
  assert.equal(text.phase, 'text');
  assert.equal(text.now, 1000);
  assert.ok(text.text.endsWith('TAIL_끝') && text.text.length <= 200 && !/\s{2}|\n/.test(text.text));
  assert.equal(activityUpdate('st_task', updateEvent('thinking', 'THINK_TAIL'), 1).phase, 'thinking');
  assert.equal(activityUpdate('st_task', updateEvent('text', '   '), 1), null);
  // Tool arguments stream too: the model is still generating while it writes a call.
  const args = activityUpdate('st_task', { type: 'message_update', message: { role: 'assistant',
    content: [{ type: 'toolCall', name: 'write', partialJson: '{"path":"a.txt","content":"ARGS_TAIL' }] },
    assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 0, delta: 'ARGS_TAIL' } }, 2);
  assert.deepEqual([args.phase, args.tool, args.text.endsWith('ARGS_TAIL')], ['toolArgs', 'write', true]);
  assert.deepEqual(activityUpdate('st_task', { type: 'turn_start' }, 3), { taskId: 'st_task', active: true, phase: 'waiting', now: 3 });
  assert.deepEqual(activityUpdate('st_task', { type: 'tool_execution_start', toolName: 'bash' }, 4),
    { taskId: 'st_task', active: true, phase: 'tool', tool: 'bash', now: 4 });
  assert.deepEqual(activityUpdate('st_task', { type: 'auto_retry_start', attempt: 2, maxAttempts: 3 }, 5),
    { taskId: 'st_task', active: true, phase: 'retry', attempt: 2, maxAttempts: 3, now: 5 });
  // A tool-call message hands over to the tool; a final answer or agent end is inactive.
  const end = content => activityUpdate('st_task', { type: 'message_end', message: { role: 'assistant', content } }, 6);
  assert.equal(end([{ type: 'toolCall', name: 'bash' }]), null);
  assert.deepEqual(end([{ type: 'text', text: 'done' }]), { taskId: 'st_task', active: false });
  assert.deepEqual(activityUpdate('st_task', { type: 'agent_end' }), { taskId: 'st_task', active: false });
  // Malformed or foreign events never change the display.
  assert.equal(activityUpdate('st_task', { type: 'message_update', message: { role: 'assistant', content: [{ text: 'x' }] },
    assistantMessageEvent: { type: 'text_delta', contentIndex: 3 } }), null);
  assert.equal(activityUpdate('st_task', { type: 'message_update', message: { role: 'user', content: [] },
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0 } }), null);
  assert.equal(activityUpdate('st_task', { type: 'tool_execution_end' }), null);
});

test('the tap patches one shared prototype and routes only child session events', () => {
  const { AgentSession, global } = fakeRuntime();
  const updates = [];
  const tap = tapStreams(update => updates.push(update), { global });
  assert.equal(tap.installed(), true);
  const child = Object.create(AgentSession.prototype);
  child.sessionFile = '/project/.omo/senpi-task/children/st_child/sessions/st_child/a.jsonl';
  const parent = Object.create(AgentSession.prototype);
  parent.sessionFile = '/project/.omo/sessions/parent.jsonl';
  parent._emit(updateEvent('text', 'PARENT_TEXT'));
  assert.deepEqual(updates, []);
  child._emit(updateEvent('text', 'CHILD_TAIL'));
  assert.deepEqual(updates.map(update => update.text), ['CHILD_TAIL']);
  child._emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } });
  assert.deepEqual(updates.at(-1), { taskId: 'st_child', active: false });
  // A reloaded generation must not double-patch or double-report.
  const again = tapStreams(() => {}, { global });
  assert.equal(again.installed(), true);
  child._emit(updateEvent('text', 'AFTER_REINSTALL'));
  assert.equal(updates.filter(update => update.text === 'AFTER_REINSTALL').length, 1);
  tap.stop(); again.stop();
  child._emit(updateEvent('text', 'AFTER_STOP'));
  assert.ok(!updates.some(update => update.text === 'AFTER_STOP'));
  // Events from a failing listener must still reach the session itself.
  const breaking = tapStreams(() => { throw new Error('display only'); }, { global });
  child._emit(updateEvent('text', 'SURVIVES'));
  assert.ok(child.seen.at(-1).message.content[0].text.includes('SURVIVES'));
  breaking.stop();
});

test('a barrel that is still loading installs after its module arrives', async () => {
  const { AgentSession } = fakeRuntime();
  let resolve;
  const barrel = { promise: new Promise(r => { resolve = r; }), module: undefined };
  const global = { [Symbol.for('omo.senpi-task.senpiBarrel')]: barrel };
  const tap = tapStreams(() => {}, { global });
  assert.equal(tap.installed(), false);
  barrel.module = { AgentSession };
  resolve();
  await new Promise(setImmediate);
  assert.equal(tap.installed(), true);
  tap.stop();
});

test('a runtime without the expected internals disables the tap instead of throwing', () => {
  let reports = 0;
  const onUnsupported = () => { reports++; };
  const withoutEmit = tapStreams(() => {}, { onUnsupported,
    global: { [Symbol.for('omo.senpi-task.senpiBarrel')]: { module: { AgentSession: class {} } } } });
  assert.equal(withoutEmit.installed(), false);
  assert.equal(withoutEmit.retry(), false);
  assert.equal(reports, 1);
  withoutEmit.stop();
  // A barrel that has not loaded yet is not an incompatibility.
  const withoutBarrel = tapStreams(() => {}, { global: {}, onUnsupported });
  assert.equal(withoutBarrel.installed(), false);
  assert.equal(withoutBarrel.retry(), false);
  assert.equal(reports, 1);
  withoutBarrel.stop();
});
