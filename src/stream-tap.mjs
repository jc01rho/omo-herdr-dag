import { clean } from './model.mjs';

// OmO does not publish partial assistant text: live_progress.last_assistant_line
// changes only on message_end. In-process child tasks, however, run Senpi
// AgentSession instances created from the same barrel module that OmO keeps on
// globalThis (omo-ai omo-task.js: Symbol.for("omo.senpi-task.senpiBarrel")), and
// every agent event of a child passes through AgentSession.prototype._emit. A
// single process-wide wrapper forwards those events to the listeners of the
// current extension generation; reloaded generations replace only their listener.
const BARREL = Symbol.for('omo.senpi-task.senpiBarrel');
const HUB = Symbol.for('omo-herdr-dag.streamHub');
const forwarded = new Set(['turn_start', 'message_update', 'message_end', 'tool_execution_start',
  'tool_execution_end', 'auto_retry_start', 'agent_end']);
const TAIL = 200;
const childTask = /[/\\]senpi-task[/\\]children[/\\](st_[A-Za-z0-9_-]{1,253})[/\\]/;

function hub(global) {
  global[HUB] ??= { listeners: new Set(), patched: new WeakSet() };
  return global[HUB];
}

// 'missing': the barrel has not loaded yet. 'unsupported': it loaded, but this
// OmO/Senpi build no longer exposes the internals the tap relies on.
function patch(global) {
  const module = global[BARREL]?.module;
  if (!module) return 'missing';
  const proto = module.AgentSession?.prototype;
  if (typeof proto?._emit !== 'function') return 'unsupported';
  const state = hub(global);
  if (state.patched.has(proto)) return 'installed';
  const original = proto._emit;
  proto._emit = function emitWithStreamTap(event) {
    if (forwarded.has(event?.type)) {
      for (const listener of state.listeners) {
        try { listener(this, event); } catch { /* Display taps never break the agent. */ }
      }
    }
    return original.call(this, event);
  };
  state.patched.add(proto);
  return 'installed';
}

const tail = text => clean(text.slice(-TAIL * 2)).replace(/\s+/g, ' ').trim().slice(-TAIL);
const toolName = value => typeof value === 'string' && value ? clean(value).slice(0, 64) : undefined;

// Map one child agent event to the model activity it proves. Phases:
//   waiting  - a model request is in flight, no token yet (turn start)
//   text / thinking / toolArgs - tokens are arriving (tail = newest characters)
//   tool     - the model is idle while a tool runs
//   retry    - the provider failed and Senpi is waiting to retry
// `null` means the event does not change the displayed activity.
export function activityUpdate(taskId, event, now = Date.now()) {
  switch (event?.type) {
    case 'turn_start': return { taskId, active: true, phase: 'waiting', now };
    case 'tool_execution_start': return { taskId, active: true, phase: 'tool', tool: toolName(event.toolName), now };
    case 'tool_execution_end': return null;
    case 'auto_retry_start': return { taskId, active: true, phase: 'retry', now,
      ...(Number.isSafeInteger(event.attempt) ? { attempt: event.attempt } : {}),
      ...(Number.isSafeInteger(event.maxAttempts) ? { maxAttempts: event.maxAttempts } : {}) };
    case 'agent_end': return { taskId, active: false };
    case 'message_end': {
      // A tool call follows immediately; a final answer ends the model activity.
      const content = event.message?.role === 'assistant' ? event.message.content : undefined;
      if (!Array.isArray(content)) return null;
      return content.some(block => block?.type === 'toolCall') ? null : { taskId, active: false };
    }
    case 'message_update': break;
    default: return null;
  }
  const delta = event.assistantMessageEvent;
  if (event.message?.role !== 'assistant' || !delta) return null;
  const block = event.message.content?.[delta.contentIndex];
  if (delta.type === 'text_delta' || delta.type === 'thinking_delta') {
    const source = delta.type === 'text_delta' ? block?.text : block?.thinking;
    const text = typeof source === 'string' ? tail(source) : '';
    return text ? { taskId, active: true, phase: delta.type === 'text_delta' ? 'text' : 'thinking', text, now } : null;
  }
  if (delta.type === 'toolcall_delta') {
    const source = typeof block?.partialJson === 'string' ? block.partialJson : typeof delta.delta === 'string' ? delta.delta : '';
    return { taskId, active: true, phase: 'toolArgs', tool: toolName(block?.name), text: tail(source), now };
  }
  return null;
}

export function tapStreams(onUpdate, { global = globalThis, onUnsupported = () => {}, clock = Date.now } = {}) {
  const sessions = new WeakMap();
  const listener = (session, event) => {
    let taskId = sessions.get(session);
    if (taskId === undefined) {
      taskId = childTask.exec(session.sessionFile ?? '')?.[1] ?? null;
      sessions.set(session, taskId);
    }
    if (!taskId) return;
    const update = activityUpdate(taskId, event, clock());
    if (update) onUpdate(update);
  };
  const state = hub(global);
  state.listeners.add(listener);
  let installed = false, reported = false;
  const install = () => {
    if (installed) return true;
    const result = patch(global);
    installed = result === 'installed';
    // Report once: activity falls back silently to the normal progress line.
    if (result === 'unsupported' && !reported) { reported = true; onUnsupported(); }
    return installed;
  };
  // The barrel may still be loading when this session starts.
  if (!install()) global[BARREL]?.promise?.then(install, () => {});
  return { retry: install, installed: () => installed, stop: () => { state.listeners.delete(listener); } };
}
