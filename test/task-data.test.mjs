import { test } from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskData, normalizeTask } from '../src/task-data.mjs';
import { writeJson } from '../src/storage.mjs';

const sessionId = 'parent-session';
const runs = [{ nodes: [{ id: 'root', taskId: 'st_root' }, { id: 'next', taskId: 'st_next' }],
  edges: [{ from: 'root', to: 'next' }] }];
const record = (task_id, extra = {}) => ({ task_id, parent_session_id: sessionId,
  status: 'running', created_at: '2026-09-06T00:00:00Z', updated_at: '2026-09-06T00:00:01Z', ...extra });

async function setup(t, onChange = () => {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'dag-task-data-'));
  const stateDir = join(cwd, '.omo', 'senpi-task');
  const messages = [];
  const data = new TaskData({ cwd, sessionId, onChange, notify: message => messages.push(message) });
  t.after(async () => { data.stop(); await rm(cwd, { recursive: true, force: true }); });
  const save = value => writeJson(join(stateDir, 'tasks', `${value.task_id}.json`), value);
  return { cwd, stateDir, data, save, messages };
}

test('actual RPC fields normalize to a bounded whitelist with ISO timestamps and missing values omitted', () => {
  assert.deepEqual(normalizeTask(record('st_root', { task_summary: 'Investigate', agent_type: 'explore',
    model: 'provider/model', live_progress: { activity: 'tool', started_at: 1788652800000, turns: 0, tool_calls: 3,
      last_assistant_line: 'LATEST_PROGRESS_EXCERPT', current_tool: 'bash' },
    spawn_spec: { prompt: 'PRIVATE PROMPT' }, final_response: 'PRIVATE OUTPUT' })), {
    id: 'st_root', description: 'Investigate', agent: 'explore', model: 'provider/model', status: 'running',
    startedAt: '2026-09-06T00:00:00.000Z', progress: '[bash] LATEST_PROGRESS_EXCERPT', turns: 0, toolCalls: 3,
  });
  assert.deepEqual(normalizeTask({ task_id: 'st_missing' }), { id: 'st_missing' });
  assert.equal(normalizeTask({ task_id: '../escape' }), null);
  assert.deepEqual(normalizeTask({ task_id: 'st_bad', run_stats: { turns: -1, tool_calls: '3' },
    live_progress: { activity: {}, started_at: 'invalid' }, created_at: 'invalid' }), { id: 'st_bad' });
});

test('latest progress excerpt and current tool are sanitized and bounded, without exporting other output', () => {
  const raw = record('st_root', { live_progress: { activity: 'running',
    last_assistant_line: '\u001b[31mLATEST_PROGRESS_EXCERPT\u001b[0m\n\u202e' + 'x'.repeat(800),
    current_tool: '\u001b[32mbash\u001b[0m' }, spawn_spec: { prompt: 'PRIVATE_PROMPT' },
    output: 'PRIVATE_FULL_OUTPUT', final_response: 'PRIVATE_FINAL_RESPONSE', transcript: ['PRIVATE_TRANSCRIPT'] });
  const task = normalizeTask(raw);
  assert.equal(task.progress.length, 512);
  assert.ok(task.progress.startsWith('[bash] LATEST_PROGRESS_EXCERPT'));
  const forbiddenRanges = [[0, 31], [127, 159], [0x202a, 0x202e], [0x2066, 0x2069]];
  assert.ok([...task.progress].every(character => {
    const code = character.codePointAt(0);
    return forbiddenRanges.every(([first, last]) => code < first || code > last);
  }));
  assert.doesNotMatch(JSON.stringify(task), /PRIVATE_|spawn_spec|final_response|transcript/);
  assert.equal(normalizeTask(record('st_root', { live_progress: { current_tool: 'read', activity: 'running' } })).progress, '[read]');
  assert.equal(normalizeTask(record('st_root', { live_progress: { last_assistant_line: 'LATEST_PROGRESS_EXCERPT' } })).progress,
    'LATEST_PROGRESS_EXCERPT');
  assert.equal(normalizeTask(record('st_root', { live_progress: { activity: 'running' } })).progress, 'running');
  const restored = new TaskData({ cwd: '/unused', sessionId });
  restored.restore([task]);
  assert.equal(restored.snapshot(runs)[0].progress, task.progress);
  restored.stop();
});

test('standalone tasks are collected without any DAG, with only verified descendants', async t => {
  const { data, save } = await setup(t);
  await Promise.all([
    save(record('st_standalone', { child_session_id: 'standalone-child' })),
    save(record('st_child', { parent_session_id: 'standalone-child', child_session_id: 'standalone-grandchild' })),
    save(record('st_grand', { parent_session_id: 'standalone-grandchild' })),
    save(record('st_foreign', { parent_session_id: 'foreign', child_session_id: 'foreign-child' })),
    save(record('st_foreign_child', { parent_session_id: 'foreign-child' })),
    save(record('st_orphan', { parent_session_id: 'unowned-child' })),
  ]);
  const tasks = await data.refresh([]);
  assert.deepEqual(tasks.map(task => task.id).sort(), ['st_child', 'st_grand', 'st_standalone']);
  assert.equal(Object.hasOwn(tasks.find(task => task.id === 'st_standalone'), 'parentTaskId'), false);
  assert.equal(tasks.find(task => task.id === 'st_child').parentTaskId, 'st_standalone');
  assert.equal(tasks.find(task => task.id === 'st_grand').parentTaskId, 'st_child');
  const restored = new TaskData({ cwd: '/unused', sessionId });
  t.after(() => restored.stop());
  restored.restore([...tasks].reverse());
  assert.deepEqual(await restored.refresh([]), tasks);
});

test('durable category and resolved model provide real metadata without fabricated defaults', () => {
  const task = normalizeTask(record('st_category', { category: 'deep', model: 'opencodex/gpt-6-astra',
    resolved_model: { provider: 'opencodex', model_id: 'gpt-6-astra', display: 'gpt-6-astra (opencodex)', source: 'category' } }));
  assert.equal(task.agent, 'deep');
  assert.equal(task.model, 'gpt-6-astra (opencodex)');
  assert.equal(normalizeTask(record('st_agent', { agent_type: 'explore', category: 'deep' })).agent, 'explore');
  assert.equal(normalizeTask(record('st_missing')).agent, undefined);
  assert.equal(normalizeTask(record('st_missing')).model, undefined);
  const restored = new TaskData({ cwd: '/unused', sessionId });
  restored.restore([task]);
  assert.deepEqual(restored.snapshot([]), [task]);
  restored.stop();
});

test('all actual terminal statuses clear live progress and preserve standalone stats after reload', async t => {
  const { data, save, stateDir } = await setup(t);
  const statuses = ['completed', 'error', 'cancelled', 'interrupted', 'lost'];
  for (const status of statuses) {
    const id = `st_${status}`;
    data.receive({ parent_session_id: sessionId, tasks: [record(id, {
      live_progress: { activity: 'thinking', turns: 2, tool_calls: 3 } })] });
    await save(record(id, { status, terminal_at: '2026-09-06T00:01:00Z', updated_at: '2026-09-06T00:01:00Z',
      run_stats: { turns: 7, tool_calls: 11 } }));
  }
  const tasks = await data.refresh([]);
  assert.equal(tasks.length, statuses.length);
  for (const status of statuses) {
    const task = tasks.find(task => task.id === `st_${status}`);
    assert.equal(task.status, status);
    assert.equal(task.completedAt, '2026-09-06T00:01:00.000Z');
    assert.equal(Object.hasOwn(task, 'progress'), false);
    assert.equal(task.turns, 7);
    assert.equal(task.toolCalls, 11);
    const fallback = normalizeTask(record(task.id, { status, live_progress: { activity: 'stale' } }));
    assert.equal(fallback.completedAt, '2026-09-06T00:00:01.000Z');
    assert.equal(Object.hasOwn(fallback, 'progress'), false);
  }
  await rm(join(stateDir, 'tasks'), { recursive: true });
  data.receive({ parent_session_id: sessionId, tasks: [], truncated_tasks: 1 });
  assert.deepEqual(await data.refresh([]), tasks);
  const restored = new TaskData({ cwd: '/unused', sessionId, stateDir });
  t.after(() => restored.stop());
  restored.restore(tasks);
  assert.deepEqual(await restored.refresh([]), tasks);
});

test('durable terminal anchor survives later residency RPC updates but clears on resumption', async t => {
  const { data, save, stateDir } = await setup(t);
  await save(record('st_root', { status: 'completed', terminal_at: '2026-09-06T00:01:00Z',
    updated_at: '2026-09-06T00:10:00Z', residency_state: 'evicted', run_stats: { turns: 7, tool_calls: 11 } }));
  await data.refresh(runs);
  const rpc = (status, updated_at) => ({ parent_session_id: sessionId,
    tasks: [{ task_id: 'st_root', status, updated_at }] });
  data.receive(rpc('completed', '2026-09-06T00:10:00Z'));
  assert.equal(data.snapshot(runs)[0].completedAt, '2026-09-06T00:01:00.000Z');
  const tasks = await data.refresh(runs); // Unchanged disk signature must not hide an RPC overwrite.
  assert.equal(tasks[0].completedAt, '2026-09-06T00:01:00.000Z');
  await rm(join(stateDir, 'tasks', 'st_root.json'));
  const restored = new TaskData({ cwd: '/unused', sessionId, stateDir });
  t.after(() => restored.stop());
  restored.restore(tasks);
  restored.receive(rpc('completed', '2026-09-06T00:11:00Z'));
  assert.equal((await restored.refresh(runs))[0].completedAt, '2026-09-06T00:01:00.000Z');
  restored.receive(rpc('running', '2026-09-06T00:12:00Z'));
  assert.equal(Object.hasOwn(restored.snapshot(runs)[0], 'completedAt'), false);
  restored.receive(rpc('completed', '2026-09-06T00:13:00Z'));
  assert.equal(restored.snapshot(runs)[0].completedAt, '2026-09-06T00:13:00.000Z');
  await save(record('st_root', { status: 'completed', terminal_at: '2026-09-06T00:12:30Z',
    updated_at: '2026-09-06T00:13:00Z' }));
  assert.equal((await restored.refresh(runs))[0].completedAt, '2026-09-06T00:12:30.000Z');
});

test('RPC-first residency snapshot is corrected by the matching durable terminal anchor', async t => {
  const { data, save } = await setup(t);
  data.receive({ parent_session_id: sessionId, tasks: [{ task_id: 'st_root', status: 'completed',
    updated_at: '2026-09-06T00:10:00Z', run_stats: { turns: 7, tool_calls: 11 } }] });
  const fallback = data.snapshot([])[0];
  assert.equal(fallback.completedAt, '2026-09-06T00:10:00.000Z');
  // Eviction writes this updated_at before emitting its RPC; terminal_at stays frozen.
  await save(record('st_root', { status: 'completed', terminal_at: '2026-09-06T00:01:00Z',
    updated_at: '2026-09-06T00:10:00Z', residency_state: 'evicted' }));
  const tasks = await data.refresh([]);
  assert.deepEqual(tasks[0], { ...fallback, startedAt: '2026-09-06T00:00:00.000Z',
    completedAt: '2026-09-06T00:01:00.000Z' });
  assert.deepEqual(await data.refresh([]), tasks);
});

test('late durable records cannot resurrect an earlier execution endpoint during or after resumption', async t => {
  const { data, save } = await setup(t);
  data.receive({ parent_session_id: sessionId, tasks: [{ task_id: 'st_root', status: 'completed',
    updated_at: '2026-09-06T00:10:00Z' }] });
  data.receive({ parent_session_id: sessionId, tasks: [{ task_id: 'st_root', status: 'running',
    updated_at: '2026-09-06T00:12:00Z', live_progress: { activity: 'thinking', turns: 2, tool_calls: 3 } }] });
  const resumed = data.snapshot([]);
  assert.equal(Object.hasOwn(resumed[0], 'completedAt'), false);
  await save(record('st_root', { status: 'completed', terminal_at: '2026-09-06T00:01:00Z',
    updated_at: '2026-09-06T00:01:00Z', run_stats: { turns: 7, tool_calls: 11 } }));
  assert.deepEqual(await data.refresh([]), resumed);
  data.receive({ parent_session_id: sessionId, tasks: [{ task_id: 'st_root', status: 'completed',
    updated_at: '2026-09-06T00:13:00Z', run_stats: { turns: 4, tool_calls: 5 } }] });
  const completed = data.snapshot([]);
  assert.equal(completed[0].completedAt, '2026-09-06T00:13:00.000Z');
  assert.equal(Object.hasOwn(completed[0], 'progress'), false);
  // A different old disk signature must still be rejected, even with the same status.
  await save(record('st_root', { status: 'completed', terminal_at: '2026-09-06T00:01:00Z',
    updated_at: '2026-09-06T00:10:00Z', residency_state: 'evicted' }));
  assert.deepEqual(await data.refresh([]), completed);
});

test('project store selects all own-session roots and verified session descendants, never DAG dependencies', async t => {
  const { data, save, stateDir } = await setup(t);
  await Promise.all([
    save(record('st_root', { child_session_id: 'child-session', description: 'Root' })),
    save(record('st_child', { parent_session_id: 'child-session', child_session_id: 'grand-session' })),
    save(record('st_grand', { parent_session_id: 'grand-session' })),
    save(record('st_next')),
    save(record('st_unrelated')),
    save(record('st_foreign', { parent_session_id: 'foreign' })),
  ]);
  // Windows hard links need no elevated symlink privilege; POSIX also exercises
  // symlink discovery, which must not silently drop linked .json entries.
  await writeJson(join(stateDir, 'linked-record'), record('st_link', { parent_session_id: 'child-session' }));
  if (process.platform === 'win32') await link(join(stateDir, 'linked-record'), join(stateDir, 'tasks', 'st_link.json'));
  else await symlink('../linked-record', join(stateDir, 'tasks', 'st_link.json'));
  const tasks = await data.refresh(runs);
  assert.deepEqual(tasks.map(task => task.id).sort(), ['st_child', 'st_grand', 'st_link', 'st_next', 'st_root', 'st_unrelated']);
  assert.equal(tasks.find(task => task.id === 'st_child').parentTaskId, 'st_root');
  assert.equal(tasks.find(task => task.id === 'st_grand').parentTaskId, 'st_child');
  assert.equal(tasks.find(task => task.id === 'st_next').parentTaskId, undefined);
  assert.equal(Object.hasOwn(tasks.find(task => task.id === 'st_unrelated'), 'parentTaskId'), false);
  assert.deepEqual(await data.refresh([{ nodes: [{ taskId: 'st_foreign' }] }]), tasks);
  assert.deepEqual(await data.refresh([]), tasks);
});

test('standalone RPC updates work without a DAG and persist terminal stats after truncation/removal', async t => {
  const { data, save, stateDir } = await setup(t);
  assert.equal(data.receive({ parent_session_id: sessionId, tasks: [record('st_root', {
    child_session_id: 'child-session', live_progress: { activity: 'thinking', turns: 2, tool_calls: 5 } })] }), true);
  assert.equal((await data.refresh([]))[0].toolCalls, 5);
  await save(record('st_root', { child_session_id: 'child-session' }));
  await data.refresh([]);
  assert.equal(data.receive({ parent_session_id: 'foreign', tasks: [record('st_root', { status: 'error' })] }), false);
  assert.equal((await data.refresh([]))[0].toolCalls, 5);
  data.receive({ parent_session_id: 'child-session', tasks: [record('st_child', { parent_session_id: 'child-session' })] });
  assert.equal((await data.refresh([])).find(task => task.id === 'st_child').parentTaskId, 'st_root');
  await save(record('st_root', { status: 'completed', terminal_at: '2026-09-06T00:02:00Z',
    updated_at: '2026-09-06T00:02:00Z', run_stats: { turns: 4, tool_calls: 8 } }));
  const completed = await data.refresh([]);
  assert.equal(completed[0].completedAt, '2026-09-06T00:02:00.000Z');
  assert.equal(completed[0].turns, 4);
  await rm(join(stateDir, 'tasks', 'st_root.json'));
  data.receive({ parent_session_id: sessionId, tasks: [], truncated_tasks: 1 });
  assert.deepEqual(await data.refresh([]), completed);
});

test('standalone watcher observes atomic changes and late directory creation without polling, then closes', { timeout: 3000 }, async t => {
  let signal;
  const { data, save } = await setup(t, () => { void data.refresh([]).then(tasks => signal?.(tasks)); });
  await data.start();
  const changed = new Promise(resolve => { signal = tasks => { if (tasks[0]?.status === 'running') resolve(); }; });
  await save(record('st_root'));
  await changed;
  assert.equal((await data.refresh([]))[0].id, 'st_root');
  const updated = new Promise(resolve => { signal = tasks => { if (tasks[0]?.status === 'completed') resolve(); }; });
  await save(record('st_root', { status: 'completed' }));
  await updated;
  assert.equal((await data.refresh([]))[0].status, 'completed');
  data.stop();
  assert.equal(data.watcher, undefined);
});

test('a queued watcher callback cannot publish or rearm after stop', async t => {
  let calls = 0;
  const { data } = await setup(t, () => { calls++; });
  data.start();
  const watcher = data.watcher;
  data.stop();
  watcher.emit('change', 'rename', '.omo');
  assert.equal(calls, 0);
  assert.equal(data.watcher, undefined);
});

test('malformed records report diagnostics while valid records and explicit store paths still work', async t => {
  const { data, save, stateDir, messages, cwd } = await setup(t);
  await save(record('st_root'));
  await writeFile(join(stateDir, 'tasks', 'st_broken.json'), '{');
  assert.equal((await data.refresh(runs)).length, 1);
  assert.equal(messages.length, 1);
  const custom = new TaskData({ cwd, sessionId, stateDir, notify: message => messages.push(message) });
  assert.equal((await custom.refresh(runs)).length, 1);
  custom.stop();
});
