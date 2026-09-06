import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { messages } from '../src/i18n.mjs';
import { width } from '../src/render.mjs';
import { writeJson } from '../src/storage.mjs';
import { TASK_SCOPE } from '../src/view-state.mjs';

test('real standalone PTY defaults expanded, preserves task selection, switches mixed views and persists', { timeout: 25000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tasks-pty-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.json');
  const state = { sessionId: 'tasks-pty', language: 'ko', connected: true, runs: [], tasks: [
    { id: 'st_b', status: 'completed', description: 'SECOND_DESCRIPTION' },
    { id: 'st_a', status: 'running', description: 'FIRST_DESCRIPTION 한글🙂', category: 'REAL_CATEGORY', model: 'REAL_MODEL', progress: 'FIRST_PROGRESS' },
    { id: 'st_child', parentTaskId: 'st_a', status: 'lost', description: 'EXPLICIT_CHILD' },
  ] };
  await writeJson(file, state);
  let viewer = openViewer(file, t);
  const initial = await viewer.frame(text => text.includes('> [-] st_a') && text.includes('FIRST_DESCRIPTION'));
  for (const value of [messages.ko.tasks, 'REAL_CATEGORY', 'REAL_MODEL', 'FIRST_PROGRESS']) assert.ok(initial.includes(value), value);
  await viewer.frame(text => text.includes('> [-] st_b') && text.includes('SECOND_DESCRIPTION'), () => viewer.send({ keys: '\t' }));
  await viewer.frame(text => text.includes('> [-] st_a') && text.includes('FIRST_DESCRIPTION'), () => viewer.send({ keys: '\x1b[Z' }));
  const collapsed = await viewer.frame(text => text.includes('> [+] st_a'), () => viewer.send({ keys: ' ' }));
  assert.ok(!collapsed.includes('FIRST_DESCRIPTION'));
  assert.ok(!collapsed.includes('EXPLICIT_CHILD'));
  await viewer.frame(text => text.includes('> [-] st_b'), () => viewer.send({ keys: 'p' }));
  await viewer.frame(text => text.includes('> [+] st_a'), () => viewer.send({ keys: 'n' }));
  state.tasks.reverse();
  state.tasks.push({ id: 'st_0', status: 'running', description: 'NEW_DESCRIPTION 새 작업 한글🙂', progress: 'NEW_PROGRESS' });
  await viewer.frame(text => text.includes('> [+] st_a') && text.includes(`${messages.ko.tasks} (3)`), () => writeJson(file, state));
  await viewer.frame(text => text.includes('> [-] st_b'), () => viewer.send({ keys: 'n' }));
  await viewer.frame(text => text.includes('> [-] st_0') && text.includes('NEW_DESCRIPTION'), () => viewer.send({ keys: 'n' }));
  await viewer.frame(text => text.includes('> [+] st_a'), () => viewer.send({ keys: 'n' }));
  state.runs = [
    { id: 'r1', name: 'FIRST_DAG', status: 'running', nodes: [{ id: 'n', label: 'DAG_NODE', state: 'running', taskId: 'st_dag' }], edges: [] },
    { id: 'r2', name: 'SECOND_DAG', status: 'running', nodes: [{ id: 'n', label: 'OTHER_NODE', state: 'running', taskId: 'st_b' }], edges: [] },
  ];
  state.tasks.push({ id: 'st_dag', description: 'DAG_ONLY_DESCRIPTION' });
  const mixed = await viewer.frame(text => text.includes('t DAG (2)') && text.includes('> [+] st_a'), () => writeJson(file, state));
  assert.ok(!mixed.includes('DAG_ONLY_DESCRIPTION'));
  assert.ok(!mixed.includes('SECOND_DESCRIPTION'));
  await viewer.frame(text => text.includes('FIRST_DAG') && text.includes(`${messages.ko.tasks} (2)`), () => viewer.send({ keys: 't' }));
  await viewer.frame(text => text.includes('SECOND_DAG'), () => viewer.send({ keys: '\x1b[C' }));
  await viewer.frame(text => text.includes('FIRST_DAG'), () => viewer.send({ keys: '\x1b[D' }));
  await viewer.frame(text => text.includes('> [+] st_a') && !text.includes('FIRST_DAG'), () => viewer.send({ keys: 't' }));
  await viewer.frame(text => text.includes('> [-] st_0') && text.includes('NEW_DESCRIPTION'), () => viewer.send({ keys: 'p' }));
  const narrow = await viewer.frame(text => text.split('\n').length === 18 && text.includes('NEW_DESCRIPTION'), () => viewer.send({ resize: [18, 35] }));
  assert.ok(narrow.split('\n').every(line => width(line) < 35));
  state.runs = [];
  await viewer.frame(text => !text.includes('t DAG') && text.includes('> [-] st_0'), () => writeJson(file, state));
  await viewer.close();
  assert.equal(JSON.parse(await readFile(`${file}.view.json`, 'utf8')).expanded[JSON.stringify([TASK_SCOPE, 'st_a'])], false);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), state);
  viewer = openViewer(file, t);
  await viewer.frame(text => text.includes('> [-] st_0'));
  await viewer.frame(text => text.includes('> [+] st_a') && !text.includes('FIRST_DESCRIPTION'), () => viewer.send({ keys: 'n' }));
  await viewer.frame(text => text.includes('> [-] st_a') && text.includes('FIRST_DESCRIPTION'), () => viewer.send({ keys: '\r' }));
  await viewer.close();
  assert.equal(JSON.parse(await readFile(`${file}.view.json`, 'utf8')).expanded[JSON.stringify([TASK_SCOPE, 'st_a'])], true);
  console.log('Standalone PTY evidence: startup, Tab/Shift-Tab/n/p, Space/Enter, arrivals/reorder, mixed DAG toggle/all-run exclusion, CJK resize, restart persistence.');
});

// Standard-library PTY bridge: output and key actions are event-driven, with no
// dwell timers. A frame has one terminal erase token per terminal row.
const bridge = String.raw`
import os, sys, pty, subprocess, selectors, json, fcntl, termios, struct, signal
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 26, 80, 0, 0))
child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
selector = selectors.DefaultSelector()
selector.register(master, selectors.EVENT_READ)
selector.register(sys.stdin, selectors.EVENT_READ)
commands = b''
output = b''
height = 26
try:
  while True:
    for key, _ in selector.select():
      if key.fileobj == master:
        try: data = os.read(master, 65536)
        except OSError: data = b''
        if not data: sys.exit(child.wait())
        output += data
        start, end = b'\x1b[H', b'\x1b[K'
        while start in output:
          output = output[output.index(start):]
          if output.count(end) < height: break
          parts = output.split(end, height)
          frame = end.join(parts[:height]) + end
          output = parts[height]
          print(json.dumps({'frame': frame.decode('utf8')}), flush=True)
      else:
        data = os.read(sys.stdin.fileno(), 65536)
        if not data: sys.exit(0)
        commands += data
        while b'\n' in commands:
          command, commands = commands.split(b'\n', 1)
          value = json.loads(command)
          if 'keys' in value: os.write(master, value['keys'].encode('utf8'))
          if 'resize' in value:
            rows, columns = value['resize']
            height = rows
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
            os.kill(child.pid, signal.SIGWINCH)
finally:
  if child.poll() is None:
    child.terminate()
    child.wait(timeout=5)
  os.close(master)
`;

function openViewer(file, t) {
  const events = new EventEmitter();
  const viewerArgs = [fileURLToPath(new URL('../src/viewer.mjs', import.meta.url)), '--state', file];
  const child = process.platform === 'win32'
    ? spawn(process.execPath, [fileURLToPath(new URL('./windows-pty.mjs', import.meta.url)), ...viewerArgs], { stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn('python3', ['-u', '-c', bridge, process.execPath, ...viewerArgs], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', stderr = '', lastFrame = '';
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', data => {
    buffer += data;
    let end = buffer.indexOf('\n');
    while (end >= 0) {
      const value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      lastFrame = stripVTControlCharacters(value.frame).replaceAll('\r', '');
      events.emit('frame', lastFrame);
      end = buffer.indexOf('\n');
    }
  });
  t.after(() => { child.stdin.end(); });
  const send = value => child.stdin.write(`${JSON.stringify(value)}\n`);
  function frame(predicate, action = () => {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`PTY frame timeout\n${lastFrame}\n${stderr}`)), 5000);
      const onFrame = text => { if (predicate(text)) finish(null, text); };
      const onExit = code => finish(new Error(`Viewer exited ${code}: ${stderr}\n${lastFrame}`));
      function finish(error, text) {
        clearTimeout(timer); events.off('frame', onFrame); child.off('exit', onExit);
        if (error) reject(error); else resolve(text);
      }
      events.on('frame', onFrame); child.on('exit', onExit);
      Promise.resolve().then(action).catch(finish);
    });
  }
  return { frame, send, async close() {
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) });
    send({ keys: 'q' });
    assert.equal((await exited)[0], 0, stderr);
  } };
}

test('real viewer PTY selects, toggles, refreshes, switches runs and persists across restart', { timeout: 25000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dag-pty-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.json');
  const state = { sessionId: 'pty-session', connected: true, runs: [
    { id: 'r1', name: 'FIRST_RUN', status: 'running', nodes: [
      { id: 'a', label: 'ALPHA', state: 'running', taskId: 'ta' },
      { id: 'b', label: 'BETA', state: 'pending', taskId: 'tb' },
    ], edges: [{ from: 'a', to: 'b' }] },
    { id: 'r2', name: 'SECOND_RUN', status: 'running', nodes: [
      { id: 'a', label: 'OTHER_ALPHA', state: 'running', taskId: 'other' },
    ], edges: [] },
  ], tasks: [
    { id: 'ta', description: 'ALPHA_DESCRIPTION', progress: 'ALPHA_PROGRESS' },
    { id: 'tb', description: 'BETA_DESCRIPTION', progress: 'BETA_PROGRESS' },
    { id: 'other', description: 'OTHER_DESCRIPTION' },
  ] };
  await writeJson(file, state);
  let viewer = openViewer(file, t);
  await viewer.frame(text => text.includes('FIRST_RUN'));
  const selected = await viewer.frame(text => text.includes('> [-] BETA') && text.includes('BETA_DESCRIPTION'), () => viewer.send({ keys: '\t' }));
  assert.ok(selected.includes('BETA_PROGRESS'));
  await viewer.frame(text => text.includes('> [-] ALPHA') && text.includes('ALPHA_DESCRIPTION'), () => viewer.send({ keys: '\x1b[Z' }));
  const collapsed = await viewer.frame(text => text.includes('> [+] ALPHA'), () => viewer.send({ keys: ' ' }));
  assert.ok(!collapsed.includes('ALPHA_DESCRIPTION'));
  state.runs[0].nodes.reverse();
  state.runs[0].nodes.find(node => node.id === 'a').taskId = 'retry';
  state.runs[0].nodes.push({ id: 'c', label: 'NEW_NODE', state: 'running', taskId: 'tc' });
  state.tasks.push({ id: 'retry', description: 'RETRY_DESCRIPTION' }, { id: 'tc', description: 'NEW_DESCRIPTION' });
  state.runs[0].name = 'UPDATED_RUN';
  await viewer.frame(text => text.includes('UPDATED_RUN') && text.includes('> [+] ALPHA'), () => writeJson(file, state));
  await viewer.frame(text => text.includes('> [-] NEW_NODE') && text.includes('NEW_DESCRIPTION'), () => viewer.send({ keys: 'n' }));
  await viewer.frame(text => text.includes('> [+] ALPHA'), () => viewer.send({ keys: 'p' }));
  await viewer.frame(text => text.includes('SECOND_RUN') && text.includes('> [-] OTHER_ALPHA'), () => viewer.send({ keys: '\x1b[C' }));
  await viewer.frame(text => text.includes('UPDATED_RUN') && text.includes('> [+] ALPHA'), () => viewer.send({ keys: '\x1b[D' }));
  const top = await viewer.frame(text => text.includes('> [+] ALPHA') && /1–/.test(text), () => viewer.send({ keys: '\x1b[5~' }));
  const down = await viewer.frame(text => /2–/.test(text), () => viewer.send({ keys: 'j' }));
  assert.notEqual(down, top);
  await viewer.frame(text => /1–/.test(text), () => viewer.send({ keys: 'k' }));
  await viewer.frame(text => text.includes('> [-] NEW_NODE') && text.includes('NEW_DESCRIPTION'), () => viewer.send({ keys: 'n' }));
  const resized = await viewer.frame(text => text.split('\n').length === 18 && text.includes('> [-] NEW_NODE'), () => viewer.send({ resize: [18, 54] }));
  assert.ok(resized.split('\n').every(line => width(line) < 54));
  await viewer.close();
  const saved = JSON.parse(await readFile(`${file}.view.json`, 'utf8'));
  assert.equal(saved.expanded['["r1","a"]'], false);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), state);
  viewer = openViewer(file, t);
  await viewer.frame(text => text.includes('[+] ALPHA'));
  await viewer.frame(text => text.includes('> [+] ALPHA'), () => viewer.send({ keys: 'n' }));
  await viewer.frame(text => text.includes('> [-] ALPHA') && text.includes('RETRY_DESCRIPTION'), () => viewer.send({ keys: '\r' }));
  await viewer.close();
  assert.equal(JSON.parse(await readFile(`${file}.view.json`, 'utf8')).expanded['["r1","a"]'], true);
  console.log('PTY evidence: Tab/Shift-Tab/n/p, Space/Enter, run switches, atomic refresh/reorder/retry/new node, quit/restart persistence passed.');
});

test('real viewer clock advances elapsed without new snapshots or input', { timeout: 15000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dag-clock-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.json');
  const startedAt = new Date(Date.now() - 65000).toISOString();
  const state = { sessionId: 'clock-session', connected: true,
    runs: [{ id: 'r', name: 'CLOCK_RUN', status: 'running',
      nodes: [{ id: 'a', label: 'CLOCK_NODE', state: 'running', taskId: 'task' }], edges: [] }],
    tasks: [{ id: 'task', status: 'running', startedAt }] };
  await writeJson(file, state);
  const viewer = openViewer(file, t);
  await viewer.frame(text => text.includes('CLOCK_RUN'));
  const seconds = text => {
    const duration = text.match(new RegExp(`${messages.en.elapsed}: (\\d+):(\\d{2}):(\\d{2})`));
    return duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : -1;
  };
  const initial = await viewer.frame(text => seconds(text) >= 65, () => viewer.send({ keys: '\x1b[6~' }));
  const tick = await viewer.frame(text => seconds(text) > seconds(initial));
  const nextTick = await viewer.frame(text => seconds(text) > seconds(tick));
  assert.ok(seconds(nextTick) > seconds(initial));
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), state);
  state.tasks[0].status = 'completed';
  state.tasks[0].completedAt = new Date(Date.parse(startedAt) + 9000).toISOString();
  state.runs[0].nodes[0].state = 'completed';
  state.runs[0].status = 'completed';
  await viewer.frame(text => seconds(text) === 9, () => writeJson(file, state));
  await viewer.frame(text => seconds(text) === 9, () => viewer.send({ keys: 'n' }));
  await viewer.close();
  console.log('PTY clock evidence: two elapsed advances without snapshots/input; completed duration frozen at 00:00:09.');
});
