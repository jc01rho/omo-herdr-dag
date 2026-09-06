import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { TASK_SCOPE, isExpanded, loadViewState, saveViewState, setExpanded } from '../src/view-state.mjs';

test('only running expands automatically and explicit booleans override every status without mutation', () => {
  for (const scope of [TASK_SCOPE, 'run']) {
    for (const status of ['running', 'pending', 'blocked', 'scheduled', 'paused', 'completed', 'failed', 'cancelled', 'skipped', 'error', 'interrupted', 'lost', 'unknown', undefined]) {
      for (const preference of [undefined, null, 0, 1, 'true', false, true]) {
        const view = { expanded: { [JSON.stringify([scope, 'new'])]: preference } };
        const original = structuredClone(view);
        assert.equal(isExpanded(view, scope, 'new', status), typeof preference === 'boolean' ? preference : status === 'running');
        assert.deepEqual(view, original);
      }
      for (const view of [undefined, {}, { expanded: {} }]) assert.equal(isExpanded(view, scope, 'new', status), status === 'running');
    }
  }
});

test('standalone preferences use a reserved scope distinct from every string DAG ID', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tasks-view-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.json');
  const view = await loadViewState(file, 'session');
  assert.equal(isExpanded(view, TASK_SCOPE, 'task-a'), false);
  setExpanded(view, TASK_SCOPE, 'task-a', false);
  setExpanded(view, TASK_SCOPE, 'open-task', true);
  for (const runId of ['tasks', '__tasks__', 'null', '']) {
    setExpanded(view, runId, 'task-a', true);
    assert.equal(isExpanded(view, runId, 'task-a'), true);
    assert.equal(isExpanded(view, runId, 'open-task'), false);
  }
  await saveViewState(file, view);
  const restored = await loadViewState(file, 'session');
  assert.equal(isExpanded(restored, TASK_SCOPE, 'task-a'), false);
  assert.equal(isExpanded(restored, TASK_SCOPE, 'open-task'), true);
  assert.equal(isExpanded(restored, TASK_SCOPE, 'new-task'), false);
  assert.equal(isExpanded(await loadViewState(file, 'other'), TASK_SCOPE, 'open-task'), false);
});

test('explicit node preferences survive reload independently of snapshots and task attempts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dag-view-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.json');
  await writeFile(file, '{"writer":"untouched"}');
  const view = await loadViewState(file, 'session');
  assert.equal(isExpanded(view, 'run', 'node'), false);
  setExpanded(view, 'run', 'node', false);
  setExpanded(view, 'other-run', 'node', true);
  await saveViewState(file, view);
  await writeFile(file, '{"writer":"updated"}');
  const restored = await loadViewState(file, 'session');
  assert.equal(isExpanded(restored, 'run', 'node'), false);
  assert.equal(isExpanded(restored, 'other-run', 'node'), true);
  assert.equal(isExpanded(restored, 'run', 'new-node'), false);
  assert.equal(isExpanded(await loadViewState(file, 'other-session'), 'other-run', 'node'), false);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { writer: 'updated' });
  assert.equal(JSON.parse(await readFile(`${file}.view.json`, 'utf8')).sessionId, 'session');
  setExpanded(restored, 'run', 'node', true);
  await saveViewState(file, restored);
  assert.equal(isExpanded(await loadViewState(file, 'session'), 'run', 'node'), true);
});

test('sidecar validates boundary data and does not hide corrupt state', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dag-view-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.json');
  for (const value of ['{', '{"version":2}', '{"version":1,"sessionId":"s","expanded":{"x":"false"}}']) {
    await writeFile(`${file}.view.json`, value);
    await assert.rejects(loadViewState(file, 's'));
  }
  const view = await loadViewState(join(dir, 'missing.json'), 's');
  setExpanded(view, '__proto__', 'constructor', false);
  assert.equal(isExpanded(view, '__proto__', 'constructor'), false);
  assert.equal(isExpanded(view, '__proto__', 'other'), false);
});
