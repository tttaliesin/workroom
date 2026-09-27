import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { Workroom } from '../src/core/service.mjs';
import { portfolioHTML } from '../src/core/export.mjs';
import { portfolioMarkup, portfolioTemplates } from '../src/shared/portfolio.mjs';
import { mergeDraft } from '../src/renderer/merge-draft.js';

test('every template exports escaped public content using the shared preview layout', () => {
  for (const templateId of portfolioTemplates) {
    const snapshot = {
      templateId,
      intro: '<img src=x onerror=alert(1)>',
      requirements: 'PRIVATE_REQUIREMENTS',
      target: 'PRIVATE_TARGET',
      evidence: 'PRIVATE_EVIDENCE',
      entries: [
        {
          taskId: 'PRIVATE_ID',
          title: '</h2><script>evil()</script>',
          description: '한국어 & English',
          contribution: 'My role',
        },
      ],
    };
    const exported = portfolioHTML(snapshot, { language: 'en' });
    assert.ok(exported.includes(portfolioMarkup(snapshot, { language: 'en' })));
    assert.match(exported, /default-src 'none'/);
    assert.match(exported, /&lt;script&gt;/);
    assert.match(exported, /한국어 &amp; English/);
    assert.ok(exported.includes(`folio-${templateId}`));
    assert.doesNotMatch(exported, /PRIVATE_|<script|<img|@import|url\(/);
  }
  const invalid = portfolioHTML({ templateId: '"><script>', intro: 'Hello', entries: [] });
  assert.match(invalid, /class="folio-document folio-studio"/);
  assert.doesNotMatch(invalid, /<script>/);
});

test('template selection survives older clients, automatic reports, restart and frozen export history', async () => {
  mkdirSync('work/tests', { recursive: true });
  const directory = mkdtempSync(path.resolve('work/tests/templates-'));
  const filename = path.join(directory, 'workroom.sqlite');
  let room = new Workroom(filename);
  try {
    const product = await room.createProduct({ name: 'Example', folder: directory });
    let p = room.createPortfolio({ target: 'Example', autoProductIds: [product.id] });
    const report = {
      productId: product.id,
      title: 'Result',
      summary: 'Result summary',
      contribution: 'My role',
      evidence: 'Private',
      limitations: 'Example only',
    };
    room.reportWork(report);
    p = room.snapshot().portfolios[0];
    const save = (p, overrides = {}) =>
      room.savePortfolio({
        id: p.id,
        revision: p.revision,
        intro: 'Hello',
        requirements: '',
        entries: p.entries,
        ...overrides,
      });
    p = save(p, { templateId: 'editorial' });
    const snapshot = room.prepareExport(p.id, p.revision);
    p = room.recordExport(p.id, snapshot, 'example.html');
    p = save(p, { templateId: 'resume' });
    p = save(p); // Existing API clients omit the new field.
    assert.equal(p.templateId, 'resume');
    room.reportWork({ ...report, title: 'Another result' });
    assert.equal(room.snapshot().portfolios[0].templateId, 'resume');
    assert.throws(() => save(room.snapshot().portfolios[0], { templateId: '../bad' }));
    room.close();
    room = new Workroom(filename);
    p = room.snapshot().portfolios[0];
    assert.equal(p.templateId, 'resume');
    assert.equal(p.exports[0].snapshot.templateId, 'editorial');
    assert.equal(room.createPortfolio({ target: 'Another target' }).templateId, 'studio');
    const { templateId: _template, ...legacy } = p;
    room.store.update('portfolio', p.id, p.revision, legacy);
    const stored = room.store.get('portfolio', p.id);
    assert.equal(room.prepareExport(stored.id, stored.revision).templateId, 'studio');
  } finally {
    room.close();
  }
});

test('template changes merge with text updates but concurrent design changes require resolution', () => {
  const base = { revision: 1, intro: 'Before', requirements: '', entries: [] };
  const local = { ...base, templateId: 'editorial' };
  const remote = { ...base, revision: 2, intro: 'Updated' };
  assert.equal(mergeDraft(base, local, remote).templateId, 'editorial');
  assert.equal(mergeDraft(base, local, remote).intro, 'Updated');
  remote.templateId = 'resume';
  assert.throws(() => mergeDraft(base, local, remote), /다른 창/);
  assert.equal(mergeDraft(base, local, remote, true).templateId, 'editorial');
});
