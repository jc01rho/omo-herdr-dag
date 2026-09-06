import { t } from './i18n.mjs';
import { clean, layers } from './model.mjs';
import { TASK_SCOPE, isExpanded } from './view-state.mjs';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function width(text) {
  let result = 0;
  for (const { segment } of segmenter.segment(clean(text))) {
    const cp = segment.codePointAt(0);
    result += /\p{Extended_Pictographic}/u.test(segment) || cp >= 0x1100 &&
      (cp <= 0x115f || cp === 0x2329 || cp === 0x232a || cp >= 0x2e80 && cp <= 0xa4cf ||
       cp >= 0xac00 && cp <= 0xd7a3 || cp >= 0xf900 && cp <= 0xfaff ||
       cp >= 0xfe10 && cp <= 0xfe6f || cp >= 0xff01 && cp <= 0xff60 || cp >= 0xffe0 && cp <= 0xffe6 ||
       cp >= 0x20000) ? 2 : 1;
  }
  return result;
}
export function fit(text, columns, pad = false) {
  text = clean(text);
  if (columns <= 0) return '';
  let out = '', used = 0;
  const truncated = width(text) > columns;
  for (const { segment } of segmenter.segment(text)) {
    const size = width(segment);
    if (used + size > columns - (truncated ? 1 : 0)) break;
    out += segment; used += size;
  }
  if (truncated) { out += '…'; used += 1; }
  return out + (pad ? ' '.repeat(Math.max(0, columns - used)) : '');
}
const icons = { pending: '○', blocked: '◌', scheduled: '◷', running: '●', paused: 'Ⅱ', completed: '✓', failed: '×', cancelled: '−', skipped: '·' };
const colors = { running: 81, completed: 114, failed: 203, blocked: 180, paused: 180, cancelled: 244, skipped: 244, pending: 250, scheduled: 81 };
const palette = { accent: 81, muted: 244, text: 252, divider: 240 };
const paint = (text, color, enabled) => enabled ? `\x1b[38;5;${color}m${text}\x1b[0m` : text;
const taskStatuses = new Set([...Object.keys(icons), 'error', 'interrupted', 'lost']);

export function standaloneTasks(state) {
  const linked = new Set((state?.runs ?? []).flatMap(run => run.nodes.map(node => node.taskId)));
  return (state?.tasks ?? []).filter(task => !task.parentTaskId && !linked.has(task.id))
    .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || a.id.localeCompare(b.id));
}

export function graphLines(run, columns, color = true, language = 'en', { selectedNodeId, viewState } = {}) {
  const output = [];
  const rows = layers(run, language);
  let previous = [];
  const glyphs = { 1: '│', 2: '─', 3: '└', 4: '│', 5: '│', 6: '┌', 7: '├', 8: '─', 9: '┘', 10: '─', 11: '┴', 12: '┐', 13: '┤', 14: '┬', 15: '┼' };
  function connectors(current) {
    const grid = Array.from({ length: 3 }, () => Array(columns).fill(0));
    const targets = new Set();
    for (const edge of run.edges) {
      const from = previous.find(n => n.id === edge.from), to = current.find(n => n.id === edge.to);
      if (!from || !to) continue;
      const a = from.center, b = to.center;
      grid[0][a] |= 5; grid[1][a] |= 1;
      if (a < b) { for (let x = a; x < b; x++) { grid[1][x] |= 2; grid[1][x + 1] |= 8; } }
      if (a > b) { for (let x = b; x < a; x++) { grid[1][x] |= 2; grid[1][x + 1] |= 8; } }
      grid[1][b] |= 4; targets.add(b);
    }
    if (!targets.size) return [''];
    return grid.map((row, y) => paint(row.map((bits, x) => y === 2 && targets.has(x) ? '▼' : glyphs[bits] ?? ' ').join('').trimEnd(), 81, color));
  }
  // Exact incoming IDs and the edge list disambiguate crossings and edges which
  // skip a frontier. Wide frontiers wrap without changing their dependencies.
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const perRow = Math.max(1, Math.floor((columns + 2) / 22));
    for (let offset = 0; offset < row.length; offset += perRow) {
      const group = row.slice(offset, offset + perRow);
      const boxWidth = Math.min(34, Math.floor((columns - 2 * (group.length - 1)) / group.length));
      const left = Math.floor((columns - (boxWidth * group.length + 2 * (group.length - 1))) / 2);
      const prefix = ' '.repeat(left);
      const positions = group.map((node, i) => ({ id: node.id, center: left + i * (boxWidth + 2) + Math.floor(boxWidth / 2) }));
      if (index || offset) output.push(...connectors(positions));
      const interiors = group.map(node => {
        const incoming = run.edges.filter(e => e.to === node.id).map(e => e.from);
        return [
          fit(`${node.id === selectedNodeId ? '>' : ' '} [${isExpanded(viewState, run.id, node.id) ? '-' : '+'}] ${node.label}`, boxWidth - 4, true),
          fit(`${icons[node.state]} ${t(language, node.state)}`, boxWidth - 4, true),
          fit(incoming.length ? `← ${incoming.join(', ')}` : t(language, 'startNode'), boxWidth - 4, true),
        ];
      });
      output.push(prefix + group.map(() => `╭${'─'.repeat(Math.max(0, boxWidth - 2))}╮`).join('  '));
      for (let line = 0; line < 3; line++) output.push(prefix + group.map((node, i) =>
        `│ ${paint(interiors[i][line], line === 1 ? colors[node.state] : line === 2 ? 244 : 252, color)} │`).join('  '));
      output.push(prefix + group.map(() => `╰${'─'.repeat(Math.max(0, boxWidth - 2))}╯`).join('  '));
      if (offset + perRow < row.length) output.push(paint(`  · ${t(language, 'sameFrontier')}`, 244, color));
      previous = positions;
    }
  }
  return output;
}

// Wrap at word boundaries when possible, never dropping the tail of task text.
function wrap(text, columns) {
  const result = [];
  let line = '';
  for (const { segment } of segmenter.segment(clean(text))) {
    if (line && width(line + segment) > columns) {
      const space = line.lastIndexOf(' ');
      if (space > 0 && segment !== ' ') {
        result.push(line.slice(0, space));
        line = line.slice(space + 1);
      } else { result.push(line); line = ''; }
      if (line && width(line + segment) > columns) { result.push(line); line = ''; }
    }
    line += segment;
  }
  result.push(line);
  return result;
}

function elapsedTime(task, { now, connected, updatedAt }, status) {
  const start = Date.parse(task.startedAt);
  // Completion is authoritative. A terminal task without its endpoint is not
  // still running; disconnected snapshots can only use their recorded time.
  const end = task.completedAt !== undefined ? Date.parse(task.completedAt) :
    status === 'running' ? (connected ? now : Date.parse(updatedAt)) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const seconds = Math.floor((end - start) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}

function taskLines(task, language, timing, nodeStatus) {
  const value = key => task?.[key] === undefined || task[key] === null || task[key] === '' ? t(language, 'noData') : clean(task[key]);
  if (!task) return [`${t(language, 'task')}: ${t(language, 'noData')}`];
  const lines = [`${t(language, 'task')}: ${clean(task.id)}`];
  if (task.status) lines.push(`${t(language, 'taskStatus')}: ${taskStatuses.has(task.status) ? t(language, task.status) : clean(task.status)}`);
  for (const key of ['description', ...(task.category ? ['category'] : []), 'agent', 'model', 'progress']) lines.push(`${t(language, key)}: ${value(key)}`);
  const stats = [`${t(language, 'elapsed')}: ${elapsedTime(task, timing, task.status ?? nodeStatus) ?? t(language, 'noData')}`];
  for (const key of ['turns', 'toolCalls']) {
    if (task[key] !== undefined && task[key] !== null) stats.push(`${t(language, key)}: ${value(key)}`);
  }
  lines.push(stats.join(' · '));
  for (const key of ['startedAt', 'completedAt']) {
    if (task[key] !== undefined && task[key] !== null) lines.push(`${t(language, key)}: ${value(key)}`);
  }
  return lines;
}

function descendantLines(task, tasks, language, timing) {
  // Only parentTaskId establishes ownership. DAG edges never imply subtasks.
  const visited = new Set(task ? [task.id] : []);
  const descendants = [];
  const pending = task ? tasks.filter(child => child.parentTaskId === task.id).map(child => ({ task: child, depth: 1 })) : [];
  while (pending.length) {
    const { task: child, depth } = pending.shift();
    if (visited.has(child.id)) continue;
    visited.add(child.id);
    descendants.push(`${'  '.repeat(Math.min(depth, 3))}↳ ${clean(child.id)} ← ${clean(child.parentTaskId)}`,
      ...taskLines(child, language, timing));
    pending.unshift(...tasks.filter(task => task.parentTaskId === child.id).map(task => ({ task, depth: depth + 1 })));
  }
  return descendants.length ? [t(language, 'descendants'), ...descendants] : [];
}

function detailBox(text, columns, color, selected) {
  const inner = Math.max(1, columns - 4);
  const border = selected ? palette.accent : palette.muted;
  return [paint(`╭${'─'.repeat(Math.max(0, columns - 2))}╮`, border, color),
    ...text.flatMap((line, index) => wrap(line, inner).map(part =>
      `${paint('│', border, color)} ${paint(fit(part, inner, true), index === 0 && selected ? palette.accent : palette.text, color)} ${paint('│', border, color)}`)),
    paint(`╰${'─'.repeat(Math.max(0, columns - 2))}╯`, border, color)];
}

function detailLines(node, run, tasks, columns, color, language, selectedNodeId, viewState, timing) {
  const expanded = isExpanded(viewState, run.id, node.id);
  const selected = node.id === selectedNodeId;
  const text = [`${selected ? '>' : ' '} [${expanded ? '-' : '+'}] ${clean(node.label)} (${clean(node.id)})`];
  if (expanded) {
    const task = tasks.find(task => task.id === node.taskId);
    text.push(`${icons[node.state]} ${t(language, node.state)}`, ...taskLines(task, language, timing, node.state),
      ...descendantLines(task, tasks, language, timing));
  }
  return detailBox(text, columns, color, selected);
}

function standaloneLines(task, tasks, columns, color, language, selectedTaskId, viewState, timing) {
  const expanded = isExpanded(viewState, TASK_SCOPE, task.id);
  const selected = task.id === selectedTaskId;
  const status = task.status ? (taskStatuses.has(task.status) ? t(language, task.status) : clean(task.status)) : t(language, 'noData');
  const text = [`${selected ? '>' : ' '} [${expanded ? '-' : '+'}] ${clean(task.id)} · ${status}`];
  if (expanded) text.push(...taskLines(task, language, timing), ...descendantLines(task, tasks, language, timing));
  return detailBox(text, columns, color, selected);
}

export function renderFrame(state, { columns = 54, rows = 48, runIndex = 0, scroll = 0, color = true, error = '', language = state?.language ?? 'en',
  selectedNodeId, selectedTaskId, view, viewState, revealSelection = false, notice = '', now = Date.now() } = {}) {
  columns = Math.max(1, columns - 1);
  rows = Math.max(1, rows);
  const all = state?.runs ?? [];
  const run = all[Math.min(Math.max(0, runIndex), Math.max(0, all.length - 1))];
  const roots = standaloneTasks(state);
  const tasksView = view === 'tasks' || !all.length;
  const tasksTitle = `${t(language, 'tasks')} (${roots.length})`;
  const switcher = tasksView ? (all.length ? `  t DAG (${all.length})` : '') : `  t ${tasksTitle}`;
  const head = [paint(fit(`OMO  /  ${tasksView ? t(language, 'tasks') : 'DAG'}${switcher}`, columns), palette.accent, color),
    fit(tasksView ? tasksTitle : `${run.name}  ${Math.min(runIndex + 1, all.length)}/${all.length}`, columns)];
  const body = [], nodeRanges = Object.create(null), taskRanges = Object.create(null);
  if (error) body.push(t(language, 'readError', { error: clean(error) }), t(language, 'keepLast'), '');
  if (tasksView && (roots.length || all.length)) {
    head.push('');
    for (const task of roots) {
      const start = body.length;
      body.push(...standaloneLines(task, state?.tasks ?? [], columns, color, language, selectedTaskId, viewState,
        { now, connected: state?.connected, updatedAt: state?.updatedAt }));
      taskRanges[task.id] = { start, end: body.length };
    }
    if (!roots.length) body.push(t(language, 'none'));
  } else if (run && !tasksView) {
    const done = run.nodes.filter(n => n.state === 'completed').length;
    const failed = run.nodes.filter(n => n.state === 'failed').length;
    head.push(fit(`${t(language, run.status)} · ${t(language, 'doneCount', { done, total: run.nodes.length })}${failed ? ` · ${t(language, 'failedCount', { count: failed })}` : ''}`, columns));
    body.push('');
    try { body.push(...graphLines(run, columns, color, language, { selectedNodeId, viewState })); }
    catch (error) { body.push(t(language, 'graphError', { error: clean(error.message) })); }
    body.push('', t(language, 'dependencies'));
    if (!run.edges.length) body.push(`  ${t(language, 'none')}`);
    for (const edge of run.edges) body.push(`  ${clean(edge.from)} → ${clean(edge.to)}`);
    body.push('', t(language, 'details'));
    for (const node of run.nodes) {
      const start = body.length;
      body.push(...detailLines(node, run, state?.tasks ?? [], columns, color, language, selectedNodeId, viewState,
        { now, connected: state?.connected, updatedAt: state?.updatedAt }));
      nodeRanges[node.id] = { start, end: body.length };
    }
    for (const node of run.nodes) if (node.error) body.push('', `× ${clean(node.id)}: ${node.error}`);
  } else {
    head.push('');
    body.push('', `  ○  ${t(language, 'waiting')}`, '', `  ${t(language, 'waitingLine1')}`, `  ${t(language, 'waitingLine2')}`);
  }
  const showCloseHint = !state?.connected;
  const available = Math.max(0, rows - head.length - (showCloseHint ? 6 : 5));
  const selected = tasksView ? taskRanges[selectedTaskId] : nodeRanges[selectedNodeId];
  if (revealSelection && selected && available > 0) {
    if (selected.start < scroll || selected.start + Math.min(3, available) > scroll + available) scroll = selected.start;
  }
  const start = Math.min(Math.max(0, scroll), Math.max(0, body.length - available));
  const visible = body.slice(start, start + available).map(line => {
    // Preserve ANSI colors when the already sized graph fits.
    return width(line) <= columns ? line : fit(line, columns);
  });
  while (visible.length < available) visible.push('');
  const foot = [paint('─'.repeat(columns), 240, color),
    fit(notice || `${state?.connected ? `● ${t(language, 'connected')}` : `○ ${t(language, 'disconnected')}`}${body.length > available ? `  ${start + 1}–${Math.min(start + available, body.length)}/${body.length}` : ''}`, columns),
    ...(showCloseHint ? [fit(t(language, 'closeHint'), columns)] : []),
    fit(t(language, 'nodeControls'), columns),
    fit(t(language, 'toggleControls'), columns),
    fit(t(language, 'controls'), columns)];
  return { text: [...head, ...visible, ...foot].slice(0, rows).join('\n'), scroll: start, nodeRanges, taskRanges };
}

export const render = (state, options) => renderFrame(state, options).text;
