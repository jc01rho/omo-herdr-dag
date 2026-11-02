import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createConnection, createServer } from 'node:net';
import { writeJson } from './storage.mjs';

export async function openViewerHealth(file, paneId) {
  const token = randomUUID();
  const server = createServer(socket => {
    socket.on('error', () => socket.destroy());
    socket.end(token);
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const close = () => new Promise((resolve, reject) => {
    server.close(error => { if (error) reject(error); else resolve(); });
  });
  try {
    await writeJson(`${file}.viewer.json`, { pid: process.pid, paneId, port: server.address().port, token });
  } catch (error) { await close(); throw error; }
  return { close };
}

export function viewerResponds(receipt, paneId) {
  if (receipt?.paneId !== paneId || !Number.isInteger(receipt.port) || receipt.port < 1 || receipt.port > 65535 ||
      typeof receipt.token !== 'string' || receipt.token.length !== 36) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    let received = '', settled = false;
    const socket = createConnection({ host: '127.0.0.1', port: receipt.port });
    const timeout = setTimeout(() => finish(false), 1000);
    function finish(result, error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    }
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      received += chunk;
      if (received.length > receipt.token.length) finish(false);
    });
    socket.once('end', () => finish(received === receipt.token));
    socket.once('error', error => {
      if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code)) finish(false);
      else finish(false, error);
    });
  });
}
