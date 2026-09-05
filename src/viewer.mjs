import { watch } from 'node:fs';
import { dirname, basename } from 'node:path';
import { readJson } from './storage.mjs';
import { render } from './render.mjs';
import { createHerdr } from './herdr.mjs';
import { t } from './i18n.mjs';

const file = process.argv[process.argv.indexOf('--state') + 1];
if (!process.argv.includes('--state') || !file) throw new Error('Usage: node viewer.mjs --state PATH');
let state = await readJson(file);
let selectedId = state?.runs?.[0]?.id;
let scroll = 0, error = '', timer, drawing = false, again = false;
const interactive = Boolean(process.stdout.isTTY && process.stdin.isTTY);
function draw() {
  let runIndex = state?.runs?.findIndex(run => run.id === selectedId) ?? 0;
  if (runIndex < 0) { runIndex = 0; selectedId = state?.runs?.[0]?.id; }
  const frame = render(state, { columns: process.stdout.columns ?? 54, rows: process.stdout.rows ?? 48, runIndex, scroll, color: interactive, error });
  process.stdout.write(interactive ? `\x1b[H${frame.replaceAll('\n', '\x1b[K\r\n')}\x1b[K` : `${frame}\n`);
}
async function refresh() {
  if (drawing) { again = true; return; }
  drawing = true;
  try {
    const next = await readJson(file);
    if (next) { state = next; error = ''; }
    else error = t(state?.language, 'stateMissing');
  } catch (cause) { error = cause.message; }
  draw(); drawing = false;
  if (again) { again = false; void refresh(); }
}
if (process.argv.includes('--once') || !interactive) { draw(); process.exit(0); }
process.stdout.write('\x1b[?1049h\x1b[?25l\x1b]0;OmO DAG\x07');
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
const watcher = watch(dirname(file), (_event, name) => {
  if (name && String(name) !== basename(file)) return;
  clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 40);
});
watcher.on('error', cause => { error = cause.message; draw(); });
const resize = () => draw();
process.stdout.on('resize', resize);
async function close(closePane = false) {
  clearTimeout(timer); watcher.close(); process.stdout.off('resize', resize);
  process.stdin.setRawMode(false);
  process.stdout.write('\x1b[?25h\x1b[?1049l');
  if (closePane && process.argv.includes('--close-pane')) {
    const pane = process.argv[process.argv.indexOf('--close-pane') + 1];
    try { await createHerdr()('close', pane); }
    catch (error) { process.stderr.write(`${t(state?.language, 'closeFailed', { error: error.message })}\n`); }
  }
  process.exit(0);
}
process.stdin.on('data', key => {
  if (key === 'q' || key === '\x03' || key === '\x04') return void close(true);
  if (key === '\x1b[B' || key === 'j') scroll++;
  if (key === '\x1b[A' || key === 'k') scroll = Math.max(0, scroll - 1);
  if (key === '\x1b[6~') scroll += Math.max(1, (process.stdout.rows ?? 48) - 8);
  if (key === '\x1b[5~') scroll = Math.max(0, scroll - Math.max(1, (process.stdout.rows ?? 48) - 8));
  if (key === '\x1b[C' || key === '\x1b[D') {
    const runs = state?.runs ?? [];
    const current = Math.max(0, runs.findIndex(run => run.id === selectedId));
    selectedId = runs[(current + (key === '\x1b[C' ? 1 : -1) + runs.length) % runs.length]?.id;
    scroll = 0;
  }
  draw();
});
process.on('SIGTERM', () => { void close(); }); process.on('SIGINT', () => { void close(); }); process.on('SIGHUP', () => { void close(); });
draw();
// Recover a replacement that raced with watcher registration.
void refresh();
