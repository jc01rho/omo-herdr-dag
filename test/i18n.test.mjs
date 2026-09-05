import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messages, languageOf, t } from '../src/i18n.mjs';
import { render, width } from '../src/render.mjs';
import { sessionRuns } from '../src/model.mjs';
import { payload, sessionId } from './fixtures.mjs';

test('English is the default for active, empty, error, and disconnected screens', () => {
  const state = { runs: sessionRuns(payload(), sessionId), connected: true };
  const frame = render(state, { color: false });
  assert.match(frame, /Running · Done 1\/5/);
  assert.match(frame, /Dependencies/);
  assert.match(frame, /Connected/);
  assert.doesNotMatch(frame, /[가-힣]/);
  const empty = render({ runs: [], connected: false }, { color: false, error: 'test error' });
  assert.match(empty, /Waiting for a DAG/);
  assert.match(empty, /Read error: test error/);
  assert.match(empty, /Disconnected/);
  assert.doesNotMatch(empty, /[가-힣]/);
});

test('Korean remains available without translating user-defined workflow labels', () => {
  const state = { runs: sessionRuns(payload(), sessionId), connected: true, language: 'ko' };
  const frame = render(state, { color: false });
  assert.match(frame, /실행 중 · 완료 1\/5/);
  assert.match(frame, /의존 관계/);
  assert.match(frame, /Analyze/);
  for (const language of ['en', 'ko']) for (const columns of [12, 35, 54, 81]) {
    const lines = render(state, { language, columns, rows: 24 }).split('\n');
    assert.equal(lines.length, 24);
    assert.ok(lines.every(line => width(line) < columns));
  }
});

test('both languages cover the same messages and interpolation parameters', () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.ko).sort());
  for (const key of Object.keys(messages.en)) {
    assert.deepEqual(messages.en[key].match(/\{\w+\}/g)?.sort() ?? [], messages.ko[key].match(/\{\w+\}/g)?.sort() ?? []);
  }
  assert.equal(languageOf(undefined), 'en');
  assert.equal(languageOf('unknown'), 'en');
  assert.equal(t('en', 'doneCount', { done: 2, total: 5 }), 'Done 2/5');
});
