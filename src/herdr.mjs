import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
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

function findExecutable(name, env, platform) {
  const file = platform === 'win32' ? `${name}.exe` : name;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, file);
    if (executableFile(candidate)) return candidate;
  }
  return null;
}

// --- The `herdr` CLI (herdr.dev): the interface this extension was built for ---

export function resolveHerdrBin(env = process.env, platform = process.platform) {
  const explicit = env.HERDR_BIN_PATH?.trim();
  if (explicit && executableFile(explicit)) return explicit;
  return findExecutable('herdr', env, platform);
}

// --- The Herdr desktop app (`herdr-app` + `hc`): the interface on this machine ---

/** True when the terminal was started by the Herdr desktop app (herdr-core). */
export function isAppSession(env = process.env) {
  return Boolean(env.HC_TERMINAL_ID);
}

/** Resolve the `herdr-app` binary that drives the window. */
export function resolveAppBin(env = process.env, platform = process.platform) {
  const explicit = (env.HERDR_APP_BIN ?? env.HERDR_BIN_PATH)?.trim();
  if (explicit && executableFile(explicit)) return explicit;
  const onPath = findExecutable('herdr-app', env, platform);
  if (onPath) return onPath;
  if (platform === 'darwin') {
    for (const candidate of [
      '/Applications/Herdr.app/Contents/MacOS/Herdr',
      join(homedir(), 'Applications', 'Herdr.app', 'Contents', 'MacOS', 'Herdr'),
    ]) {
      if (executableFile(candidate)) return candidate;
    }
  }
  return null;
}

/** Resolve the `hc` (herdr-core) binary used to inspect terminals. */
export function resolveHcBin(env = process.env, platform = process.platform) {
  const explicit = env.HC_BIN?.trim();
  if (explicit && executableFile(explicit)) return explicit;
  return findExecutable('hc', env, platform);
}

export function herdrSession(env = process.env) {
  if (isAppSession(env)) {
    // Herdr desktop app: herdr-core exports HC_TERMINAL_ID/HC_TERMINAL_SOCKET.
    if (!env.HC_TERMINAL_SOCKET || !existsSync(env.HC_TERMINAL_SOCKET)) return false;
    return Boolean(resolveAppBin(env) && resolveHcBin(env));
  }
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID || !env.HERDR_SOCKET_PATH) return false;
  if (!existsSync(env.HERDR_SOCKET_PATH)) return false;
  const explicit = env.HERDR_BIN_PATH?.trim();
  // A leftover HERDR_BIN_PATH such as `/path/herdr (deleted)` is not a live pane.
  if (explicit && !executableFile(explicit)) return false;
  return Boolean(resolveHerdrBin(env));
}

export function createHerdr(env = process.env) {
  if (isAppSession(env)) return createHerdrApp(env);
  const call = createLegacyCall(env);
  return async (...args) => {
    const [verb, ...rest] = args;
    if (verb === 'open') return legacyOpen(call, rest[0]);
    return call(...args);
  };
}

function createLegacyCall(env) {
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

// A single `open` verb: split the parent pane and start the viewer in it, keeping focus.
async function legacyOpen(call, spec = {}) {
  const direction = spec.direction ?? 'right';
  const splitArgs = ['split', '--direction', direction];
  if (spec.pane) splitArgs.push('--pane', spec.pane);
  if (spec.ratio != null) splitArgs.push('--ratio', String(spec.ratio));
  if (spec.cwd) splitArgs.push('--cwd', spec.cwd);
  splitArgs.push('--no-focus');
  const result = await call(...splitArgs);
  const paneId = result?.pane?.pane_id;
  if (!paneId) throw new Error('Herdr did not report a new pane id');
  if (spec.title) await call('rename', paneId, spec.title);
  const argv = [...(spec.argv ?? []), '--close-pane', paneId];
  await call('run', paneId, shellCommand(argv));
  return { pane: { pane_id: paneId } };
}

/** Adapter for the Herdr desktop app: `herdr pane …` mapped to `herdr-app do …` + `hc`. */
export function createHerdrApp(env = process.env) {
  const appBin = () => resolveAppBin(env);
  const hcBin = () => resolveHcBin(env);
  const names = new Map();     // terminal id -> title we set
  const paneOf = new Map();    // terminal id -> real pane id

  async function run(bin, argv, timeout = 15000) {
    if (!bin) throw new Error('Herdr is not available in this session');
    try {
      const { stdout } = await execute(bin, argv, { env, timeout, maxBuffer: 4 * 1024 * 1024 });
      return { stdout: stdout ?? '', stderr: '' };
    } catch (error) {
      const stdout = error.stdout ?? '';
      const stderr = error.stderr ?? '';
      const text = `${stdout} ${stderr}`.trim();
      let message = text || error.message;
      try {
        const parsed = JSON.parse(text);
        const detail = parsed?.error;
        if (detail) message = typeof detail === 'string' ? detail : (detail.message ?? JSON.stringify(detail));
      } catch { /* keep the raw text */ }
      const wrapped = new Error(message);
      wrapped.stdout = stdout;
      wrapped.stderr = stderr;
      throw wrapped;
    }
  }

  async function appDo(command, args = {}) {
    const { stdout } = await run(appBin(), ['do', command, JSON.stringify(args)]);
    const text = stdout.trim();
    if (!text) return {};
    const reply = JSON.parse(text);
    if (reply?.error) throw new Error(typeof reply.error === 'string' ? reply.error : JSON.stringify(reply.error));
    return reply;
  }

  async function appLs() {
    const { stdout } = await run(appBin(), ['ls'], 10000);
    return JSON.parse(stdout);
  }

  async function hcGet(terminal) {
    const bin = hcBin();
    if (!bin) return null;
    try {
      const { stdout } = await run(bin, ['get', terminal, '--json'], 10000);
      return JSON.parse(stdout);
    } catch { return null; }
  }

  function flatten(ls) {
    const rows = [];
    for (const space of ls.spaces ?? []) {
      for (const tab of space.tabs ?? []) {
        for (const term of tab.terminals ?? []) {
          rows.push({ space_id: space.id, tab_id: tab.id, terminal: term.terminal, pane: term.pane, name: term.name, status: term.status, app: term.app });
        }
      }
    }
    return rows;
  }

  async function freshRows() {
    return flatten(await appLs());
  }

  async function resolveRealPane(id, rows = null) {
    if (!id) return null;
    if (typeof id === 'string' && /^p[0-9a-f]{20,}$/.test(id)) return id;
    const list = rows ?? (await freshRows());
    const hit = list.find(row => row.terminal === id || row.pane === id);
    if (hit) { paneOf.set(hit.terminal, hit.pane); return hit.pane; }
    return paneOf.get(id) ?? null;
  }

  function isViewerArgv(argv) {
    return Array.isArray(argv) && argv.some(value =>
      typeof value === 'string' && (value.endsWith('viewer.mjs') || value.includes('omo-herdr-dag')));
  }

  async function listPanes() {
    const rows = await freshRows();
    const panes = [];
    for (const row of rows) {
      let label = names.get(row.terminal) ?? row.name ?? null;
      // The app does not reflect pane.rename() in `ls`; recover the title from the viewer's argv.
      if (!label) {
        const info = await hcGet(row.terminal);
        if (info && (isViewerArgv(info.argv) || isViewerArgv(info.foreground?.argv))) label = 'DAG ·';
      }
      panes.push({
        pane_id: row.terminal,
        tab_id: row.tab_id,
        label,
        terminal_title: label,
        terminal_title_stripped: label,
        app: row.app,
        status: row.status,
      });
    }
    return { panes };
  }

  return async (...args) => {
    const [verb, ...rest] = args;
    switch (verb) {
      case 'list':
        return listPanes();

      case 'open': {
        const spec = rest[0] ?? {};
        const rows = await freshRows();
        const parentReal = await resolveRealPane(spec.pane, rows);
        const splitArgs = { direction: spec.direction ?? 'right' };
        if (parentReal) splitArgs.pane = parentReal;
        if (spec.argv) splitArgs.argv = spec.argv;
        const split = await appDo('pane.split', splitArgs);
        const pane = split.pane;
        const terminal = split.terminal;
        if (!terminal) throw new Error('Herdr did not report a new pane id');
        if (pane) paneOf.set(terminal, pane);
        if (spec.title && pane) {
          names.set(terminal, spec.title);
          try { await appDo('pane.rename', { pane, name: spec.title }); } catch { /* the title is cosmetic */ }
        }
        // pane.split() moves pane focus; keep the person in the pane they were in.
        if (parentReal) {
          try { await appDo('pane.focus', { pane: parentReal }); } catch { /* best effort */ }
        }
        return { pane: { pane_id: terminal } };
      }

      case 'get': {
        const id = rest[0];
        const real = await resolveRealPane(id);
        if (!real) throw new Error(`pane_not_found: ${id}`);
        return { pane: { pane_id: id, pane: real } };
      }

      case 'close': {
        const id = rest[0];
        const real = await resolveRealPane(id);
        if (!real) return {};
        try {
          await appDo('pane.close', { pane: real });
        } catch (error) {
          if (!/not found|unknown pane|no such pane|no pane/i.test(error.message)) throw error;
        }
        if (typeof id === 'string') { names.delete(id); paneOf.delete(id); }
        return {};
      }

      default:
        throw new Error(`Unsupported Herdr operation: ${verb}`);
    }
  };
}
