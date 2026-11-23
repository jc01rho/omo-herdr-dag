import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chmodSync } from 'node:fs';
import { createHerdr, createHerdrApp, herdrSession, isAppSession, quote, resolveAppBin, resolveHerdrBin, shellCommand } from '../src/herdr.mjs';

test('POSIX shell command preserves apostrophes and shell metacharacters', () => {
  // Given literal shell-sensitive argv, including an empty value.
  const args = ['/opt/node path/node', "/tmp/owner's/viewer.mjs", '$HOME; & `echo`', ''];
  // When the builder targets a POSIX pane, execute its actual quoting in Bash.
  const command = shellCommand(args, 'linux');
  const output = execFileSync('bash', ['-c', `printf '%s${String.fromCharCode(92)}0' ${command}`], { encoding: 'utf8', timeout: 10000 });
  // Then the original quoting contract and literal argv survive.
  assert.equal(command, args.map(quote).join(' '));
  assert.deepEqual(output.split(String.fromCharCode(0)).slice(0, -1), args);
});

test('Herdr adapter uses the supplied executable even when Herdr is absent from PATH', async t => {
  // Given a real executable probe, with no PATH lookup available.
  const directory = await mkdtemp(join(tmpdir(), 'herdr-binary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'pane'), 'console.log(JSON.stringify({result:{argv:process.argv.slice(2)}}));');
  const module = new URL('../src/herdr.mjs', import.meta.url).href;
  // When createHerdr invokes the configured executable with the pane arguments.
  const code = `const {createHerdr} = await import(${JSON.stringify(module)}); console.log(JSON.stringify(await createHerdr()('get','test:pane')));`;
  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', code], {
    cwd: directory, env: { PATH: '', HERDR_BIN_PATH: process.execPath }, encoding: 'utf8', timeout: 10000 });
  // Then the real child process receives the explicit pane operation.
  assert.deepEqual(JSON.parse(output), { argv: ['get', 'test:pane'] });
});

test('resolveHerdrBin ignores a deleted HERDR_BIN_PATH and uses PATH', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-path-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stub = join(directory, 'herdr');
  await writeFile(stub, '#!/bin/sh\nexit 0\n');
  chmodSync(stub, 0o755);
  assert.equal(resolveHerdrBin({ HERDR_BIN_PATH: `${stub} (deleted)`, PATH: directory }), stub);
  assert.equal(resolveHerdrBin({ HERDR_BIN_PATH: join(directory, 'missing'), PATH: directory }), stub);
  assert.equal(resolveHerdrBin({ PATH: '' }), null);
});

test('herdrSession requires env, a live socket, and a real herdr binary', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-session-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stub = join(directory, 'herdr');
  await writeFile(stub, '#!/bin/sh\nexit 0\n');
  chmodSync(stub, 0o755);
  const socket = join(directory, 'herdr.sock');
  const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', HERDR_SOCKET_PATH: socket, PATH: directory };
  assert.equal(herdrSession(env), false);
  await writeFile(socket, '');
  assert.equal(herdrSession(env), true);
  assert.equal(herdrSession({ ...env, HERDR_BIN_PATH: stub }), true);
  assert.equal(herdrSession({ ...env, HERDR_BIN_PATH: `${stub} (deleted)` }), false);
  assert.equal(herdrSession({ ...env, HERDR_ENV: '0' }), false);
  assert.equal(herdrSession({ ...env, HERDR_PANE_ID: '' }), false);
  assert.equal(herdrSession({ ...env, PATH: '' }), false);
});

test('createHerdr falls back to PATH when HERDR_BIN_PATH is a deleted path', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-fallback-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'herdr'), `#!${process.execPath}\nconsole.log(JSON.stringify({result:{argv:process.argv.slice(2)}}));\n`);
  chmodSync(join(directory, 'herdr'), 0o755);
  const herdr = createHerdr({ PATH: directory, HERDR_BIN_PATH: join(directory, 'herdr (deleted)') });
  assert.deepEqual(await herdr('get', 'test:pane'), { argv: ['pane', 'get', 'test:pane'] });
});

test('createHerdr refuses to spawn when no herdr binary exists', async t => {
  const herdr = createHerdr({ PATH: '', HERDR_BIN_PATH: '/no/such/herdr (deleted)' });
  await assert.rejects(herdr('list'), /Herdr is not available in this session/);
});

// Stub the Herdr desktop app (`herdr-app`) and the core CLI (`hc`) so the adapter
// can be exercised without a live window. The stubs log every invocation.
async function appWorld(t) {
  const directory = await mkdtemp(join(tmpdir(), 'herdr-app-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, 'calls.log');
  await writeFile(log, '');
  const app = join(directory, 'herdr-app');
  await writeFile(app, `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.APP_LOG, JSON.stringify(['app', ...args]) + '\\n');
if (args[0] === 'ls') {
  console.log(JSON.stringify({ spaces: [{ id: 'sp1', tabs: [{ id: 'tb1', terminals: [
    { terminal: 't7', pane: 'pREALt7', status: 'working', app: 'opencode', name: null },
    { terminal: 't18', pane: 'pREALt18', status: null, app: null, name: null },
    { terminal: 't9', pane: 'pREALt9', status: null, app: null, name: 'DAG · old' }
  ] }] }] }));
} else if (args[0] === 'do') {
  if (args[1] === 'pane.split') console.log(JSON.stringify({ pane: 'pREALnew', terminal: 'tNEW' }));
  else console.log(JSON.stringify({ ok: true }));
} else console.log('{}');
`);
  const hc = join(directory, 'hc');
  await writeFile(hc, `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.APP_LOG, JSON.stringify(['hc', ...args]) + '\\n');
const map = { t7: { address: 't7', argv: ['opencode'] },
  t18: { address: 't18', argv: ['/usr/bin/node', '/tmp/viewer.mjs', '--state', 'x'] } };
console.log(JSON.stringify(map[args[1]] ?? null));
`);
  chmodSync(app, 0o755);
  chmodSync(hc, 0o755);
  const env = { PATH: process.env.PATH, HC_TERMINAL_ID: 't7', HC_TERMINAL_SOCKET: join(directory, 'hc.sock'),
    HERDR_APP_BIN: app, HC_BIN: hc, APP_LOG: log };
  return { directory, log, env };
}

const readCalls = async log => (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));

test('herdrSession recognises the Herdr desktop app (herdr-core) environment', async t => {
  const { env } = await appWorld(t);
  assert.equal(isAppSession(env), true);
  assert.equal(herdrSession(env), false);                               // the socket is not live yet
  await writeFile(env.HC_TERMINAL_SOCKET, '');
  assert.equal(herdrSession(env), true);
  assert.equal(herdrSession({ ...env, HC_TERMINAL_ID: '' }), false);    // and it is not a legacy `herdr` session
  assert.equal(resolveAppBin({ PATH: '', HC_TERMINAL_ID: 't7' }, 'linux'), null);
});

test('the Herdr desktop adapter lists, opens, resolves and closes panes through herdr-app and hc', async t => {
  const { log, env } = await appWorld(t);
  const herdr = createHerdrApp(env);

  // list: a viewer is recognised from its argv even when the app does not surface its name.
  const listed = await herdr('list');
  assert.equal(listed.panes.find(pane => pane.pane_id === 't18').label, 'DAG ·');
  assert.equal(listed.panes.find(pane => pane.pane_id === 't18').tab_id, 'tb1');
  assert.equal(listed.panes.find(pane => pane.pane_id === 't9').label, 'DAG · old');
  assert.equal(listed.panes.find(pane => pane.pane_id === 't7').label, null);

  // open: one split carrying the viewer argv, renamed, with focus returned to the parent.
  const opened = await herdr('open', { pane: 't7', direction: 'right', title: 'DAG · abcd1234',
    argv: ['/usr/bin/node', '/tmp/viewer.mjs', '--state', '/tmp/state.json'] });
  assert.deepEqual(opened, { pane: { pane_id: 'tNEW' } });
  const calls = await readCalls(log);
  const split = JSON.parse(calls.find(call => call[0] === 'app' && call[1] === 'do' && call[2] === 'pane.split')[3]);
  assert.equal(split.direction, 'right');
  assert.equal(split.pane, 'pREALt7');
  assert.ok(split.argv.includes('/tmp/viewer.mjs'));
  assert.equal(JSON.parse(calls.find(call => call[0] === 'app' && call[2] === 'pane.rename')[3]).name, 'DAG · abcd1234');
  assert.equal(JSON.parse(calls.find(call => call[0] === 'app' && call[2] === 'pane.focus')[3]).pane, 'pREALt7');

  // get: resolves a terminal address and reports a missing pane as pane_not_found.
  assert.equal((await herdr('get', 't7')).pane.pane_id, 't7');
  await assert.rejects(herdr('get', 't404'), /pane_not_found/);

  // close: resolves the terminal to its real pane and asks the app to close it.
  await herdr('close', 't18');
  const close = JSON.parse((await readCalls(log)).find(call => call[0] === 'app' && call[2] === 'pane.close')[3]);
  assert.equal(close.pane, 'pREALt18');

  // createHerdr picks the app adapter whenever the core identity is present.
  assert.ok((await createHerdr(env)('list')).panes.length >= 3);
});
