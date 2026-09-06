import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DagPane } from '../src/controller.mjs';

for (const suffix of ['plain space ', "owner's space "]) {
  test(`controller invokes viewer with literal ${suffix} paths in the host shell`, async t => {
    // Given an isolated probe, including executable and argument paths with spaces.
    const directory = await mkdtemp(join(tmpdir(), `herdr-${suffix}`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const viewer = join(directory, 'viewer.mjs');
    await writeFile(viewer, 'console.log(JSON.stringify(process.argv.slice(2)));');
    const paneId = 'test:p2';
    let output;
    const pane = new DagPane({ sessionId: 'test', parentPane: 'test:p1', socket: 'test',
      stateDir: directory, cwd: directory, node: process.execPath, viewer,
      herdr: async (action, ...args) => {
        if (action === 'split') return { pane: { pane_id: paneId } };
        if (action === 'run') {
          assert.equal(args[0], paneId);
          output = process.platform === 'win32'
            ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
              Buffer.from(args[1], 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 10000 })
            : execFileSync('/bin/sh', ['-c', args[1]], { encoding: 'utf8', timeout: 10000 });
        }
        return {};
      } });
    t.after(() => pane.stop());
    // When the real controller opens its viewer, execute the actual run command.
    await pane.open();
    // Then the shell preserves the viewer argv, including apostrophes.
    assert.deepEqual(JSON.parse(output), ['--state', pane.stateFile, '--close-pane', paneId]);
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
    assert.equal(selected.extension, join(active, 'extensions', 'herdr-dag.js'));
    assert.equal(overridden.extension, join(explicit, 'extensions', 'herdr-dag.js'));
    assert.equal(install().extension, selected.extension);
  });
}
