import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages } from '../src/i18n.mjs';
import { renderFrame, runningTarget, width } from '../src/render.mjs';

test('execution colors emphasize unselected graph and task titles, borders and status independently of selection', () => {
  const colors = { running: '36', completed: '32', failed: '31', error: '31', paused: '33', blocked: '33' };
  const nodes = [...Object.keys(colors), 'pending'].map(state => ({ id: state, label: `N_${state}`, state, taskId: state }));
  const state = { connected: true, runs: [{ id: 'r', name: 'Run', status: 'running', nodes, edges: [] }],
    tasks: nodes.map(node => ({ id: node.id, status: node.state === 'running' ? 'completed' : 'running', description: `T_${node.id}` })) };
  const frame = renderFrame(state, { columns: 35, rows: 200, color: true, selectedNodeId: 'completed' });
  const lines = frame.text.split('\n');
  for (const [id, color] of Object.entries(colors)) {
    const graph = lines.slice(3 + frame.graphRanges[id].start, 3 + frame.graphRanges[id].end);
    const card = lines.slice(3 + frame.nodeRanges[id].start, 3 + frame.nodeRanges[id].end);
    assert.ok(graph[0].startsWith(`\x1b[${color}m╭`), id);
    assert.ok(graph[1].includes(`\x1b[${color}m${id === 'completed' ? '>' : ' '}`), id);
    assert.ok(graph[2].includes(`\x1b[${color}m`), id);
    assert.ok(graph[4].startsWith(`\x1b[${color}m╰`), id);
    assert.ok(card[0].startsWith(`\x1b[${color}m╭`), id);
    assert.ok(card[1].includes(`\x1b[${color}m${id === 'completed' ? '>' : ' '}`), id);
    assert.ok(card.at(-1).startsWith(`\x1b[${color}m╰`), id);
  }
  const pending = lines.slice(3 + frame.graphRanges.pending.start, 3 + frame.graphRanges.pending.end).join('\n');
  assert.ok(!pending.includes('\x1b[36m'));
  state.runs = [];
  state.tasks = nodes.map(node => ({ id: node.id, status: node.state, description: `T_${node.id}` }));
  const standalone = renderFrame(state, { columns: 35, rows: 200, color: true, selectedTaskId: 'completed' });
  for (const [id, color] of Object.entries(colors)) {
    const range = standalone.taskRanges[id];
    const card = standalone.text.split('\n').slice(3 + range.start, 3 + range.end);
    assert.ok(card[0].startsWith(`\x1b[${color}m╭`), id);
    assert.ok(card[1].includes(`\x1b[${color}m${id === 'completed' ? '>' : ' '}`), id);
    if (id === 'completed') assert.ok(!card.join('\n').includes('\x1b[36m'));
  }
  assert.ok(!renderFrame(state, { color: false, rows: 200 }).text.includes('\x1b'));
});

test('running target stays stable across parallel reorders and retries, then hands off after completion or removal', () => {
  const state = { connected: true, runs: [
    { id: 'r', nodes: [{ id: 'a', state: 'running', taskId: 'ta' }, { id: 'b', state: 'running', taskId: 'tb' }] },
    { id: 'other', nodes: [{ id: 'a', state: 'running', taskId: 'other' }] },
  ], tasks: [{ id: 'root', status: 'running' }] };
  let target = runningTarget(state);
  assert.deepEqual(target, { view: 'dag', runId: 'r', nodeId: 'a', taskId: 'ta' });
  state.runs.reverse();
  const run = state.runs.find(run => run.id === 'r');
  run.nodes.reverse();
  run.nodes.push({ id: 'new', state: 'running', taskId: 'new' });
  assert.deepEqual(runningTarget(state, target), target);
  run.nodes.find(node => node.id === 'a').taskId = 'retry';
  target = runningTarget(state, target);
  assert.equal(target.nodeId, 'a');
  assert.equal(target.taskId, 'retry');
  run.nodes.find(node => node.id === 'a').state = 'completed';
  target = runningTarget(state, target);
  assert.equal(target.runId, 'other');
  state.runs.shift();
  target = runningTarget(state, target);
  assert.equal(target.nodeId, 'b');
  run.nodes.forEach(node => { node.state = 'completed'; });
  assert.deepEqual(runningTarget(state, target), { view: 'tasks', taskId: 'root' });
  state.connected = false;
  assert.equal(runningTarget(state, target), undefined);
});

test('new running tasks and DAGs arrive after empty state and linked targets transfer between views without hopping', () => {
  const state = { connected: true, runs: [], tasks: [] };
  assert.equal(runningTarget(state), undefined);
  state.tasks.push({ id: 'z', status: 'running' });
  let target = runningTarget(state);
  state.tasks.unshift({ id: 'a', status: 'running' });
  assert.deepEqual(runningTarget(state, target), target);
  state.runs.push({ id: 'r', nodes: [
    { id: 'parallel', state: 'running', taskId: 'parallel' },
    { id: 'linked', state: 'running', taskId: 'z' },
  ] });
  target = runningTarget(state, target);
  assert.equal(target.view, 'dag');
  assert.equal(target.nodeId, 'linked');
  state.runs = [];
  target = runningTarget(state, target);
  assert.deepEqual(target, { view: 'tasks', taskId: 'z' });
  state.tasks.find(task => task.id === 'z').status = 'completed';
  target = runningTarget(state, target);
  assert.deepEqual(target, { view: 'tasks', taskId: 'a' });
  state.tasks[0].status = 'completed';
  assert.equal(runningTarget(state, target), undefined);
});

test('follow reveals offscreen graph boxes rather than details, leaves visible targets still and preserves narrow CJK widths', () => {
  const nodes = Array.from({ length: 10 }, (_, i) => ({
    id: `n${i}`, label: i === 8 ? 'TARGET_한글中文' : `NODE_${i}`, state: i === 8 ? 'running' : 'completed', taskId: `t${i}`,
  }));
  const state = { connected: true, runs: [{ id: 'r', name: 'Run', status: 'running', nodes,
    edges: nodes.slice(1).map((node, i) => ({ from: nodes[i].id, to: node.id })) }],
  tasks: nodes.map(node => ({ id: node.taskId, status: node.state, description: `DETAIL_${node.id}`, progress: 'TOKEN_HEAD' })) };
  for (const language of ['en', 'ko', 'zh-cn']) for (const columns of [12, 20, 35, 54, 81]) {
    const options = { columns, rows: 18, color: true, language, selectedNodeId: 'n0', runningNodeId: 'n8' };
    const frame = renderFrame(state, options);
    assert.equal(frame.scroll, frame.graphRanges.n8.start);
    assert.ok(frame.scroll < frame.nodeRanges.n8.start);
    assert.ok(!frame.text.includes('DETAIL_n8'));
    assert.ok(frame.text.split('\n').every(line => width(line) < columns));
    const visibleScroll = frame.scroll - 1;
    assert.equal(renderFrame(state, { ...options, scroll: visibleScroll }).scroll, visibleScroll);
    state.tasks[8].progress = 'TOKEN_TAIL';
    assert.equal(renderFrame(state, { ...options, scroll: frame.scroll }).scroll, frame.scroll);
    const manual = renderFrame(state, { ...options, follow: false, scroll: 0 });
    assert.equal(manual.scroll, 0);
    const detail = renderFrame(state, { ...options, selectedNodeId: 'n8', revealSelection: true });
    assert.ok(detail.scroll > detail.graphRanges.n8.end);
    assert.ok(detail.scroll <= detail.nodeRanges.n8.start);
    if (columns >= 20) assert.ok(detail.text.includes('DETAIL_n8'));
  }
});

test('standalone follow reveals the running card without changing selection; disconnected frames have no live activity', () => {
  const tasks = ['a', 'b', 'c', 'z'].map(id => ({ id, status: 'running', description: `TASK_${id}_한글中文`,
    activity: { phase: 'text', since: 1000, lastAt: 1000, text: 'LIVE_TOKEN' } }));
  const state = { connected: true, runs: [], tasks, updatedAt: new Date(1000).toISOString() };
  for (const language of ['en', 'ko', 'zh-cn']) {
    const frame = renderFrame(state, { rows: 18, columns: 35, color: true, language, selectedTaskId: 'a', runningTaskId: 'z', now: 1000 });
    assert.ok(frame.scroll > 0 && frame.scroll <= frame.taskRanges.z.start);
    assert.ok(frame.text.includes('TASK_z'));
    assert.ok(!frame.text.includes('> ● TASK_z'));
    assert.ok(frame.text.includes('· f '));
    const wide = renderFrame(state, { rows: 18, columns: 54, color: false, language, runningTaskId: 'z', now: 1000 });
    assert.ok(wide.text.includes(messages[language].followOn));
    assert.ok(frame.text.split('\n').every(line => width(line) < 35));
    const disconnected = renderFrame({ ...state, connected: false }, { rows: 80, columns: 54, color: false, language, now: 1000 });
    assert.ok(disconnected.text.includes(messages[language].followOff));
    assert.ok(!disconnected.text.includes('LIVE_TOKEN'));
    assert.ok(disconnected.text.includes(messages[language].disconnected));
  }
});

test('narrow footer preserves the complete scroll position before the follow indicator', () => {
  const tasks = Array.from({ length: 100 }, (_, index) => ({
    id: String(index), status: 'pending', description: `task ${index}`,
  }));
  for (const language of ['en', 'ko', 'zh-cn']) for (const follow of [true, false]) {
    const options = { columns: 35, rows: 40, scroll: 1, follow, color: false, language };
    const state = { connected: true, runs: [], tasks };
    const frame = renderFrame(state, options);
    const footer = frame.text.split('\n').at(-4);
    assert.ok(footer.startsWith(`● ${messages[language].connected}  2–33/300 · f `), footer);
    assert.ok(frame.text.split('\n').every(line => width(line) < 35));
    const notice = 'NOTICE_한글中文';
    const withNotice = renderFrame(state, { ...options, notice }).text.split('\n').at(-4);
    assert.ok(withNotice.startsWith(`${notice} · f `), withNotice);
  }
});
