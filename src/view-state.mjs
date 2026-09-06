import { readJson, writeJson } from './storage.mjs';

export function emptyViewState(sessionId) {
  return { version: 1, sessionId: sessionId ?? null, expanded: {} };
}

export async function loadViewState(stateFile, sessionId) {
  const saved = await readJson(`${stateFile}.view.json`);
  if (!saved) return emptyViewState(sessionId);
  if (saved.version !== 1 || !saved.expanded || typeof saved.expanded !== 'object' ||
      Array.isArray(saved.expanded) || Object.values(saved.expanded).some(value => typeof value !== 'boolean')) {
    throw new Error('Invalid DAG view preferences.');
  }
  return saved.sessionId === (sessionId ?? null) ? saved : emptyViewState(sessionId);
}

const key = (runId, nodeId) => JSON.stringify([runId, nodeId]);
// DAG run IDs are strings; null reserves a collision-free, stable task scope.
export const TASK_SCOPE = null;
export function isExpanded(view, runId, nodeId, status) {
  const saved = view?.expanded?.[key(runId, nodeId)];
  return typeof saved === 'boolean' ? saved : status === 'running';
}
export function setExpanded(view, runId, nodeId, expanded) {
  view.expanded[key(runId, nodeId)] = expanded;
}
export const saveViewState = (stateFile, view) => writeJson(`${stateFile}.view.json`, view);
