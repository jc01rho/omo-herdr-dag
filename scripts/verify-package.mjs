import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'omo-dag-package-test-'));
const env = { ...process.env, npm_config_cache: join(temp, 'npm-cache'), npm_config_update_notifier: 'false' };
const run = (program, args, cwd = root) => execFileSync(program, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await readFile(join(root, 'dist/extension.mjs')); // Build explicitly before checking the artifact.
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const [packed] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp]));
  const paths = new Set(packed.files.map(file => file.path));
  for (const path of ['package.json', 'LICENSE', 'bin/omo-herdr-dag.mjs', 'dist/extension.mjs', 'dist/LICENSE',
    'dist/src/viewer.mjs', 'dist/src/controller.mjs', 'dist/scripts/install.mjs', 'README.md', 'README_KO.md']) {
    assert.ok(paths.has(path), `Missing from npm tarball: ${path}`);
  }
  for (const path of paths) {
    assert.ok(!/^(test|\.github|\.git|\.omo|\.runtime|scripts|src)\//.test(path), `Unexpected package file: ${path}`);
    assert.ok(!path.endsWith('.pane.json'), `Runtime record in package: ${path}`);
  }
  const consumer = join(temp, 'consumer');
  run('npm', ['install', '--prefix', consumer, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(temp, packed.filename)]);
  const installed = join(consumer, 'node_modules', pkg.name);
  const cli = join(installed, 'bin/omo-herdr-dag.mjs');
  assert.match(run(process.execPath, [cli, '--help'], temp), /install \[--dry-run\]/);
  assert.equal(run(process.execPath, [cli, '--version'], temp).trim(), pkg.version);
  assert.throws(() => run(process.execPath, [cli, 'install', '--agent-dir'], temp));
  assert.throws(() => run(process.execPath, [cli, 'unknown'], temp));
  assert.throws(() => run(process.execPath, [cli, 'install', '--lang', 'de'], temp));
  const agent = join(temp, 'agent');
  const command = [cli, 'install', '--agent-dir', agent];
  const plan = JSON.parse(run(process.execPath, [...command, '--dry-run'], temp));
  assert.equal(plan.extension, join(agent, 'extensions/herdr-dag.js'));
  assert.equal(plan.language, 'en');
  assert.doesNotMatch(plan.activation, /[가-힣]/);
  await assert.rejects(readdir(agent), { code: 'ENOENT' });
  const result = JSON.parse(run(process.execPath, command, temp));
  assert.equal(result.installed, true);
  assert.equal(JSON.parse(await readFile(join(result.integration, 'locale.json'), 'utf8')).language, 'en');
  assert.equal(await readFile(join(result.integration, 'LICENSE'), 'utf8'), await readFile(join(root, 'LICENSE'), 'utf8'));
  assert.equal(typeof (await import(pathToFileURL(result.extension))).default, 'function');
  const state = join(agent, 'herdr-dag/retained-state.json');
  await writeFile(state, '{"preserve":true}');
  run(process.execPath, command, temp);
  assert.equal(await readFile(state, 'utf8'), '{"preserve":true}');
  assert.equal((await readdir(join(agent, 'herdr-dag'))).filter(name => name.startsWith('integration.backup-')).length, 1);
  const korean = JSON.parse(run(process.execPath, [...command, '--lang', 'ko'], temp));
  assert.equal(korean.language, 'ko');
  assert.match(korean.activation, /세션/);
  assert.equal(JSON.parse(run(process.execPath, [...command, '--dry-run'], temp)).language, 'ko');
  run(process.execPath, [...command, '--lang', 'en'], temp);
  assert.equal(JSON.parse(await readFile(join(result.integration, 'locale.json'), 'utf8')).language, 'en');
  // Exercise npm's executable discovery, the same mechanism used by npx.
  const output = run('npm', ['exec', '--offline', '--yes', '--prefix', consumer, '--', 'omo-herdr-dag', '--version'], consumer);
  assert.equal(output.trim(), pkg.version);
  console.log(`PASS: ${packed.filename} (${paths.size} files); offline npm install, CLI, dry-run, extension import, MIT notice, update, English default, Korean selection, and npm exec.`);
} catch (error) {
  if (error.stdout) console.error(String(error.stdout));
  if (error.stderr) console.error(String(error.stderr));
  throw error;
} finally {
  await rm(temp, { recursive: true, force: true });
}
