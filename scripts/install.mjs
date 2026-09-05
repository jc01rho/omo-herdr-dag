import { access, cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { languageOf, t } from '../src/i18n.mjs';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const agentDir = process.argv.includes('--agent-dir') ? resolve(process.argv[process.argv.indexOf('--agent-dir') + 1]) : join(homedir(), '.omo', 'agent');
const integration = join(agentDir, 'herdr-dag', 'integration');
const wrapper = join(agentDir, 'extensions', 'herdr-dag.js');
const marker = '// managed by omo-herdr-dag';
let savedLanguage;
try { savedLanguage = JSON.parse(await readFile(join(integration, 'locale.json'), 'utf8')).language; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const languageArg = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : undefined;
if (process.argv.includes('--lang') && !['en', 'ko'].includes(languageArg)) throw new Error('--lang must be en or ko.');
const language = languageArg ?? languageOf(savedLanguage);
try {
  const current = await readFile(wrapper, 'utf8');
  if (!current.startsWith(marker)) throw new Error(t(language, 'existingFile', { path: wrapper }));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const plan = { integration, extension: wrapper, source, entry: 'herdr-dag.js', language, activation: t(language, 'activation') };
if (process.argv.includes('--dry-run')) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
await mkdir(dirname(integration), { recursive: true, mode: 0o700 });
await mkdir(dirname(wrapper), { recursive: true, mode: 0o700 });
const stamp = `${Date.now()}-${process.pid}`;
const staged = `${integration}.stage-${stamp}`;
await mkdir(staged, { mode: 0o700 });
await cp(join(source, 'src'), join(staged, 'src'), { recursive: true });
await cp(join(source, 'extension.mjs'), join(staged, 'extension.mjs'));
await cp(join(source, 'LICENSE'), join(staged, 'LICENSE'));
await writeFile(join(staged, 'locale.json'), JSON.stringify({ language }) + '\n', { mode: 0o600 });
await writeFile(join(staged, '.installed-by'), marker, { mode: 0o600 });
let exists = false;
try { await access(integration); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (exists) {
  if ((await readFile(join(integration, '.installed-by'), 'utf8')) !== marker) throw new Error(t(language, 'unmanagedDirectory', { path: integration }));
  await rename(integration, `${integration}.backup-${stamp}`);
}
await rename(staged, integration);
const text = `${marker}\nexport { default } from '../herdr-dag/integration/extension.mjs';\n`;
await writeFile(`${wrapper}.tmp-${stamp}`, text, { mode: 0o600 });
await rename(`${wrapper}.tmp-${stamp}`, wrapper);
console.log(JSON.stringify({ installed: true, ...plan }, null, 2));
