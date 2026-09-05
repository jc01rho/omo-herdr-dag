import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DagPane } from '../src/controller.mjs';
import { readJson } from '../src/storage.mjs';
import { payload, sessionId } from './fixtures.mjs';

async function setup(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'omo-dag-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
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
  return { calls, panes, options, controller: new DagPane(options) };
}
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
