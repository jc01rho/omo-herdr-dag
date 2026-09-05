import { cp, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(root, '.dist-stage-'));
try {
  await cp(join(root, 'src'), join(stage, 'src'), { recursive: true });
  await cp(join(root, 'extension.mjs'), join(stage, 'extension.mjs'));
  await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'));
  await mkdir(join(stage, 'scripts'));
  await cp(join(root, 'scripts/install.mjs'), join(stage, 'scripts/install.mjs'));
  const files = await readdir(stage, { recursive: true });
  for (const file of files.filter(name => name.endsWith('.mjs'))) {
    execFileSync(process.execPath, ['--check', join(stage, file)], { stdio: 'pipe' });
  }
  execFileSync(process.execPath, ['--check', join(root, 'bin/omo-herdr-dag.mjs')], { stdio: 'pipe' });
  // Replace only the generated output after all source files pass syntax checks.
  await rm(join(root, 'dist'), { recursive: true, force: true });
  await rename(stage, join(root, 'dist'));
  console.log('Built dist/: extension, viewer, installer, and MIT license. JavaScript syntax checks passed.');
} finally {
  await rm(stage, { recursive: true, force: true });
}
