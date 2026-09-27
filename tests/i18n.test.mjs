import test from 'node:test';
import assert from 'node:assert/strict';
import {
  t,
  translateSource,
  localizedLabels,
  rawLabels,
  setLanguage,
  getLocale,
} from '../src/shared/i18n.mjs';
import { html, e, date } from '../src/renderer/html.js';
import { portfolioHTML } from '../src/core/export.mjs';

test('language switching translates UI literals, never interpolated user text or HTML', () => {
  setLanguage('en');
  try {
    assert.equal(t('계정 연결'), 'Connect account');
    assert.equal(t`${1}개 작업 대기`, '1 task queued');
    assert.equal(t`${2}개 작업 대기`, '2 tasks queued');
    assert.equal(html`<p>${3}개 파일</p>`, '<p>3 files</p>');
    assert.equal(html`<div data-id="${'item'}${'123'}"></div>`, '<div data-id="item123"></div>');
    const content = '계정 연결 <script>alert(1)</script>';
    assert.equal(
      html`<h2>기록</h2><p>${e(content)}</p>`,
      '<h2>Records</h2><p>계정 연결 &lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
    assert.equal(t`제품 폴더: ${'계정 연결'}`, 'Product folder: 계정 연결');
    assert.equal(
      translateSource('<input placeholder="제품 이름" aria-label="제품 폴더">'),
      '<input placeholder="Product name" aria-label="Product folder">',
    );
    assert.equal(t('unknown diagnostic <value>'), 'unknown diagnostic <value>');
    assert.equal(getLocale(), 'en-US');
    const exported = portfolioHTML(
      {
        intro: '소개 원문',
        entries: [{ title: '제목 원문', description: '설명 원문', contribution: '기여 원문' }],
      },
      { language: 'en' },
    );
    assert.match(exported, /lang="en"/);
    assert.match(exported, /Contribution: 기여 원문/);
    assert.match(exported, /소개 원문/);
    assert.match(date('2026-09-27T00:00:00Z'), /Sep/);
    const labels = localizedLabels({ ready: '실행 가능' });
    const copy = localizedLabels({ ...rawLabels(labels) });
    assert.equal(labels.ready, 'Ready to run');
    setLanguage('ko');
    assert.equal(copy.ready, '실행 가능');
    assert.equal(t('계정 연결'), '계정 연결');
    assert.equal(getLocale(), 'ko-KR');
    assert.throws(() => setLanguage('unsupported'), /Unsupported/);
  } finally {
    setLanguage('ko');
  }
});
