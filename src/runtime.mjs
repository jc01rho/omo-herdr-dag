import { execFile } from 'node:child_process';
import { basename, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { t } from './i18n.mjs';

const execute = promisify(execFile);
const probe = 'JSON.stringify({runtime:"omo-herdr-dag-node",version:process.versions.node,bun:!!process.versions.bun,path:process.execPath})';

export async function resolveViewerNode({ env = process.env, execPath = process.execPath, run = execute, language = 'en' } = {}) {
  const override = env.OMO_HERDR_DAG_NODE?.trim();
  // Compiled OmO/Bun executables cannot be used as general JavaScript interpreters.
  const candidates = override ? [override] : [
    ...(/^node(?:js)?(?:\.exe)?$/i.test(basename(execPath)) ? [execPath] : []),
    'node',
  ];
  for (const candidate of new Set(candidates)) {
    try {
      const { stdout } = await run(candidate, ['--eval', `console.log(${probe})`], {
        env, timeout: 5000, maxBuffer: 16384,
      });
      const result = JSON.parse(stdout.trim());
      if (result.runtime === 'omo-herdr-dag-node' && !result.bun &&
          /^\d+\.\d+\.\d+/.test(result.version) && Number(result.version.split('.')[0]) >= 24 &&
          typeof result.path === 'string' && isAbsolute(result.path)) return result.path;
    } catch { /* Try PATH when the host's Node is unavailable or unsupported. */ }
  }
  throw new Error(t(language, 'nodeUnavailable'));
}
