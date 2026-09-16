import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

export function shellCommand(args, platform = process.platform) {
  // Windows Herdr panes run PowerShell, where quoted executables need &.
  if (platform === 'win32') return `& ${args.map(value => `'${String(value).replaceAll("'", "''")}'`).join(' ')}`;
  return args.map(quote).join(' ');
}

function executableFile(path) {
  try { return statSync(path).isFile(); }
  catch { return false; }
}

export function resolveHerdrBin(env = process.env, platform = process.platform) {
  const explicit = env.HERDR_BIN_PATH?.trim();
  if (explicit && executableFile(explicit)) return explicit;
  const name = platform === 'win32' ? 'herdr.exe' : 'herdr';
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (executableFile(candidate)) return candidate;
  }
  return null;
}

export function herdrSession(env = process.env) {
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID || !env.HERDR_SOCKET_PATH) return false;
  if (!existsSync(env.HERDR_SOCKET_PATH)) return false;
  const explicit = env.HERDR_BIN_PATH?.trim();
  // A leftover HERDR_BIN_PATH such as `/path/herdr (deleted)` is not a live pane.
  if (explicit && !executableFile(explicit)) return false;
  return Boolean(resolveHerdrBin(env));
}

export function createHerdr(env = process.env) {
  return async (...args) => {
    const bin = resolveHerdrBin(env);
    if (!bin) throw new Error('Herdr is not available in this session');
    const { stdout } = await execute(bin, ['pane', ...args], { env, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
    // pane run acknowledges success with an empty body in Herdr protocol 20.
    if (!stdout.trim()) return {};
    const reply = JSON.parse(stdout);
    if (reply.error) throw new Error(reply.error.message ?? JSON.stringify(reply.error));
    return reply.result;
  };
}
