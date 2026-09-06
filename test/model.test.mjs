import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages } from '../src/i18n.mjs';
import { layers, normalizeRun, sessionRuns } from '../src/model.mjs';
import { fit, render, renderFrame, standaloneTasks, width } from '../src/render.mjs';
import { TASK_SCOPE, emptyViewState, setExpanded } from '../src/view-state.mjs';
import { payload, sessionId } from './fixtures.mjs';

test('standalone tasks are separate from every DAG, default expanded, and expose real metadata and children', () => {
  const state = { connected: true, runs: [], tasks: [
    { id: 'b', status: 'completed', description: 'FINISHED_SENTINEL' },
    { id: 'a', status: 'running', description: 'ROOT_SENTINEL 한글🙂', category: 'visual-engineering',
      model: 'REAL_MODEL', progress: 'LATEST_PROGRESS', startedAt: '2026-09-06T00:00:00Z', turns: 0, toolCalls: 2 },
    { id: 'child', parentTaskId: 'a', status: 'interrupted', description: 'CHILD_SENTINEL' },
    { id: 'grandchild', parentTaskId: 'child', status: 'lost', description: 'GRANDCHILD_SENTINEL' },
    { id: 'c', status: 'error', description: 'ERROR_SENTINEL' },
  ] };
  const original = structuredClone(state);
  assert.deepEqual(standaloneTasks(state).map(task => task.id), ['a', 'b', 'c']);
  const options = { rows: 200, columns: 54, color: false, selectedTaskId: 'a', now: Date.parse('2026-09-06T00:01:02Z') };
  const frame = renderFrame(state, options);
  for (const value of ['ROOT_SENTINEL', 'visual-engineering', 'REAL_MODEL', 'LATEST_PROGRESS', '00:01:02',
    'CHILD_SENTINEL', 'GRANDCHILD_SENTINEL', 'ERROR_SENTINEL']) assert.ok(frame.text.includes(value), value);
  assert.ok(frame.taskRanges.a);
  assert.ok(frame.text.includes(`${messages.en.category}: visual-engineering`));
  assert.ok(frame.text.includes(`${messages.en.turns}: 0`));
  for (const status of ['error', 'interrupted', 'lost']) assert.ok(frame.text.includes(messages.en[status]));
  assert.ok(!frame.text.includes(messages.en.dependencies));
  const viewState = emptyViewState('session');
  setExpanded(viewState, TASK_SCOPE, 'a', false);
  const collapsed = render(state, { ...options, viewState });
  assert.ok(!collapsed.includes('ROOT_SENTINEL'));
  assert.ok(!collapsed.includes('CHILD_SENTINEL'));
  state.runs = [{ id: 'r1', name: 'ONE', status: 'running', nodes: [{ id: 'n', state: 'running', label: 'NODE', taskId: 'b' }], edges: [] },
    { id: 'r2', name: 'TWO', status: 'running', nodes: [{ id: 'n', state: 'running', label: 'NODE', taskId: 'c' }], edges: [] }];
  assert.deepEqual(standaloneTasks(state).map(task => task.id), ['a']);
  const mixed = render(state, { ...options, view: 'tasks' });
  assert.ok(mixed.includes('ROOT_SENTINEL'));
  assert.ok(!mixed.includes('FINISHED_SENTINEL'));
  assert.ok(!mixed.includes('ERROR_SENTINEL'));
  const dag = render(state, options);
  assert.ok(dag.includes(messages.en.tasks));
  assert.ok(!dag.includes('ROOT_SENTINEL'));
  state.runs = [];
  assert.deepEqual(state, original);
  for (const columns of [8, 20, 35, 54, 80]) for (const language of ['en', 'ko']) {
    const text = render(state, { ...options, columns, language });
    assert.ok(text.split('\n').every(line => width(line) < columns), `${language}: ${columns}`);
  }
});

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
  const state = { runs: sessionRuns(raw, sessionId), connected: false };
  const options = { columns: 54, rows: 14, color: false };
  const end = renderFrame(state, { ...options, scroll: 999 });
  const frame = end.text;
  const pages = [];
  for (let scroll = 0; scroll <= end.scroll; scroll++) pages.push(render(state, { ...options, scroll }));
  assert.match(pages.join('\n'), /integrate → verify/);
  assert.match(frame, /검증 실패: timeout/);
  assert.match(frame, /Disconnected/);
});

test('expanded details wrap full task data and traverse only explicit descendants', () => {
  const run = { id: 'run', name: 'Run', status: 'running', nodes: [
    { id: 'a', label: 'Analyze', state: 'running', taskId: 'task-a' },
    { id: 'b', label: 'Build', state: 'pending', taskId: 'task-b' },
  ], edges: [{ from: 'a', to: 'b' }] };
  const progress = `PROGRESS_START ${'한글🙂 useful work '.repeat(8)} PROGRESS_END`;
  const state = { connected: true, runs: [run], tasks: [
    { id: 'task-a', description: `DESCRIPTION_START ${'readable description '.repeat(8)} DESCRIPTION_END`,
      agent: 'worker', model: 'test-model', progress, turns: 0, toolCalls: 7,
      startedAt: '2026-09-06T01:00:00Z', completedAt: '2026-09-06T01:02:00Z' },
    { id: 'child', parentTaskId: 'task-a', description: 'EXPLICIT_CHILD', status: 'running' },
    { id: 'grandchild', parentTaskId: 'child', description: 'EXPLICIT_GRANDCHILD' },
    { id: 'task-b', description: 'DEPENDENCY_NOT_CHILD' },
    { id: 'stray', description: 'UNRELATED_TASK' },
  ] };
  const frame = render(state, { columns: 54, rows: 200, color: false, selectedNodeId: 'a' });
  for (const token of ['PROGRESS_START', 'PROGRESS_END', 'DESCRIPTION_START', 'DESCRIPTION_END',
    'worker', 'test-model', 'EXPLICIT_CHILD', 'EXPLICIT_GRANDCHILD', '2026-09-06T01:00:00Z', '2026-09-06T01:02:00Z']) assert.ok(frame.includes(token), token);
  assert.doesNotMatch(frame, /UNRELATED_TASK/);
  assert.ok(frame.split('\n').every(line => width(line) < 54));
  const a = renderFrame(state, { columns: 54, rows: 200, color: false }).nodeRanges.a;
  const aLines = frame.split('\n').slice(3 + a.start, 3 + a.end).join('\n');
  assert.doesNotMatch(aLines, /DEPENDENCY_NOT_CHILD/);
  assert.ok(aLines.includes(`${messages.en.turns}: 0`));
  assert.ok(aLines.includes(`${messages.en.toolCalls}: 7`));
  const collapsed = render(state, { columns: 54, rows: 200, color: false,
    viewState: { expanded: { '["run","a"]': false } } });
  assert.doesNotMatch(collapsed, /PROGRESS_START|EXPLICIT_CHILD|EXPLICIT_GRANDCHILD/);
  assert.match(collapsed, /DEPENDENCY_NOT_CHILD/);
  assert.match(collapsed, /a → b/);
});

test('navigation keeps a selected detail header visible and scrolling remains bounded', () => {
  const runs = sessionRuns(payload(), sessionId);
  const state = { runs, connected: true };
  const frame = renderFrame(state, { rows: 14, columns: 54, selectedNodeId: 'verify', revealSelection: true, color: false });
  assert.ok(frame.scroll > 0);
  assert.match(frame.text, /> \[-\].*verify/);
  const end = renderFrame(state, { rows: 14, scroll: 99999, color: false });
  assert.ok(end.scroll < 99999);
});

test('missing task metadata is explicit, cyclic subtasks terminate, and text cannot inject terminal controls', () => {
  const run = { id: 'r', name: 'R', status: 'running', nodes: [
    { id: 'missing', label: 'MISSING', state: 'running' },
    { id: 'linked', label: 'LINKED', state: 'running', taskId: 'parent' },
  ], edges: [] };
  const state = { runs: [run], connected: true, tasks: [
    { id: 'parent', parentTaskId: 'child', progress: '\x1b]52;c;YQ==\x07SAFE_PROGRESS\x1b[2J' },
    { id: 'child', parentTaskId: 'parent', description: 'CHILD_ONCE' },
  ] };
  const { text, nodeRanges } = renderFrame(state, { rows: 200, color: false });
  const missing = text.split('\n').slice(3 + nodeRanges.missing.start, 3 + nodeRanges.missing.end).join('\n');
  assert.ok(missing.includes(`${messages.en.task}: ${messages.en.noData}`));
  assert.ok(text.includes(`${messages.en.agent}: ${messages.en.noData}`));
  assert.ok(text.includes('SAFE_PROGRESS'));
  assert.equal(text.match(/CHILD_ONCE/g)?.length, 1);
  assert.ok(!text.includes('\x1b'));
});

test('preference errors remain visible while details are scrolled', () => {
  const frame = render({ runs: sessionRuns(payload(), sessionId), connected: true },
    { rows: 14, scroll: 9999, notice: 'PREFERENCE_ERROR_SENTINEL', color: false });
  assert.ok(frame.includes('PREFERENCE_ERROR_SENTINEL'));
});

test('elapsed duration uses injected time, freezes completion, and never invents missing endpoints', () => {
  const startedAt = '2026-09-06T00:00:00.000Z';
  const now = Date.parse('2026-09-06T01:02:03.999Z');
  const state = { connected: true, runs: [{ id: 'r', name: 'R', status: 'running',
    nodes: [{ id: 'a', label: 'A', state: 'running', taskId: 'task' }], edges: [] }],
    tasks: [{ id: 'task', status: 'running', startedAt, turns: 0, toolCalls: 7 }] };
  const frame = (time = now) => render(state, { now: time, color: false, rows: 100 });
  const elapsed = value => `${messages.en.elapsed}: ${value}`;
  assert.ok(frame().includes(elapsed('01:02:03')));
  assert.ok(frame(now + 1000).includes(elapsed('01:02:04')));
  const stats = frame().split('\n').find(line => line.includes(elapsed('01:02:03')));
  assert.ok(stats.includes(`${messages.en.turns}: 0`));
  assert.ok(stats.includes(`${messages.en.toolCalls}: 7`));
  // A root can use its actual DAG node state when task status is absent.
  delete state.tasks[0].status;
  assert.ok(frame().includes(elapsed('01:02:03')));
  state.tasks[0].completedAt = '2026-09-06T00:00:09.900Z';
  state.tasks[0].status = 'completed';
  assert.ok(frame().includes(elapsed('00:00:09')));
  assert.equal(frame(), frame(now + 86400000));
  for (const status of ['completed', 'failed', 'cancelled', 'lost', 'paused', 'pending']) {
    state.tasks[0] = { id: 'task', status, startedAt };
    assert.ok(frame().includes(elapsed(messages.en.noData)), status);
  }
  for (const task of [
    { id: 'task', status: 'running' },
    { id: 'task', status: 'running', startedAt: 'invalid' },
    { id: 'task', status: 'running', startedAt, completedAt: 'invalid' },
    { id: 'task', startedAt, completedAt: '2026-09-05T23:59:59Z' },
    { id: 'task', status: 'running', startedAt: '2026-09-07T00:00:00Z' },
  ]) {
    state.tasks[0] = task;
    assert.ok(frame().includes(elapsed(messages.en.noData)), JSON.stringify(task));
  }
  state.tasks[0] = { id: 'task', status: 'running', startedAt };
  state.connected = false;
  assert.ok(frame().includes(elapsed(messages.en.noData)));
  state.updatedAt = '2026-09-06T00:03:04Z';
  assert.ok(frame().includes(elapsed('00:03:04')));
  assert.equal(frame(), frame(now + 86400000));
});

test('elapsed duration follows explicit descendants without borrowing the parent node status', () => {
  const state = { connected: true, runs: [{ id: 'r', name: 'R', status: 'running',
    nodes: [{ id: 'a', label: 'A', state: 'running', taskId: 'parent' }], edges: [] }], tasks: [
    { id: 'parent', startedAt: '2026-09-06T00:00:00Z' },
    { id: 'child', parentTaskId: 'parent', status: 'running', startedAt: '2026-09-06T00:01:00Z' },
    { id: 'unknown', parentTaskId: 'parent', startedAt: '2026-09-06T00:01:00Z' },
  ] };
  const frame = render(state, { now: Date.parse('2026-09-06T00:02:03Z'), color: false, rows: 100 });
  for (const value of ['00:02:03', '00:01:03', messages.en.noData]) assert.ok(frame.includes(`${messages.en.elapsed}: ${value}`));
});
