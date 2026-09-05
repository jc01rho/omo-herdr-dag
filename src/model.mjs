import { stripVTControlCharacters } from 'node:util';
import { t } from './i18n.mjs';

export const statuses = new Set(['pending', 'blocked', 'scheduled', 'running', 'paused', 'completed', 'failed', 'cancelled', 'skipped']);
export const terminal = new Set(['completed', 'failed', 'cancelled']);
export const clean = value => stripVTControlCharacters(String(value ?? '')).replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ');

// OmO beta.42: plugin/extensions/omo-task.js, y$ (RPC snapshot projection).
// Checkpoints use camelCase; the RPC bus projection uses snake_case.
export function normalizeRun(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;
  const id = raw.run_id ?? raw.runId;
  if (typeof id !== 'string' || !statuses.has(raw.status)) return null;
  const ids = new Set();
  const nodes = [];
  for (const node of raw.nodes) {
    if (!node || typeof node.id !== 'string' || ids.has(node.id) || !statuses.has(node.state)) return null;
    ids.add(node.id);
    nodes.push({ id: node.id, label: clean(node.label ?? node.id), state: node.state,
      attempt: node.attempt ?? 0, taskId: node.task_id ?? node.taskId,
      error: clean(node.last_error?.message ?? node.error?.message ?? '') });
  }
  const edges = [];
  const seen = new Set();
  for (const edge of raw.edges) {
    if (!edge || !ids.has(edge.from) || !ids.has(edge.to)) return null;
    const key = JSON.stringify([edge.from, edge.to]);
    if (!seen.has(key)) edges.push({ from: edge.from, to: edge.to });
    seen.add(key);
  }
  return { id, name: clean(raw.name ?? raw.run_key ?? raw.runKey ?? id), status: raw.status,
    createdAt: raw.created_at ?? raw.createdAt ?? '', updatedAt: raw.updated_at ?? raw.updatedAt ?? '', nodes, edges };
}

export function sessionRuns(payload, sessionId, language = 'en') {
  if (!payload || payload.parent_session_id !== sessionId || !Array.isArray(payload.runs)) return null;
  const runs = payload.runs.map(normalizeRun);
  if (runs.some(run => run === null)) throw new Error(t(language, 'snapshotFormat'));
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function layers(run, language = 'en') {
  const remaining = new Set(run.nodes.map(n => n.id));
  const done = new Set();
  const rows = [];
  while (remaining.size) {
    const row = run.nodes.filter(n => remaining.has(n.id) && run.edges.every(e => e.to !== n.id || done.has(e.from)));
    if (!row.length) throw new Error(t(language, 'cycle'));
    rows.push(row);
    for (const node of row) { remaining.delete(node.id); done.add(node.id); }
  }
  return rows;
}
