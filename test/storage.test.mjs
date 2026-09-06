import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeJson, readJson } from '../src/storage.mjs';

test('atomic replacement survives a transient Windows sharing violation', async t => {
  // Given an existing snapshot and a rename denied once by a Windows reader.
  const directory = await fs.mkdtemp(join(tmpdir(), 'herdr-storage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  await writeJson(file, { generation: 1 });
  const rename = fs.rename;
  let calls = 0;
  t.mock.method(fs, 'rename', async (...args) => {
    if (++calls === 1) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
    return rename(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  // When the snapshot is atomically replaced.
  if (process.platform === 'win32') {
    await writeJson(file, { generation: 2 });
    assert.equal(calls, 2);
    // Then the new snapshot replaces the old without a delete gap or temp leak.
    assert.deepEqual(await readJson(file), { generation: 2 });
    assert.deepEqual(await fs.readdir(directory), ['state.json']);
  } else {
    await assert.rejects(writeJson(file, { generation: 2 }), { code: 'EPERM' });
    assert.deepEqual(await readJson(file), { generation: 1 });
  }
});

test('permanent replacement failures preserve the previous snapshot and surface the error', async t => {
  // Given a snapshot and a permanently denied destination.
  const directory = await fs.mkdtemp(join(tmpdir(), 'herdr-storage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  await writeJson(file, { generation: 1 });
  t.mock.method(fs, 'rename', async () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  // When replacement cannot succeed, then the error is not swallowed.
  await assert.rejects(writeJson(file, { generation: 2 }), { code: 'EPERM' });
  assert.deepEqual(await readJson(file), { generation: 1 });
  assert.deepEqual(await fs.readdir(directory), ['state.json']);
});
