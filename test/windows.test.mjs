import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createHerdr } from '../src/herdr.mjs';

for (const suffix of ['plain space ', "owner's space "]) {
  test(`the legacy herdr adapter opens the viewer with literal ${suffix}paths in the host shell`, async t => {
    // Given a stub `herdr` on disk and the adapter's process transport intercepted in memory.
    const directory = await mkdtemp(join(tmpdir(), `herdr-${suffix}`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const viewer = join(directory, 'viewer.mjs');
    await writeFile(viewer, 'console.log(JSON.stringify(process.argv.slice(2)));');
    const stub = join(directory, 'herdr');
    // The transport is injected, so the file only has to resolve on disk: no shebang, mode
    // bit or `.exe` suffix is needed, which is what kept this fixture off Windows.
    await writeFile(stub, '');
    const stateFile = join(directory, 'state.json');
    const env = { PATH: process.env.PATH, HERDR_ENV: '1', HERDR_PANE_ID: 'test:p1',
      HERDR_SOCKET_PATH: join(directory, 'herdr.sock'), HERDR_BIN_PATH: stub };
    const calls = [];
    const execute = async (file, args) => {
      calls.push(args);
      return args[1] === 'split'
        ? { stdout: JSON.stringify({ result: { pane: { pane_id: 'test:p2' } } }), stderr: '' }
        : { stdout: '', stderr: '' };
    };
    // When the adapter opens a pane with the viewer argv.
    const result = await createHerdr(env, { execute })('open', { pane: 'test:p1', direction: 'right', ratio: 0.65,
      cwd: directory, title: 'DAG · test', argv: [process.execPath, viewer, '--state', stateFile] });
    assert.equal(result.pane.pane_id, 'test:p2');
    // Then the composed run command preserves the viewer argv, including apostrophes.
    const run = calls.find(args => args[1] === 'run');
    assert.ok(run, 'pane run was invoked');
    const command = run[3];
    const output = process.platform === 'win32'
      ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 10000 })
      : execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8', timeout: 10000 });
    assert.deepEqual(JSON.parse(output), ['--state', stateFile, '--close-pane', 'test:p2']);
  });
}

for (const primary of ['OMO_CODING_AGENT_DIR', 'SENPI_CODING_AGENT_DIR']) {
  test(`installer defaults to ${primary} and explicit agent directory takes precedence`, async t => {
    // Given distinct active OmO, Senpi, and explicit extension roots.
    const directory = await mkdtemp(join(tmpdir(), 'herdr-agent-dir-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const active = join(directory, "active owner's root"), explicit = join(directory, 'explicit');
    const env = { ...process.env, HOME: directory, USERPROFILE: directory,
      OMO_CODING_AGENT_DIR: '', SENPI_CODING_AGENT_DIR: join(directory, 'senpi') };
    env[primary] = active;
    const install = (...args) => JSON.parse(execFileSync(process.execPath,
      [fileURLToPath(new URL('../scripts/install.mjs', import.meta.url)), ...args], { env, encoding: 'utf8' }));
    // When installed with the ambient root and an explicit override.
    const selected = install('--dry-run');
    const overridden = install('--agent-dir', explicit);
    // Then both entrypoints are in the directories actually discovered by OmO.
    assert.equal(selected.extension, join(active, 'extensions', 'omo-herdr-dag.js'));
    assert.equal(overridden.extension, join(explicit, 'extensions', 'omo-herdr-dag.js'));
    assert.equal(install().extension, selected.extension);
  });
}
