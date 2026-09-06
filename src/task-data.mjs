import { watch, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { clean } from './model.mjs';
import { readJson } from './storage.mjs';

const taskId = value => typeof value === 'string' && /^st_[A-Za-z0-9_-]{1,253}$/.test(value);
const terminal = new Set(['completed', 'error', 'cancelled', 'interrupted', 'lost']);
const text = (value, limit = 2000) => typeof value === 'string' && value.trim() ? clean(value).slice(0, limit) : undefined;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
function iso(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

// Installed OmO beta.42: omo-senpi/components/task/task-rpc-codec.ts and
// senpi-task/state/types.ts. Only the selected latest assistant line is exposed;
// never retain spawn_spec, full output, final responses, or transcripts.
export function normalizeTask(raw) {
  if (!raw || !taskId(raw.task_id)) return null;
  const live = raw.live_progress;
  const stats = raw.run_stats;
  const tool = text(live?.current_tool, 128);
  const line = text(live?.last_assistant_line, 512);
  const progress = [tool ? `[${tool}]` : undefined, line].filter(Boolean).join(' ');
  const values = { id: raw.task_id,
    description: text(raw.description) ?? text(raw.task_summary) ?? text(raw.name),
    agent: text(raw.agent_type, 128) ?? text(raw.category, 128),
    model: text(raw.resolved_model?.display, 256) ?? text(raw.model, 256),
    status: text(raw.status, 64), startedAt: iso(live?.started_at) ?? iso(raw.created_at),
    completedAt: iso(raw.terminal_at) ?? (terminal.has(raw.status) ? iso(raw.updated_at) : undefined),
    progress: terminal.has(raw.status) ? undefined : text(progress, 512) ?? text(live?.activity, 512),
    turns: count(live?.turns) ?? count(stats?.turns), toolCalls: count(live?.tool_calls) ?? count(stats?.tool_calls) };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

export class TaskData {
  constructor({ cwd, sessionId, stateDir = join(cwd, '.omo', 'senpi-task'),
    notify = message => console.warn(message), onChange = () => {} }) {
    Object.assign(this, { sessionId, notify, onChange });
    this.directory = join(stateDir, 'tasks');
    this.entries = new Map();
    this.disk = new Map();
    this.stopped = false;
  }

  restore(tasks = []) {
    for (const raw of tasks) {
      const task = normalizeTask({ task_id: raw.id, description: raw.description, agent_type: raw.agent,
        model: raw.model, status: raw.status, created_at: raw.startedAt, terminal_at: raw.completedAt,
        live_progress: { activity: raw.progress, turns: raw.turns, tool_calls: raw.toolCalls } });
      if (!task) continue;
      this.entries.set(task.id, { task, parentSessionId: taskId(raw.parentTaskId) ? undefined : this.sessionId,
        ...(task.completedAt ? { updatedAt: task.completedAt } : {}),
        ...(taskId(raw.parentTaskId) ? { parentTaskId: raw.parentTaskId } : {}) });
    }
  }

  merge(raw, parentSessionId = raw.parent_session_id) {
    const task = normalizeTask(raw);
    if (!task || typeof parentSessionId !== 'string') return;
    const previous = this.entries.get(task.id);
    if (previous?.parentSessionId && previous.parentSessionId !== parentSessionId) return;
    const updatedAt = iso(raw.updated_at);
    if (previous?.updatedAt && updatedAt && updatedAt < previous.updatedAt) return;
    const merged = { ...previous?.task, ...task };
    if (terminal.has(merged.status)) {
      delete merged.progress;
      // Residency RPC updates lack terminal_at; updated_at must not move a known endpoint.
      if (!iso(raw.terminal_at) && previous?.task.completedAt) merged.completedAt = previous.task.completedAt;
    } else if (task.status) delete merged.completedAt;
    this.entries.set(task.id, { ...previous, task: merged, parentSessionId,
      ...(updatedAt ? { updatedAt } : {}),
      ...(typeof raw.child_session_id === 'string' ? { childSessionId: raw.child_session_id } : {}) });
  }

  receive(payload) {
    if (this.stopped || !payload || !Array.isArray(payload.tasks)) return false;
    const session = payload.parent_session_id;
    if (session !== this.sessionId && ![...this.entries.values()].some(entry => entry.childSessionId === session)) return false;
    for (const raw of payload.tasks) {
      if (raw && (raw.parent_session_id === undefined || raw.parent_session_id === session)) this.merge(raw, session);
    }
    return true;
  }

  async refresh(runs) {
    let files;
    try { files = await readdir(this.directory); }
    catch (error) { if (error.code !== 'ENOENT') throw error; files = []; }
    // readdir names deliberately includes symlinked .json records, just like OmO's store.
    await Promise.all(files.filter(file => file.endsWith('.json')).map(async file => {
      try {
        const raw = await readJson(join(this.directory, file));
        const task = normalizeTask(raw);
        if (!task) { if (raw !== null) this.notify(`DAG pane: Invalid task record ${file}`); return; }
        const signature = JSON.stringify([task, raw.parent_session_id, raw.child_session_id, raw.updated_at]);
        if (signature === this.disk.get(file)) return;
        this.disk.set(file, signature);
        this.merge(raw);
      } catch (error) { this.notify(`DAG pane: Cannot read task record ${file}: ${error.message}`); }
    }));
    return this.snapshot(runs);
  }

  snapshot() {
    const selected = new Map();
    // DAG membership is a presentation concern; every own-session task is a root.
    for (const [id, entry] of this.entries) {
      if (entry.parentSessionId === this.sessionId && !entry.parentTaskId) selected.set(id, { ...entry.task });
    }
    // A task owns a child session, not a DAG successor. Traverse only those explicit links.
    for (const [parentId] of selected) {
      const parent = this.entries.get(parentId);
      for (const [id, entry] of this.entries) {
        if (selected.has(id)) continue;
        if (entry.parentTaskId === parentId || (parent.childSessionId && entry.parentSessionId === parent.childSessionId)) {
          selected.set(id, { ...entry.task, parentTaskId: parentId });
        }
      }
    }
    return [...selected.values()];
  }

  start() {
    this.armWatcher();
  }

  armWatcher() {
    if (this.stopped) return;
    let directory = this.directory;
    while (!existsSync(directory) && dirname(directory) !== directory) directory = dirname(directory);
    if (directory === this.watchedDirectory) return;
    this.watcher?.close();
    this.watchedDirectory = directory;
    const next = relative(directory, this.directory).split(/[\\/]/)[0];
    this.watcher = watch(directory, { persistent: false }, (_event, filename) => {
      if (this.stopped || (next && filename && String(filename) !== next)) return;
      try { this.armWatcher(); this.onChange(); }
      catch (error) { this.notify(`DAG pane: Task watcher: ${error.message}`); }
    });
    this.watcher.on('error', error => this.notify(`DAG pane: Task watcher: ${error.message}`));
    // mkdir can create the next component between existsSync and watch. Subscribe
    // before checking again so that a newly created task directory cannot be missed.
    this.armWatcher();
  }

  stop() {
    this.stopped = true;
    this.watcher?.close();
    this.watcher = undefined;
    this.watchedDirectory = undefined;
  }
}
