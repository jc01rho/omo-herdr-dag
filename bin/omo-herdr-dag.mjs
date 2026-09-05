#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const help = `omo-herdr-dag — install the OmO DAG viewer for Herdr

Usage:
  omo-herdr-dag install [--dry-run] [--agent-dir PATH] [--lang en|ko]
  omo-herdr-dag --help
  omo-herdr-dag --version

Install OmO and Herdr separately. After installation, start OmO in a
Herdr pane and run /reload in an existing session.
The first installation defaults to English. Updates keep the selected language.
`;

try {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(help);
  } else if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(pkg.version);
  } else {
    if (args[0] !== 'install') throw new Error(`Unknown command: ${args[0]}. Use --help.`);
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--dry-run') continue;
      if (args[i] === '--agent-dir') {
        if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--agent-dir requires a path.');
        i++;
      } else if (args[i] === '--lang') {
        if (!['en', 'ko'].includes(args[i + 1])) throw new Error('--lang must be en or ko.');
        i++;
      } else throw new Error(`Unknown option: ${args[i]}. Use --help.`);
    }
    await import('../dist/scripts/install.mjs');
  }
} catch (error) {
  console.error(`omo-herdr-dag: ${error.message}`);
  process.exitCode = 1;
}
