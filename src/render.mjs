import { clean, layers } from './model.mjs';
import { t } from './i18n.mjs';

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
const paint = (text, color, enabled) => enabled ? `\x1b[38;5;${color}m${text}\x1b[0m` : text;

export function graphLines(run, columns, color = true, language = 'en') {
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
          fit(node.label, boxWidth - 4, true),
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

export function render(state, { columns = 54, rows = 48, runIndex = 0, scroll = 0, color = true, error = '', language = state?.language ?? 'en' } = {}) {
  columns = Math.max(1, columns - 1);
  rows = Math.max(1, rows);
  const all = state?.runs ?? [];
  const run = all[Math.min(Math.max(0, runIndex), Math.max(0, all.length - 1))];
  const head = [paint(fit('OMO  /  DAG', columns), 81, color),
    fit(run ? `${run.name}  ${Math.min(runIndex + 1, all.length)}/${all.length}` : t(language, 'emptyTitle'), columns)];
  const body = [];
  if (error) body.push(t(language, 'readError', { error: clean(error) }), t(language, 'keepLast'), '');
  if (run) {
    const done = run.nodes.filter(n => n.state === 'completed').length;
    const failed = run.nodes.filter(n => n.state === 'failed').length;
    head.push(fit(`${t(language, run.status)} · ${t(language, 'doneCount', { done, total: run.nodes.length })}${failed ? ` · ${t(language, 'failedCount', { count: failed })}` : ''}`, columns));
    body.push('');
    try { body.push(...graphLines(run, columns, color, language)); }
    catch (error) { body.push(t(language, 'graphError', { error: clean(error.message) })); }
    body.push('', t(language, 'dependencies'));
    if (!run.edges.length) body.push(`  ${t(language, 'none')}`);
    for (const edge of run.edges) body.push(`  ${clean(edge.from)} → ${clean(edge.to)}`);
    for (const node of run.nodes) if (node.error) body.push('', `× ${clean(node.id)}: ${node.error}`);
  } else {
    head.push('');
    body.push('', `  ○  ${t(language, 'waiting')}`, '', `  ${t(language, 'waitingLine1')}`, `  ${t(language, 'waitingLine2')}`);
  }
  const showCloseHint = !state?.connected;
  const available = Math.max(0, rows - head.length - (showCloseHint ? 4 : 3));
  const start = Math.min(Math.max(0, scroll), Math.max(0, body.length - available));
  const visible = body.slice(start, start + available).map(line => {
    // Preserve ANSI colors when the already sized graph fits.
    return width(line) <= columns ? line : fit(line, columns);
  });
  while (visible.length < available) visible.push('');
  const foot = [paint('─'.repeat(columns), 240, color),
    fit(`${state?.connected ? `● ${t(language, 'connected')}` : `○ ${t(language, 'disconnected')}`}${body.length > available ? `  ${start + 1}–${Math.min(start + available, body.length)}/${body.length}` : ''}`, columns),
    ...(showCloseHint ? [fit(t(language, 'closeHint'), columns)] : []),
    fit(t(language, 'controls'), columns)];
  return [...head, ...visible, ...foot].slice(0, rows).join('\n');
}
