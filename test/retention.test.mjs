import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { utimes, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneExpiredSnapshots, retentionDaysFromEnv } from '../src/retention.mjs';
import { DagPane, viewKey } from '../src/controller.mjs';
import { sessionId } from './fixtures.mjs';

const DAY = 86400000;
const makeDir = async t => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'herdr-retention-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
};
const age = (path, days) => utimes(path, days * DAY / 1000, days * DAY / 1000);

test('retention days default to 14 and honor valid overrides', () => {
  assert.equal(retentionDaysFromEnv({}), 14);
  assert.equal(retentionDaysFromEnv({ OMO_HERDR_DAG_RETENTION_DAYS: ' 7 ' }), 7);
  assert.equal(retentionDaysFromEnv({ OMO_HERDR_DAG_RETENTION_DAYS: '0.5' }), 0.5);
});

test('zero, negative, and non-numeric values disable pruning', () => {
  assert.equal(retentionDaysFromEnv({ OMO_HERDR_DAG_RETENTION_DAYS: '0' }), 0);
  assert.equal(retentionDaysFromEnv({ OMO_HERDR_DAG_RETENTION_DAYS: '-3' }), 0);
  assert.equal(retentionDaysFromEnv({ OMO_HERDR_DAG_RETENTION_DAYS: 'two weeks' }), 0);
  assert.equal(retentionDaysFromEnv({ OMO_HERDR_DAG_RETENTION_DAYS: '' }), 14);
});

test('pruning removes expired snapshot families and keeps fresh and protected files', async t => {
  const directory = await makeDir(t);
  const write = (name, days) => writeFile(join(directory, name), '{}').then(() => age(join(directory, name), days));
  await write('expired-session.json', 20);
  await write('expired-session.pane.json', 20);
  await write('expired-session.json.view.json', 20);
  await write('expired-session.json.deadbeef.tmp', 20);
  await write('fresh-session.json', 1);
  await write('fresh-session.pane.json', 1);
  await writeFile(join(directory, 'fresh-session.json.view.json'), '{}');
  await writeFile(join(directory, 'notes.txt'), 'keep me');
  await fs.mkdir(join(directory, 'generation-000001'));
  // A missing directory must be as harmless as an empty one.
  await pruneExpiredSnapshots(join(directory, 'missing'), { days: 14, now: Date.now() });
  const now = Date.now();
  await pruneExpiredSnapshots(directory, { keepFiles: ['fresh-session.json', 'fresh-session.pane.json', 'fresh-session.json.view.json'], now, days: 14 });
  assert.deepEqual((await fs.readdir(directory)).sort(),
    ['fresh-session.json', 'fresh-session.json.view.json', 'fresh-session.pane.json', 'generation-000001', 'notes.txt']);
});

test('pruning is a no-op when retention is disabled', async t => {
  const directory = await makeDir(t);
  const file = join(directory, 'ancient.json');
  await writeFile(file, '{}');
  await age(file, 400);
  await pruneExpiredSnapshots(directory, { days: 0, now: Date.now() });
  await pruneExpiredSnapshots(directory, { now: Date.now() });
  assert.deepEqual(await fs.readdir(directory), ['ancient.json']);
});

test('a failed removal is reported and does not stop other pruning', async t => {
  const directory = await makeDir(t);
  const messages = [];
  const first = join(directory, 'old-a.json');
  const second = join(directory, 'old-b.json');
  for (const file of [first, second]) { await writeFile(file, '{}'); await age(file, 30); }
  const rm = fs.rm;
  t.mock.method(fs, 'rm', async (...args) => {
    if (String(args[0]).endsWith('old-a.json')) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
    return rm(...args);
  });
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  syncBuiltinESMExports();
  await pruneExpiredSnapshots(directory, { days: 14, now: Date.now(), notify: message => messages.push(message) });
  assert.deepEqual(await fs.readdir(directory), ['old-a.json']);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /EBUSY/);
});

test('start() prunes expired snapshots but always spares the current session', async t => {
  const stateDir = await makeDir(t);
  const calls = [], panes = new Set();
  const herdr = async (...args) => {
    calls.push(args);
    if (args[0] === 'split') { const pane_id = `test:p${panes.size + 1}`; panes.add(pane_id); return { pane: { pane_id } }; }
    if (args[0] === 'get' && !panes.has(args[1])) throw new Error('pane_not_found');
    if (args[0] === 'list') return { panes: [] };
    if (args[0] === 'close') panes.delete(args[1]);
    return {};
  };
  const options = { sessionId, parentPane: 'test:p0', socket: '/tmp/retention.sock', stateDir,
    cwd: stateDir, node: '/usr/bin/node', viewer: '/tmp/viewer.mjs', herdr, retentionDays: 14 };
  const currentKey = viewKey(options.socket, options.parentPane, sessionId);
  const oldKey = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  for (const name of [`${oldKey}.json`, `${oldKey}.pane.json`, `${oldKey}.json.view.json`,
    `${currentKey}.json`, `${currentKey}.pane.json`]) {
    const path = join(stateDir, name);
    await writeFile(path, '{}');
    if (name.startsWith(oldKey)) await age(path, 30);
  }
  // Even a long-lived session's stale pane record survives; pruning it would
  // tear down and reopen the pane on the next background event.
  await age(join(stateDir, `${currentKey}.pane.json`), 30);
  const controller = new DagPane(options);
  await controller.start();
  await controller.stop();
  const remaining = (await fs.readdir(stateDir)).sort();
  assert.deepEqual(remaining,
    [`${currentKey}.json`, `${currentKey}.pane.json`].sort());
  assert.equal((await fs.readFile(join(stateDir, `${currentKey}.json`), 'utf8')).length > 0, true);
});
