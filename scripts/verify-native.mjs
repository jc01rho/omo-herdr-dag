import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { payload, sessionId } from '../test/fixtures.mjs';
import { readJson } from '../src/storage.mjs';

const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/verify-native.mjs OMO_PACKAGE_ROOT [--live]');
const live = process.argv.includes('--live');
if (live) {
  if (process.env.HERDR_ENV !== '1' || !process.env.HERDR_PANE_ID || !process.env.HERDR_SOCKET_PATH) {
    throw new Error('--live must run inside a Herdr pane.');
  }
} else {
  // Exercise the extension's environment gate without contacting a real Herdr socket.
  process.env.HERDR_ENV = '1';
  process.env.HERDR_PANE_ID = 'test:pane';
  process.env.HERDR_SOCKET_PATH = join(tmpdir(), 'omo-dag-test-no-socket');
}
const senpi = join(root, 'node_modules/@code-yeongyu/senpi');
const { createEventBus } = await import(pathToFileURL(join(senpi, 'dist/core/event-bus.js')));
const { loadExtensionFromFactory, loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(senpi, 'dist/core/extensions/loader.js')));
const stateDir = process.argv.includes('--state-dir') ? process.argv[process.argv.indexOf('--state-dir') + 1] : await mkdtemp(join(tmpdir(), 'omo-dag-native-'));
process.env.OMO_HERDR_DAG_STATE_DIR = stateDir;
const bus = createEventBus();
const runtime = createExtensionRuntime();
const extensionPath = process.argv.includes('--extension') ? process.argv[process.argv.indexOf('--extension') + 1] : resolve('extension.mjs');
const loaded = await loadExtensions([extensionPath], process.cwd(), bus, runtime);
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);
const extension = loaded.extensions[0];
const notices = [];
const ctx = { sessionManager: { getSessionId: () => sessionId, getSessionFile: () => '/tmp/parent-session.jsonl' },
  ui: { notify: message => notices.push(message) } };
let emit;
await loadExtensionFromFactory(pi => { emit = data => pi.rpc.emit('omo.dag.updated', data); }, process.cwd(), bus, runtime);

// The real OmO emitter and the real Senpi bus contract must still be present.
const source = await readFile(join(root, 'plugin/extensions/omo-task.js'), 'utf8');
assert.ok(source.includes('"omo.dag.updated"'));
assert.ok(source.includes('parent_session_id:e,runs:'));
assert.ok(source.includes('depends_on:e.dependsOn,state:e.state'));

async function invoke(name) {
  for (const handler of extension.handlers.get(name) ?? []) await handler({ type: name }, ctx);
}
async function settle() {
  // Shutdown drains the extension's serialized file/pane work; no timing guesses.
  await invoke('session_shutdown');
  assert.deepEqual(notices, []);
}
try {
  await invoke('session_start');
  emit({ ...payload(), parent_session_id: 'foreign' });
  await settle();
  const emptyFiles = (await readdir(stateDir)).filter(f => f.endsWith('.json') && !f.endsWith('.pane.json'));
  assert.equal((await readJson(join(stateDir, emptyFiles[0]))).runs.length, 0);

  await invoke('session_start');
  const data = payload();
  if (process.argv.includes('--complete')) {
    data.runs[0].status = 'completed';
    data.runs[0].nodes.forEach(node => { node.state = 'completed'; });
  }
  if (!live) data.runs = []; // Unit integration must never touch Herdr.
  for (let i = 0; i < 5; i++) emit(data);
  await settle();
  const files = await readdir(stateDir);
  const stateFile = join(stateDir, files.find(f => f.endsWith('.json') && !f.endsWith('.pane.json')));
  const state = await readJson(stateFile);
  if (process.argv.includes('--expect-language')) {
    assert.equal(state.language, process.argv[process.argv.indexOf('--expect-language') + 1]);
  }
  assert.equal(state.runs.length, live ? 1 : 0);
  assert.equal(state.connected, false);
  const records = files.filter(f => f.endsWith('.pane.json'));
  assert.equal(records.length, live ? 1 : 0);
  if (live) {
    const record = await readJson(join(stateDir, records[0]));
    assert.equal(record.ready, true);
    console.log(JSON.stringify({ status: 'passed', nativeLoader: true, nativeRpcBus: true, stateDir, stateFile, paneId: record.paneId }));
  } else console.log('PASS: installed Senpi loader + native RPC event bus + session isolation + listener cleanup');
} finally {
  bus.clear();
  if (!live) await rm(stateDir, { recursive: true, force: true });
}
