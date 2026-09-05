export const sessionId = 'test-parent-session';
// Exact field names emitted by OmO beta.42's y$ snapshot projection.
export function payload() {
  return { parent_session_id: sessionId, runs: [{ run_id: 'dag_demo', name: 'Integration check · example DAG', status: 'running',
    created_at: '2026-09-05T07:00:00Z', updated_at: '2026-09-05T07:00:01Z',
    nodes: [
      { id: 'analyze', label: 'Analyze', state: 'completed', depends_on: [], attempt: 1 },
      { id: 'server', label: 'Server', state: 'running', depends_on: ['analyze'], attempt: 1 },
      { id: 'ui', label: 'UI', state: 'running', depends_on: ['analyze'], attempt: 1 },
      { id: 'integrate', label: 'Integrate', state: 'pending', depends_on: ['server', 'ui'], attempt: 0 },
      { id: 'verify', label: 'Verify', state: 'pending', depends_on: ['integrate'], attempt: 0 },
    ], edges: [{ from: 'analyze', to: 'server' }, { from: 'analyze', to: 'ui' },
      { from: 'server', to: 'integrate' }, { from: 'ui', to: 'integrate' }, { from: 'integrate', to: 'verify' }] }] };
}
