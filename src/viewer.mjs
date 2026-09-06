import { watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { createHerdr } from './herdr.mjs';
import { t } from './i18n.mjs';
import { renderFrame, standaloneTasks } from './render.mjs';
import { readJson } from './storage.mjs';
import { TASK_SCOPE, emptyViewState, isExpanded, loadViewState, saveViewState, setExpanded } from './view-state.mjs';

const file = process.argv[process.argv.indexOf('--state') + 1];
if (!process.argv.includes('--state') || !file) throw new Error('Usage: node viewer.mjs --state PATH');
let state = await readJson(file);
let selectedId = state?.runs?.[0]?.id;
let view = state?.runs?.length ? 'dag' : 'tasks', selectedTaskId;
let scroll = 0, error = '', timer, drawing = false, again = false;
let viewState = emptyViewState(state?.sessionId), viewError = '', saving = Promise.resolve(), closing = false;
const selectedNodes = new Map();
let revealSelection = false;
async function restorePreferences() {
  try { viewState = await loadViewState(file, state?.sessionId); viewError = ''; }
  catch (cause) { viewState = emptyViewState(state?.sessionId); viewError = cause.message; }
}
await restorePreferences();
const interactive = Boolean(process.stdout.isTTY && process.stdin.isTTY);
function draw() {
  if (closing) return;
  let runIndex = state?.runs?.findIndex(run => run.id === selectedId) ?? 0;
  if (runIndex < 0) { runIndex = 0; selectedId = state?.runs?.[0]?.id; }
  const run = state?.runs?.[runIndex];
  if (!state?.runs?.length) view = 'tasks';
  const roots = standaloneTasks(state);
  if (!roots.some(task => task.id === selectedTaskId)) selectedTaskId = roots[0]?.id;
  if (!run?.nodes.some(node => node.id === selectedNodes.get(selectedId))) selectedNodes.set(selectedId, run?.nodes[0]?.id);
  const result = renderFrame(state, { columns: process.stdout.columns ?? 54, rows: process.stdout.rows ?? 48, runIndex, scroll, color: interactive,
    error, notice: viewError ? t(state?.language, 'viewError', { error: viewError }) : '',
    selectedNodeId: selectedNodes.get(selectedId), selectedTaskId, view, viewState, revealSelection });
  scroll = result.scroll;
  const frame = result.text;
  process.stdout.write(interactive ? `\x1b[H${frame.replaceAll('\n', '\x1b[K\r\n')}\x1b[K` : `${frame}\n`);
}
async function refresh() {
  if (drawing) { again = true; return; }
  drawing = true;
  try {
    const next = await readJson(file);
    if (next) {
      const sessionChanged = next.sessionId !== state?.sessionId;
      state = next; error = '';
      if (sessionChanged) {
        await saving; selectedNodes.clear(); selectedTaskId = undefined; scroll = 0;
        view = state?.runs?.length ? 'dag' : 'tasks';
        await restorePreferences();
      }
    }
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
emitKeypressEvents(process.stdin);
const watcher = watch(dirname(file), (_event, name) => {
  if (name && String(name) !== basename(file)) return;
  clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 40);
});
watcher.on('error', cause => { error = cause.message; draw(); });
const resize = () => draw();
process.stdout.on('resize', resize);
// Advance only the display clock. Snapshot reads remain driven by fs.watch.
const clock = setInterval(() => {
  if (state?.connected && (state.tasks?.some(task => task.status === 'running') ||
      state.runs?.some(run => run.nodes.some(node => node.state === 'running')))) draw();
}, 1000);
async function close(closePane = false) {
  if (closing) return;
  closing = true;
  clearTimeout(timer); clearInterval(clock); watcher.close(); process.stdout.off('resize', resize);
  await saving;
  process.stdin.setRawMode(false);
  process.stdout.write('\x1b[?25h\x1b[?1049l');
  if (viewError) process.stderr.write(`${t(state?.language, 'viewError', { error: viewError })}\n`);
  if (closePane && process.argv.includes('--close-pane')) {
    const pane = process.argv[process.argv.indexOf('--close-pane') + 1];
    try { await createHerdr()('close', pane); }
    catch (error) { process.stderr.write(`${t(state?.language, 'closeFailed', { error: error.message })}\n`); }
  }
  process.exit(0);
}
process.stdin.on('keypress', (_text, pressed) => {
  if (closing) return;
  const key = pressed.sequence;
  if (key === 'q' || key === '\x03' || key === '\x04') return void close(true);
  if (['\x1b[B', 'j', '\x1b[A', 'k', '\x1b[6~', '\x1b[5~'].includes(key)) revealSelection = false;
  if (key === '\x1b[B' || key === 'j') scroll++;
  if (key === '\x1b[A' || key === 'k') scroll = Math.max(0, scroll - 1);
  if (key === '\x1b[6~') scroll += Math.max(1, (process.stdout.rows ?? 48) - 8);
  if (key === '\x1b[5~') scroll = Math.max(0, scroll - Math.max(1, (process.stdout.rows ?? 48) - 8));
  if (key === 't' && state?.runs?.length) {
    view = view === 'dag' ? 'tasks' : 'dag';
    scroll = 0; revealSelection = true;
  }
  if (key === '\x1b[C' || key === '\x1b[D') {
    const runs = state?.runs ?? [];
    const current = Math.max(0, runs.findIndex(run => run.id === selectedId));
    selectedId = runs[(current + (key === '\x1b[C' ? 1 : -1) + runs.length) % runs.length]?.id;
    if (runs.length) view = 'dag';
    scroll = 0; revealSelection = false;
  }
  const run = state?.runs?.find(run => run.id === selectedId);
  const items = view === 'tasks' ? standaloneTasks(state) : run?.nodes ?? [];
  const scope = view === 'tasks' ? TASK_SCOPE : run?.id;
  const itemId = view === 'tasks' ? selectedTaskId : selectedNodes.get(selectedId);
  if (items.length && (pressed.name === 'tab' || key === 'n' || key === 'p')) {
    const current = Math.max(0, items.findIndex(item => item.id === itemId));
    const direction = pressed.shift || key === 'p' ? -1 : 1;
    const nextId = items[(current + direction + items.length) % items.length].id;
    if (view === 'tasks') selectedTaskId = nextId;
    else selectedNodes.set(selectedId, nextId);
    revealSelection = true;
  }
  if (items.length && (key === ' ' || key === '\r' || key === '\n')) {
    setExpanded(viewState, scope, itemId, !isExpanded(viewState, scope, itemId));
    const snapshot = structuredClone(viewState);
    saving = saving.then(() => saveViewState(file, snapshot)).then(() => {
      if (viewError) { viewError = ''; draw(); }
    }, cause => {
      viewError = cause.message; draw();
    });
    revealSelection = true;
  }
  draw();
});
process.on('SIGTERM', () => { void close(); }); process.on('SIGINT', () => { void close(); }); process.on('SIGHUP', () => { void close(); });
draw();
// Recover a replacement that raced with watcher registration.
void refresh();
