// Real Windows ConPTY bridge. The stream tap captures complete viewer frames
// before ConPTY's differential VT encoding, matching the Unix PTY test contract.
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import pty from 'node-pty';

const pipe = ['', '', '.', 'pipe', `herdr-viewer-test-${randomUUID()}`].join(String.fromCharCode(92));
const server = createServer(socket => socket.pipe(process.stdout));
server.on('error', error => { console.error(error); process.exit(1); });
server.listen(pipe, () => {
  const terminal = pty.spawn(process.execPath, ['--import', new URL('./pty-capture.mjs', import.meta.url).href,
    ...process.argv.slice(2)], { cols: 80, rows: 26, env: { ...process.env, HERDR_TEST_FRAME_PIPE: pipe } });
  // Drain ConPTY output so the real viewer cannot block on its terminal.
  terminal.onData(() => {});
  terminal.onExit(({ exitCode }) => process.exit(exitCode));
  const input = createInterface({ input: process.stdin });
  input.on('line', line => {
    const command = JSON.parse(line);
    if (command.keys !== undefined) terminal.write(command.keys);
    if (command.resize) terminal.resize(command.resize[1], command.resize[0]);
  });
  input.on('close', () => { terminal.kill(); server.close(); });
});
