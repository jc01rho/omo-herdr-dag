import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRun, sessionRuns, layers } from '../src/model.mjs';
import { render, width, fit } from '../src/render.mjs';
import { payload, sessionId } from './fixtures.mjs';

test('native snapshot retains the exact diamond edges and explicit states', () => {
  const [run] = sessionRuns(payload(), sessionId);
  assert.deepEqual(layers(run).map(row => row.map(node => node.id)), [['analyze'], ['server', 'ui'], ['integrate'], ['verify']]);
  assert.deepEqual(run.edges, payload().runs[0].edges);
  assert.equal(run.nodes[1].state, 'running');
});
test('foreign sessions and malformed graphs are never displayed', () => {
  assert.equal(sessionRuns(payload(), 'different-session'), null);
  const bad = payload(); bad.runs[0].edges.push({ from: 'unknown', to: 'ui' });
  assert.throws(() => sessionRuns(bad, sessionId), /snapshot/);
});
test('checkpoint camelCase and terminal failures are supported without exposing prompts', () => {
  const raw = payload().runs[0];
  const run = normalizeRun({ ...raw, run_id: undefined, runId: 'dag_checkpoint', createdAt: '2026-01-01',
    status: 'failed', nodes: [{ id: 'a', state: 'failed', error: { message: 'build failed' }, prompt: 'PRIVATE' }], edges: [] });
  assert.equal(run.nodes[0].error, 'build failed');
  assert.ok(!JSON.stringify(run).includes('PRIVATE'));
});
test('labels cannot inject terminal control sequences', () => {
  const raw = payload().runs[0]; raw.nodes[0].label = '\x1b]52;c;YQ==\x07분석\x1b[2J\nnext';
  const run = normalizeRun(raw);
  assert.equal(run.nodes[0].label, '분석 next');
});
test('narrow, normal, and wide terminals preserve row and display width limits', () => {
  const runs = sessionRuns(payload(), sessionId);
  for (const columns of [8, 12, 20, 35, 54, 81, 120]) for (const rows of [4, 10, 24, 48]) {
    const frame = render({ runs, connected: true }, { columns, rows, color: true });
    assert.equal(frame.split('\n').length, rows);
    for (const line of frame.split('\n')) assert.ok(width(line) < columns, `${columns}: ${line}`);
  }
  assert.equal(width('한글🙂e\u0301'), 7);
  assert.equal(width(fit('한글🙂abcdef', 8, true)), 8);
});
test('scrolling reveals exact edge list and failure diagnostics', () => {
  const raw = payload(); raw.runs[0].nodes[4].last_error = { message: '검증 실패: timeout' };
  const frame = render({ runs: sessionRuns(raw, sessionId), connected: false }, { columns: 54, rows: 14, scroll: 999, color: false });
  assert.match(frame, /integrate → verify/);
  assert.match(frame, /검증 실패: timeout/);
  assert.match(frame, /Disconnected/);
});
