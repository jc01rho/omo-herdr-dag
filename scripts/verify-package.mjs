import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'omo-dag-package-test-'));
const env = { ...process.env, npm_config_cache: join(temp, 'npm-cache'), npm_config_update_notifier: 'false' };
// npm run exports the user's global script allowlist as an environment option;
// npm 12 rejects that option for this isolated local install. Scripts stay disabled.
for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key];
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const run = (program, args, cwd = root) => {
  // npm.cmd cannot be passed to execFile on Windows. Invoke npm's JS entry
  // directly, preserving argv without introducing another command shell.
  const windowsNpm = process.platform === 'win32' && program === 'npm';
  return execFileSync(windowsNpm ? process.execPath : program, windowsNpm ? [npmCli, ...args] : args,
    { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
};
try {
  await readFile(join(root, 'dist/extension.mjs')); // Build explicitly before checking the artifact.
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const packResult = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp]));
  const packed = Array.isArray(packResult) ? packResult[0] : packResult[pkg.name]; // npm 12 keys results by package name.
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
  assert.deepEqual(JSON.parse(run(process.execPath, [...command, '--dry-run'], temp)), plan);
  assert.equal(plan.extension, join(agent, 'extensions/herdr-dag.js'));
  assert.equal(dirname(plan.integration), join(agent, 'herdr-dag/integration'));
  assert.equal(plan.language, 'en');
  assert.doesNotMatch(plan.activation, /[가-힣]/);
  await assert.rejects(readdir(agent), { code: 'ENOENT' });
  const result = JSON.parse(run(process.execPath, command, temp));
  assert.equal(result.installed, true);
  assert.equal(result.integration, plan.integration);
  assert.equal(JSON.parse(await readFile(join(result.integration, 'locale.json'), 'utf8')).language, 'en');
  assert.equal(await readFile(join(result.integration, 'LICENSE'), 'utf8'), await readFile(join(root, 'LICENSE'), 'utf8'));
  assert.equal(typeof (await import(pathToFileURL(result.extension))).default, 'function');
  const records = ['retained-state.json', 'retained-state.pane.json', 'retained-state.json.view.json'];
  for (const name of records) await writeFile(join(agent, 'herdr-dag', name), '{"preserve":true}');
  const updated = JSON.parse(run(process.execPath, command, temp));
  assert.notEqual(updated.integration, result.integration);
  assert.equal(updated.backup, result.integration);
  assert.equal(await readFile(join(updated.backup, 'extension.mjs'), 'utf8'), await readFile(join(result.source, 'extension.mjs'), 'utf8'));
  for (const name of records) assert.equal(await readFile(join(agent, 'herdr-dag', name), 'utf8'), '{"preserve":true}');
  assert.equal((await readdir(join(agent, 'herdr-dag/integration'))).filter(name => name.startsWith('generation-')).length, 2);
  const korean = JSON.parse(run(process.execPath, [...command, '--lang', 'ko'], temp));
  assert.equal(korean.language, 'ko');
  assert.match(korean.activation, /세션/);
  assert.equal(JSON.parse(run(process.execPath, [...command, '--dry-run'], temp)).language, 'ko');
  const english = JSON.parse(run(process.execPath, [...command, '--lang', 'en'], temp));
  assert.equal(JSON.parse(await readFile(join(english.integration, 'locale.json'), 'utf8')).language, 'en');
  assert.equal(JSON.parse(await readFile(join(korean.integration, 'locale.json'), 'utf8')).language, 'ko');
  // Exercise npm's executable discovery, the same mechanism used by npx.
  const output = run('npm', ['exec', '--offline', '--yes', '--prefix', consumer, '--', 'omo-herdr-dag', '--version'], consumer);
  assert.equal(output.trim(), pkg.version);
  console.log(`PASS: ${packed.filename} (${paths.size} files); offline npm install, CLI, deterministic dry-run, extension import, MIT notice, isolated generation updates/backups, retained runtime records, English default, Korean selection, and npm exec.`);
} catch (error) {
  if (error.stdout) console.error(String(error.stdout));
  if (error.stderr) console.error(String(error.stderr));
  throw error;
} finally {
  await rm(temp, { recursive: true, force: true });
}
