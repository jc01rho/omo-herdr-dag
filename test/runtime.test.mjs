import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveViewerNode } from '../src/runtime.mjs';

const reply = (path, version = '24.14.0', bun = false) => ({
  stdout: JSON.stringify({ runtime: 'omo-herdr-dag-node', path, version, bun }),
});

test('compiled omob hosts use a probed Node on PATH instead of the OmO binary', async () => {
  const calls = [];
  const node = await resolveViewerNode({ env: {}, execPath: '/tmp/binary-runtime/omob/omo',
    run: async (command, args) => { calls.push(command); assert.equal(args[0], '--eval'); return reply('/opt/node/bin/node'); } });
  assert.deepEqual(calls, ['node']);
  assert.equal(node, '/opt/node/bin/node');
});

test('ordinary Node hosts keep their validated absolute runtime', async () => {
  const calls = [];
  assert.equal(await resolveViewerNode({ env: {}, execPath: '/opt/node/bin/node',
    run: async command => { calls.push(command); return reply(command); } }), '/opt/node/bin/node');
  assert.deepEqual(calls, ['/opt/node/bin/node']);
});

test('an explicit Node path takes precedence and does not silently fall back', async () => {
  const calls = [];
  await assert.rejects(resolveViewerNode({ env: { OMO_HERDR_DAG_NODE: '/missing/node' }, execPath: '/usr/bin/node',
    run: async command => { calls.push(command); throw new Error('ENOENT'); } }), /OMO_HERDR_DAG_NODE/);
  assert.deepEqual(calls, ['/missing/node']);
  assert.equal(await resolveViewerNode({ env: { OMO_HERDR_DAG_NODE: '/opt/Node Runtime/node' },
    run: async command => reply(command) }), '/opt/Node Runtime/node');
});

test('unsupported host Node falls back to PATH and rejects non-Node probe responses', async () => {
  assert.equal(await resolveViewerNode({ env: {}, execPath: '/old/node',
    run: async command => command === '/old/node' ? reply(command, '22.0.0') : reply('/new/node') }), '/new/node');
  for (const result of [reply('/old/node', '22.0.0'), reply('/bun', '24.0.0', true),
    { stdout: 'omob dev build' }, reply('node'), { stdout: '{}' }]) {
    await assert.rejects(resolveViewerNode({ env: {}, execPath: '/compiled/omo', language: 'ko',
      run: async () => result }), /Node.js 24 이상/);
  }
});

test('the real Node probe returns an executable runtime', async () => {
  assert.equal(await resolveViewerNode({ env: { ...process.env, OMO_HERDR_DAG_NODE: process.execPath } }), process.execPath);
});
