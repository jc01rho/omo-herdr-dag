import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messages, languageOf, t } from '../src/i18n.mjs';
import { render, width, fit } from '../src/render.mjs';
import { sessionRuns } from '../src/model.mjs';
import { payload, sessionId } from './fixtures.mjs';

test('English is the default for active, empty, error, and disconnected screens', () => {
  const state = { runs: sessionRuns(payload(), sessionId), connected: true };
  const frame = render(state, { color: false });
  assert.match(frame, /Running · Done 1\/5/);
  assert.match(frame, /Dependencies/);
  assert.match(frame, /Connected/);
  assert.doesNotMatch(frame, /[가-힣]/);
  assert.doesNotMatch(frame, /[\u4e00-\u9fff]/);
  const empty = render({ runs: [], connected: false }, { color: false, error: 'test error' });
  assert.match(empty, /Waiting for a DAG/);
  assert.match(empty, /Read error: test error/);
  assert.match(empty, /Disconnected/);
  assert.doesNotMatch(empty, /[가-힣]/);
  assert.doesNotMatch(empty, /[\u4e00-\u9fff]/);
});

test('Korean and Simplified Chinese remain available without translating user-defined workflow labels', () => {
  const state = { runs: sessionRuns(payload(), sessionId), connected: true, language: 'ko' };
  const frame = render(state, { color: false });
  assert.match(frame, /실행 중 · 완료 1\/5/);
  assert.match(frame, /의존 관계/);
  assert.match(frame, /Analyze/);
  const chinese = { runs: sessionRuns(payload(), sessionId), connected: true, language: 'zh-cn' };
  const chineseFrame = render(chinese, { color: false });
  assert.match(chineseFrame, /运行中 · 已完成 1\/5/);
  assert.match(chineseFrame, /依赖关系/);
  assert.match(chineseFrame, /Analyze/);
  assert.equal(width('依赖关系'), 8);
  assert.equal(width('运行中 · 已完成 1/5'), 19);
  assert.equal(fit('依赖关系', 5), '依赖…');
  for (const language of ['en', 'ko', 'zh-cn']) for (const columns of [12, 35, 54, 81]) {
    const lines = render(chinese, { language, columns, rows: 24 }).split('\n');
    assert.equal(lines.length, 24);
    assert.ok(lines.every(line => width(line) < columns));
  }
});

test('all languages cover the same messages and interpolation parameters', () => {
  assert.deepEqual(Object.keys(messages).sort(), ['en', 'ko', 'zh-cn']);
  for (const language of Object.keys(messages)) {
    assert.deepEqual(Object.keys(messages[language]).sort(), Object.keys(messages.en).sort());
    for (const key of Object.keys(messages.en)) {
      assert.deepEqual(messages.en[key].match(/\{\w+\}/g)?.sort() ?? [], messages[language][key].match(/\{\w+\}/g)?.sort() ?? []);
    }
  }
  assert.equal(languageOf(undefined), 'en');
  assert.equal(languageOf('unknown'), 'en');
  assert.equal(languageOf('zh-cn'), 'zh-cn');
  assert.equal(t('en', 'doneCount', { done: 2, total: 5 }), 'Done 2/5');
  assert.equal(t('zh-cn', 'doneCount', { done: 2, total: 5 }), '已完成 2/5');
});
