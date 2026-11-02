import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readJson } from '../src/storage.mjs';
import { openViewerHealth, viewerResponds } from '../src/viewer-health.mjs';

test('only the live viewer for the recorded pane and startup token answers its receipt', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'viewer-health-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  const health = await openViewerHealth(file, 'test:p1');
  t.after(() => health.close());
  const receipt = await readJson(`${file}.viewer.json`);

  assert.equal(await viewerResponds(receipt, 'test:p1'), true);
  assert.equal(await viewerResponds(receipt, 'test:p2'), false);
  assert.equal(await viewerResponds({ ...receipt, token: randomUUID() }, 'test:p1'), false);
});

test('a stale receipt for a closed viewer is not rescued by an unrelated living PID', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'viewer-closed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  const health = await openViewerHealth(file, 'test:p1');
  const receipt = await readJson(`${file}.viewer.json`);
  await health.close();

  assert.equal(await viewerResponds({ ...receipt, pid: process.pid }, 'test:p1'), false);
});

test('a nonresponsive process at a reused port cannot keep a health probe open', { timeout: 5000 }, async t => {
  const server = createServer();
  t.after(() => new Promise(resolve => server.close(resolve)));
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const accepted = once(server, 'connection');
  const probing = viewerResponds({ pid: process.pid, paneId: 'test:p1',
    port: server.address().port, token: randomUUID() }, 'test:p1');
  const [socket] = await accepted;
  t.after(() => socket.destroy());
  const closed = once(socket, 'close');

  t.mock.timers.tick(1000);

  assert.equal(await probing, false);
  socket.resume();
  await closed;
});
