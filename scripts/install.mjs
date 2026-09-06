import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { languageOf, t } from '../src/i18n.mjs';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const agentDir = process.argv.includes('--agent-dir') ? resolve(process.argv[process.argv.indexOf('--agent-dir') + 1]) : join(homedir(), '.omo', 'agent');
const container = join(agentDir, 'herdr-dag', 'integration');
const wrapper = join(agentDir, 'extensions', 'herdr-dag.js');
const marker = '// managed by omo-herdr-dag';
async function optionalText(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return undefined; }
}
let entries;
try { entries = await readdir(container); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const currentText = await optionalText(join(container, 'current.json'));
const current = currentText === undefined ? undefined : JSON.parse(currentText).generation;
if (currentText !== undefined && (typeof current !== 'string' || !/^generation-\d+$/.test(current))) {
  throw new Error(`Invalid installation generation: ${container}`);
}
const previous = current ? join(container, current) : container;
let savedLanguage;
try { savedLanguage = JSON.parse(await readFile(join(previous, 'locale.json'), 'utf8')).language; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const languageArg = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : undefined;
if (process.argv.includes('--lang') && !['en', 'ko'].includes(languageArg)) throw new Error('--lang must be en or ko.');
const language = languageArg ?? languageOf(savedLanguage);
try {
  const current = await readFile(wrapper, 'utf8');
  if (!current.startsWith(marker)) throw new Error(t(language, 'existingFile', { path: wrapper }));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
if (entries && (await optionalText(join(container, '.installed-by'))) !== marker) {
  throw new Error(t(language, 'unmanagedDirectory', { path: container }));
}
// Retain each prior generation in place as the update backup. Every transitive
// module URL changes on reinstall; clearing Senpi's factory cache is insufficient.
const numbers = (entries ?? []).map(name => /^generation-(\d+)$/.exec(name)).filter(Boolean).map(match => Number(match[1]));
const generation = `generation-${String(Math.max(0, ...numbers) + 1).padStart(6, '0')}`;
const integration = join(container, generation);
const backup = entries ? (current ? previous : `${container}.backup-${generation}`) : undefined;
const plan = { integration, extension: wrapper, source, entry: 'herdr-dag.js', language,
  ...(backup ? { backup } : {}), activation: t(language, 'activation') };
if (process.argv.includes('--dry-run')) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
await mkdir(dirname(container), { recursive: true, mode: 0o700 });
await mkdir(dirname(wrapper), { recursive: true, mode: 0o700 });
const stamp = randomUUID();
const staged = `${container}.stage-${stamp}`;
await mkdir(staged, { mode: 0o700 });
try {
  await cp(join(source, 'src'), join(staged, 'src'), { recursive: true });
  await cp(join(source, 'extension.mjs'), join(staged, 'extension.mjs'));
  await cp(join(source, 'LICENSE'), join(staged, 'LICENSE'));
  await writeFile(join(staged, 'locale.json'), JSON.stringify({ language }) + '\n', { mode: 0o600 });
  await writeFile(join(staged, '.installed-by'), marker, { mode: 0o600 });
  // Migrate the original flat installation without touching sibling runtime files.
  if (entries && !current) await rename(container, backup);
  await mkdir(container, { recursive: true, mode: 0o700 });
  await writeFile(join(container, '.installed-by'), marker, { mode: 0o600 });
  await rename(staged, integration);
  await writeFile(join(container, `current.json.tmp-${stamp}`), JSON.stringify({ generation }) + '\n', { mode: 0o600 });
  await rename(join(container, `current.json.tmp-${stamp}`), join(container, 'current.json'));
  const text = `${marker}\nexport { default } from '../herdr-dag/integration/${generation}/extension.mjs';\n`;
  await writeFile(`${wrapper}.tmp-${stamp}`, text, { mode: 0o600 });
  await rename(`${wrapper}.tmp-${stamp}`, wrapper);
} finally {
  await rm(staged, { recursive: true, force: true });
}
console.log(JSON.stringify({ installed: true, ...plan }, null, 2));
