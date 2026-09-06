import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { shellCommand, quote } from '../src/herdr.mjs';

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
    cwd: directory, env: { ...process.env, PATH: '', HERDR_BIN_PATH: process.execPath }, encoding: 'utf8', timeout: 10000 });
  // Then the real child process receives the explicit pane operation.
  assert.deepEqual(JSON.parse(output), { argv: ['get', 'test:pane'] });
});
