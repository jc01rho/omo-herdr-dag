import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marker = '// managed by omo-herdr-dag';
async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), 'omo-install-reload-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = join(temp, 'source'), agent = join(temp, 'agent');
  await mkdir(join(source, 'scripts'), { recursive: true });
  await cp(join(root, 'scripts/install.mjs'), join(source, 'scripts/install.mjs'));
  await cp(join(root, 'src'), join(source, 'src'), { recursive: true });
  await cp(join(root, 'LICENSE'), join(source, 'LICENSE'));
  await writeFile(join(source, 'extension.mjs'), "import {version} from './src/probe.mjs';\nexport default pi => pi.registerCommand('probe', {description: String(version), handler: async () => {}});\n");
  await writeFile(join(source, 'src/probe.mjs'), 'export const version = 1;\n');
  const install = (...args) => JSON.parse(execFileSync(process.execPath,
    [join(source, 'scripts/install.mjs'), '--agent-dir', agent, ...args], { encoding: 'utf8' }));
  return { temp, source, agent, install };
}

test('each install has unique dependency paths, with retained generations, locale and stable runtime records', async t => {
  const { agent, source, install } = await fixture(t);
  const first = install('--lang', 'ko');
  const stateRoot = join(agent, 'herdr-dag');
  for (const name of ['session.json', 'session.pane.json', 'session.json.view.json']) {
    await writeFile(join(stateRoot, name), JSON.stringify({ retained: name }));
  }
  await writeFile(join(source, 'src/probe.mjs'), 'export const version = 2;\n');
  const before = await readdir(stateRoot, { recursive: true });
  const dry = install('--dry-run');
  assert.deepEqual(install('--dry-run'), dry);
  assert.deepEqual(await readdir(stateRoot, { recursive: true }), before);
  const second = install();
  assert.notEqual(first.integration, second.integration);
  assert.equal(dirname(first.integration), join(stateRoot, 'integration'));
  assert.equal(dirname(second.integration), dirname(first.integration));
  assert.equal(dry.integration, second.integration);
  assert.equal(second.language, 'ko');
  assert.equal(JSON.parse(await readFile(join(second.integration, 'locale.json'), 'utf8')).language, 'ko');
  assert.equal(await readFile(join(first.integration, 'src/probe.mjs'), 'utf8'), 'export const version = 1;\n');
  assert.equal(await readFile(join(second.integration, 'src/probe.mjs'), 'utf8'), 'export const version = 2;\n');
  assert.equal(second.backup, first.integration);
  for (const name of ['session.json', 'session.pane.json', 'session.json.view.json']) {
    assert.deepEqual(JSON.parse(await readFile(join(stateRoot, name), 'utf8')), { retained: name });
  }
  const english = install('--lang', 'en');
  assert.equal(english.language, 'en');
  assert.equal(install('--dry-run').language, 'en');
});

test('dry-run on a new agent is deterministic and creates nothing', async t => {
  const { agent, install } = await fixture(t);
  assert.deepEqual(install('--dry-run'), install('--dry-run'));
  await assert.rejects(readdir(agent), { code: 'ENOENT' });
});

test('legacy flat installation migrates with its language, managed marker and update backup intact', async t => {
  const { agent, source, install } = await fixture(t);
  const legacy = join(agent, 'herdr-dag', 'integration');
  const wrapper = join(agent, 'extensions', 'herdr-dag.js');
  await mkdir(legacy, { recursive: true });
  await mkdir(dirname(wrapper), { recursive: true });
  await writeFile(join(legacy, '.installed-by'), marker);
  await writeFile(join(legacy, 'locale.json'), '{"language":"ko"}\n');
  await writeFile(join(legacy, 'extension.mjs'), 'export default () => {};\n');
  await writeFile(wrapper, `${marker}\nexport { default } from '../herdr-dag/integration/extension.mjs';\n`);
  const result = install();
  assert.equal(dirname(result.integration), legacy);
  assert.equal(result.language, 'ko');
  assert.equal(await readFile(join(result.integration, '.installed-by'), 'utf8'), marker);
  assert.equal(await readFile(join(result.integration, 'LICENSE'), 'utf8'), await readFile(join(source, 'LICENSE'), 'utf8'));
  assert.equal(await readFile(join(result.backup, 'extension.mjs'), 'utf8'), 'export default () => {};\n');
  assert.equal(JSON.parse(await readFile(join(result.backup, 'locale.json'), 'utf8')).language, 'ko');
  assert.ok((await readFile(wrapper, 'utf8')).startsWith(marker));
});

test('unmanaged integration and wrapper are rejected without changing them', async t => {
  const { agent, install } = await fixture(t);
  const integration = join(agent, 'herdr-dag', 'integration');
  await mkdir(integration, { recursive: true });
  await writeFile(join(integration, '.installed-by'), 'foreign');
  assert.throws(() => install());
  assert.equal(await readFile(join(integration, '.installed-by'), 'utf8'), 'foreign');
  assert.deepEqual(await readdir(integration), ['.installed-by']);
  const wrapper = join(agent, 'extensions', 'herdr-dag.js');
  await mkdir(dirname(wrapper), { recursive: true });
  await writeFile(wrapper, 'export default () => {};\n');
  assert.throws(() => install('--dry-run'));
  assert.equal(await readFile(wrapper, 'utf8'), 'export default () => {};\n');
});

// Explicit integration target; the ordinary package tests do not require OmO or Bun.
// OMO_TEST_SENPI_ROOT=/path/to/omo-ai OMO_TEST_BUN=/path/to/bun node --test test/install-reload.test.mjs
if (process.env.OMO_TEST_SENPI_ROOT) test('real Bun Senpi loader sees changed transitive code after reinstall in the same process', async t => {
  const { source, agent } = await fixture(t);
  const probe = async () => {
    const assert = (await import('node:assert/strict')).default;
    const { execFileSync } = await import('node:child_process');
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const { loadExtensions, clearExtensionCache } = await import(pathToFileURL(join(process.env.OMO_TEST_SENPI_ROOT,
      'node_modules/@code-yeongyu/senpi/dist/core/extensions/loader.js')));
    const source = process.env.PROBE_SOURCE, agent = process.env.PROBE_AGENT;
    const install = () => JSON.parse(execFileSync(process.execPath,
      [join(source, 'scripts/install.mjs'), '--agent-dir', agent], { encoding: 'utf8' }));
    async function load(wrapper) {
      const result = await loadExtensions([wrapper], source);
      assert.deepEqual(result.errors, []);
      return result.extensions[0].commands.get('probe').description;
    }
    const first = install();
    assert.equal(await load(first.extension), '1');
    await writeFile(join(source, 'src/probe.mjs'), 'export const version = 2;\n');
    const second = install();
    clearExtensionCache();
    const afterReload = await load(second.extension);
    assert.equal(afterReload, '2');
    assert.notEqual(first.integration, second.integration);
    console.log(JSON.stringify({ first: first.integration, second: second.integration, afterReload }));
  };
  const output = execFileSync(process.env.OMO_TEST_BUN ?? 'bun', ['--eval', `(${probe.toString()})()`],
    { env: { ...process.env, PROBE_SOURCE: source, PROBE_AGENT: agent }, encoding: 'utf8', timeout: 20000 });
  assert.equal(JSON.parse(output).afterReload, '2');
});
