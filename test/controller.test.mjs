import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DagPane } from '../src/controller.mjs';
import { readJson, writeJson } from '../src/storage.mjs';
import { payload, sessionId } from './fixtures.mjs';
import { normalizeRun } from '../src/model.mjs';

async function setup(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'omo-dag-test-'));
  const controllers = new Set();
  t.after(async () => {
    for (const controller of controllers) await controller.stop();
    await rm(stateDir, { recursive: true, force: true });
  });
  const calls = [], panes = new Set();
  let number = 0;
  const herdr = async (...args) => {
    calls.push(args);
    if (args[0] === 'split') { const pane_id = `test:p${++number}`; panes.add(pane_id); return { pane: { pane_id } }; }
    if (args[0] === 'get' && !panes.has(args[1])) throw new Error('pane_not_found');
    return {};
  };
  const options = { sessionId, parentPane: 'test:p0', socket: '/tmp/test.sock', stateDir,
    cwd: "/tmp/project with ' quotes", node: '/usr/bin/node', viewer: '/tmp/viewer.mjs', herdr };
  const controller = new DagPane(options);
  controllers.add(controller);
  return { calls, panes, options, controller, controllers };
}
// CamelCase checkpoint fields and array nodes match the persisted OmO run record.
async function checkpointSetup(t, custom = false) {
  const base = await setup(t);
  const cwd = join(base.options.stateDir, 'project');
  const taskStateDir = custom ? join(base.options.stateDir, 'custom-task-store') : join(cwd, '.omo', 'senpi-task');
  const messages = [];
  const controller = new DagPane({ ...base.options, cwd, ...(custom ? { taskStateDir } : {}),
    notify: message => messages.push(message) });
  base.controllers.add(controller);
  const checkpoint = { schemaVersion: 1, checkpointSeq: 30, runId: 'dag_restored', parentSessionId: sessionId,
    rootSessionId: sessionId, status: 'completed', createdAt: '2026-09-06T01:28:18.600Z',
    updatedAt: '2026-09-06T01:55:44.466Z',
    nodes: Array.from({ length: 4 }, (_, i) => ({ id: `node-${i}`, state: 'completed', attempt: 1, taskId: `st_saved${i}` })),
    edges: [{ from: 'node-0', to: 'node-3' }, { from: 'node-1', to: 'node-3' }, { from: 'node-2', to: 'node-3' }] };
  const directory = join(taskStateDir, 'dag', 'runs');
  const checkpointFile = join(directory, `${checkpoint.runId}.json`);
  await writeJson(checkpointFile, checkpoint);
  for (const node of checkpoint.nodes) await writeJson(join(taskStateDir, 'tasks', `${node.taskId}.json`),
    { task_id: node.taskId, parent_session_id: sessionId, status: 'completed', description: node.id,
      updated_at: checkpoint.updatedAt, terminal_at: checkpoint.updatedAt });
  await writeJson(controller.stateFile, { sessionId, runs: [], tasks: [] });
  return { ...base, controller, checkpoint, checkpointFile, directory, messages, cwd };
}

for (const action of ['start', 'open']) for (const custom of [false, true]) {
  test(`${action} bootstraps four checkpoint nodes and tasks from ${custom ? 'custom' : 'default'} task root`, async t => {
    const { controller, checkpoint, calls, cwd } = await checkpointSetup(t, custom);
    if (custom) await writeJson(join(cwd, '.omo', 'senpi-task', 'dag', 'runs', 'dag_wrong_root.json'),
      { ...checkpoint, runId: 'dag_wrong_root' });
    await controller[action]();
    const state = await readJson(controller.stateFile);
    assert.deepEqual(state.runs, [normalizeRun(checkpoint)]);
    assert.deepEqual(state.tasks.map(task => task.id).sort(), checkpoint.nodes.map(node => node.taskId).sort());
    assert.equal(calls.filter(call => call[0] === 'split').length, 1);
  });
}

for (const action of ['start', 'open']) {
  test(`${action} prefers authoritative checkpoint over stale viewer cache for the same run`, async t => {
    const { controller, checkpoint } = await checkpointSetup(t);
    const stale = normalizeRun({ ...checkpoint, status: 'running', updatedAt: '2026-09-06T01:30:00Z' });
    await writeJson(controller.stateFile, { sessionId, runs: [stale], tasks: [] });
    await controller[action]();
    assert.deepEqual((await readJson(controller.stateFile)).runs, [normalizeRun(checkpoint)]);
  });
}

test('checkpoint bootstrap excludes foreign sessions and warns for malformed records without hiding valid runs', async t => {
  const { controller, checkpoint, directory, messages } = await checkpointSetup(t);
  await writeJson(join(directory, 'foreign.json'), { ...checkpoint, runId: 'dag_foreign', parentSessionId: 'foreign' });
  await writeJson(join(directory, 'invalid-shape.json'), { ...checkpoint, runId: 'dag_invalid', nodes: {} });
  await writeFile(join(directory, 'invalid-json.json'), '{');
  await writeFile(join(directory, 'ignored.tmp'), '{');
  await controller.start();
  assert.deepEqual((await readJson(controller.stateFile)).runs, [normalizeRun(checkpoint)]);
  assert.equal(messages.length, 2);
});

test('empty RPC lists retain durable runs but still replace ephemeral runs', async t => {
  const { controller, checkpoint } = await checkpointSetup(t);
  await controller.start();
  await controller.receive(payload());
  assert.deepEqual(new Set((await readJson(controller.stateFile)).runs.map(run => run.id)), new Set(['dag_demo', checkpoint.runId]));
  await controller.receive({ parent_session_id: sessionId, runs: [] });
  const state = await readJson(controller.stateFile);
  assert.deepEqual(state.runs, [normalizeRun(checkpoint)]);
  assert.equal(state.tasks.length, 4);
});

test('RPC updates queued during startup take precedence over the bootstrap checkpoint', async t => {
  const { controller, checkpoint, checkpointFile } = await checkpointSetup(t);
  await writeJson(checkpointFile, { ...checkpoint, status: 'running' });
  const starting = controller.start();
  const receiving = controller.receive({ parent_session_id: sessionId, runs: [checkpoint] });
  await Promise.all([starting, receiving]);
  assert.deepEqual((await readJson(controller.stateFile)).runs, [normalizeRun(checkpoint)]);
});

for (const trigger of ['start', 'rpc', 'disk']) {
  test(`standalone ${trigger} opens one pane without a DAG and respects manual close`, { timeout: 5000 }, async t => {
    const { options, calls, panes, controllers } = await setup(t);
    const taskStateDir = join(options.stateDir, 'standalone');
    const controller = new DagPane({ ...options, taskStateDir });
    controllers.add(controller);
    const saved = new EventEmitter();
    const save = controller.save.bind(controller);
    // Observe completion of the real save/activation path, without replacing it.
    controller.save = async connected => {
      const result = await save(connected);
      for (const task of controller.tasks) saved.emit(`${task.id}:${task.status}`);
      return result;
    };
    const record = { task_id: 'st_standalone', parent_session_id: sessionId, status: 'running', description: 'Standalone' };
    const file = join(taskStateDir, 'tasks', `${record.task_id}.json`);
    await writeJson(join(taskStateDir, 'tasks', 'st_foreign.json'), { ...record, task_id: 'st_foreign', parent_session_id: 'foreign' });
    if (trigger === 'start') await writeJson(file, record);
    await controller.start();
    if (trigger !== 'start') {
      assert.equal(calls.length, 0);
      if (trigger === 'rpc') await controller.receiveTasks({ parent_session_id: sessionId, tasks: [record] });
      else {
        const observed = once(saved, 'st_standalone:running', { signal: AbortSignal.timeout(2000) });
        await writeJson(file, record);
        await observed;
      }
    }
    let state = await readJson(controller.stateFile);
    assert.deepEqual(state.runs, []);
    assert.deepEqual(state.tasks.map(task => task.id), ['st_standalone']);
    assert.equal(calls.filter(call => call[0] === 'split').length, 1);
    panes.clear();
    const completed = { ...record, status: 'completed' };
    if (trigger === 'disk') {
      const observed = once(saved, 'st_standalone:completed', { signal: AbortSignal.timeout(2000) });
      await writeJson(file, completed);
      await observed;
    } else await controller.receiveTasks({ parent_session_id: sessionId, tasks: [completed] });
    state = await readJson(controller.stateFile);
    assert.equal(state.tasks[0].status, 'completed');
    assert.equal(calls.filter(call => call[0] === 'split').length, 1);
    await controller.open();
    assert.equal(calls.filter(call => call[0] === 'split').length, 2);
  });
}

test('empty startup and foreign task events never create a pane', async t => {
  const { options, calls, controllers } = await setup(t);
  const controller = new DagPane({ ...options, taskStateDir: join(options.stateDir, 'empty-tasks') });
  controllers.add(controller);
  await controller.start();
  await controller.receiveTasks({ parent_session_id: 'foreign', tasks: [{ task_id: 'st_foreign', status: 'running' }] });
  await controller.receive({ parent_session_id: sessionId, runs: [] });
  assert.equal(calls.length, 0);
});

test('a burst of events creates one pane, preserves focus, updates the same state file', async t => {
  const { calls, controller } = await setup(t);
  await Promise.all(Array.from({ length: 12 }, () => controller.receive(payload())));
  assert.equal(calls.filter(c => c[0] === 'split').length, 1);
  assert.ok(calls[0].includes('--no-focus'));
  assert.ok(calls[0].includes('right'));
  assert.equal(calls[0][calls[0].indexOf('--ratio') + 1], '0.65');
  assert.equal(calls.filter(c => c[0] === 'run').length, 1);
  const next = payload(); next.runs[0].nodes.forEach(n => { n.state = 'completed'; }); next.runs[0].status = 'completed';
  await controller.receive(next);
  assert.equal((await readJson(controller.stateFile)).runs[0].status, 'completed');
  assert.equal((await readJson(controller.stateFile)).language, 'en');
});
test('reload reuses the pane and manual closure is respected until explicit reopen', async t => {
  const { calls, panes, controller, options } = await setup(t);
  await controller.receive(payload());
  await controller.stop();
  assert.equal((await readJson(controller.stateFile)).connected, false);
  const next = new DagPane(options);
  await next.receive(payload());
  panes.clear();
  await next.receive(payload());
  assert.equal(calls.filter(c => c[0] === 'split').length, 1);
  await next.open();
  assert.equal(calls.filter(c => c[0] === 'split').length, 2);
});
test('different sessions cannot affect each other and empty DAG lists do not split', async t => {
  const { calls, controller, options } = await setup(t);
  await controller.receive({ parent_session_id: sessionId, runs: [] });
  await controller.receive({ ...payload(), parent_session_id: 'foreign' });
  assert.equal(calls.length, 0);
  const other = new DagPane({ ...options, sessionId: 'foreign' });
  assert.notEqual(controller.stateFile, other.stateFile);
});
test('a failed split is reported once; later events do not create orphan panes', async t => {
  const { options } = await setup(t); let calls = 0; const messages = [];
  const controller = new DagPane({ ...options, herdr: async () => { calls++; throw new Error('socket timeout'); }, notify: m => messages.push(m) });
  await assert.rejects(controller.receive(payload()), /timeout/);
  await controller.receive(payload());
  assert.equal(calls, 1); assert.equal(messages.length, 1);
});

test('the selected language is persisted for the viewer', async t => {
  const { options } = await setup(t);
  const controller = new DagPane({ ...options, language: 'ko' });
  await controller.receive(payload());
  assert.equal((await readJson(controller.stateFile)).language, 'ko');
});

test('runtime failure creates no pane or attempt record and can be retried', async t => {
  const { options, calls } = await setup(t);
  let available = false, probes = 0;
  const node = async () => { probes++; if (!available) throw new Error('Node unavailable'); return '/opt/Node Runtime/node'; };
  const controller = new DagPane({ ...options, node });
  await assert.rejects(controller.open(), /Node unavailable/);
  assert.equal(calls.length, 0);
  assert.equal(await readJson(controller.recordFile), null);
  available = true;
  await controller.open();
  assert.match(calls.find(c => c[0] === 'run')[2], /^(?:& )?'\/opt\/Node Runtime\/node' '\/tmp\/viewer.mjs' '--state'/);
  await controller.open();
  assert.equal(probes, 2);
  assert.equal(calls.filter(c => c[0] === 'split').length, 1);
});

test('task-only events update snapshots; reload restores completed details without another DAG event', async t => {
  const { options, calls } = await setup(t);
  const taskStateDir = join(options.stateDir, 'task-store');
  const controller = new DagPane({ ...options, taskStateDir });
  const dag = payload(); dag.runs[0].nodes[0].task_id = 'st_root';
  await writeJson(join(taskStateDir, 'tasks', 'st_root.json'), { task_id: 'st_root', parent_session_id: sessionId,
    description: 'Real task', status: 'running', child_session_id: 'child-session' });
  await controller.start();
  await controller.receive(dag);
  assert.equal((await readJson(controller.stateFile)).tasks[0].description, 'Real task');
  const beforeProgress = await readJson(controller.stateFile);
  for (const excerpt of ['PROGRESS_EXCERPT_ONE', 'PROGRESS_EXCERPT_TWO']) {
    await controller.receiveTasks({ parent_session_id: sessionId, tasks: [{ task_id: 'st_root', status: 'running',
      live_progress: { activity: 'running', last_assistant_line: excerpt, current_tool: 'bash', turns: 1, tool_calls: 1 },
      spawn_spec: { prompt: 'PRIVATE_PROMPT' }, output: 'PRIVATE_FULL_OUTPUT', final_response: 'PRIVATE_FINAL_RESPONSE' }] });
    const live = await readJson(controller.stateFile);
    assert.equal(live.tasks[0].progress, `[bash] ${excerpt}`);
    assert.deepEqual(live.runs, beforeProgress.runs);
    assert.doesNotMatch(JSON.stringify(live), /PRIVATE_|spawn_spec|final_response/);
  }
  await controller.receiveTasks({ parent_session_id: sessionId, tasks: [{ task_id: 'st_root',
    status: 'completed', updated_at: '2026-09-06T00:02:00Z', run_stats: { turns: 3, tool_calls: 7 },
    final_response: 'PRIVATE OUTPUT' }] });
  const snapshot = await readJson(controller.stateFile);
  assert.equal(snapshot.tasks[0].toolCalls, 7);
  assert.equal(snapshot.tasks[0].completedAt, '2026-09-06T00:02:00.000Z');
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE OUTPUT'));
  assert.equal(calls.filter(call => call[0] === 'split').length, 1);
  await controller.stop();
  const disconnected = await readJson(controller.stateFile);
  await controller.receiveTasks({ parent_session_id: sessionId, tasks: [{ task_id: 'st_root',
    live_progress: { last_assistant_line: 'AFTER_STOP' } }] });
  assert.deepEqual(await readJson(controller.stateFile), disconnected);
  await rm(taskStateDir, { recursive: true, force: true });
  const reloaded = new DagPane({ ...options, taskStateDir });
  await reloaded.start();
  assert.deepEqual((await readJson(reloaded.stateFile)).tasks, snapshot.tasks);
  await reloaded.stop();
  assert.equal((await readJson(reloaded.stateFile)).connected, false);
});
