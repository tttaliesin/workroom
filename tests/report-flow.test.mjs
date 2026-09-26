import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { Workroom } from '../src/core/service.mjs';
import { projectRoot } from '../src/core/paths.mjs';
import { mergeDraft } from '../src/renderer/merge-draft.js';

async function fixture(t) {
  const parent = path.join(projectRoot, 'work/tests');
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(path.join(parent, 'report-flow-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const a = new Workroom(path.join(dir, 'workroom.sqlite'));
  const p = await a.createProduct({ name: 'A', folder: dir });
  const otherFolder = path.join(dir, 'other');
  mkdirSync(otherFolder);
  const q = await a.createProduct({ name: 'B', folder: otherFolder });
  return { a, p, q, db: path.join(dir, 'workroom.sqlite') };
}
const report = (productId, externalId = 'session/task') => ({
  productId,
  externalId,
  title: '검색 수정',
  summary: '검색 누락을 수정함',
  evidence: '에이전트 검사 보고',
  limitations: '독립 검증 없음',
  contribution: '사용자 요구사항, 에이전트 구현',
});
const save = (a, p, change = {}) =>
  a.savePortfolio({
    id: p.id,
    revision: p.revision,
    intro: p.intro,
    requirements: p.requirements,
    entries: p.entries,
    autoProductIds: p.autoProductIds,
    ...change,
  });
const get = (a, p) => a.snapshot().portfolios.find((x) => x.id === p.id);

test('report identity is durable, product-scoped, versioned, and preserves excluded knowledge', async (t) => {
  const { a, p, q, db } = await fixture(t);
  const b = new Workroom(db);
  try {
    const input = report(p.id);
    const first = a.reportWork(input, 'mcp');
    const token = a.changes();
    assert.equal(b.reportWork(input, 'mcp').id, first.id);
    assert.equal(a.changes(), token);
    const r = a.snapshot().records[0];
    a.toggleRecord({ id: r.id, revision: r.revision, active: false });
    assert.throws(
      () => b.reportWork({ ...input, summary: '같은 버전 다른 내용' }, 'mcp'),
      /같은 보고 버전/,
    );
    const second = b.reportWork(
      { ...input, sourceVersion: 2, summary: '새 근거로 보완한 보고' },
      'mcp',
    );
    assert.equal(second.id, first.id);
    assert.equal(second.verification, 'reported');
    assert.equal(a.snapshot().records.length, 1);
    assert.equal(a.snapshot().records[0].active, false);
    assert.match(a.snapshot().records[0].content, /새 근거/);
    assert.throws(() => a.reportWork(input, 'mcp'), /더 최신/);
    assert.notEqual(a.reportWork(report(q.id), 'mcp').id, first.id);
    assert.equal(a.context({ productId: q.id, query: '새 근거' }).records.length, 0);
    assert.throws(
      () => a.reportWork({ ...report(p.id), externalId: undefined, sourceVersion: 2 }),
      /externalId/,
    );
  } finally {
    a.close();
    b.close();
  }
  const reopened = new Workroom(db);
  try {
    assert.equal(reopened.snapshot().tasks.filter((x) => x.productId === p.id).length, 1);
  } finally {
    reopened.close();
  }
});

test('subscribed drafts receive reports while manual text, exclusions, other targets, and exports remain intact', async (t) => {
  const { a, p, q } = await fixture(t);
  try {
    let folio = a.createPortfolio({ target: '자동 대상', autoProductIds: [p.id] });
    const manual = a.createPortfolio({ target: '수동 대상' });
    const input = report(p.id);
    const task = a.reportWork(input, 'mcp');
    folio = get(a, folio);
    assert.equal(folio.entries[0].taskId, task.id);
    assert.equal(get(a, manual).entries.length, 0);
    a.reportWork(report(q.id, 'other'), 'mcp');
    assert.equal(get(a, folio).entries.length, 1);
    folio = save(a, folio, {
      intro: '소개',
      entries: [{ ...folio.entries[0], description: '직접 고친 문장' }],
    });
    a.recordExport(folio.id, a.prepareExport(folio.id, folio.revision), 'immutable.html');
    a.reportWork(
      { ...input, sourceVersion: 2, title: '검색 누락 재검사', summary: '새 보고 문장' },
      'mcp',
    );
    folio = get(a, folio);
    assert.equal(folio.entries[0].title, '검색 누락 재검사');
    assert.equal(folio.entries[0].description, '직접 고친 문장');
    assert.equal(folio.exports[0].snapshot.entries[0].title, input.title);
    folio = save(a, folio, { entries: [] });
    a.reportWork({ ...input, sourceVersion: 3, summary: '다시 보고함' }, 'mcp');
    assert.equal(get(a, folio).entries.length, 0);
    assert.deepEqual(get(a, folio).excludedTaskIds, [task.id]);
    folio = save(a, get(a, folio), {
      entries: [
        {
          taskId: task.id,
          title: '직접 다시 포함',
          description: '내 문장',
          contribution: input.contribution,
        },
      ],
    });
    assert.deepEqual(folio.excludedTaskIds, []);
    a.reportWork({ ...input, sourceVersion: 4, title: '바뀐 보고 제목' }, 'mcp');
    assert.equal(get(a, folio).entries[0].title, '직접 다시 포함');
    folio = save(a, get(a, folio), { autoProductIds: [] });
    a.reportWork(report(p.id, 'after-stop'), 'mcp');
    assert.equal(get(a, folio).entries.length, 1);
  } finally {
    a.close();
  }
});

test('draft capacity queues new work, removing a case fills a slot, and stopping clears only pending inclusion', async (t) => {
  const { a, p } = await fixture(t);
  try {
    let f = a.createPortfolio({ target: '한도 검사', autoProductIds: [p.id] });
    for (let i = 0; i < 22; i++) a.reportWork(report(p.id, `task-${i}`), 'mcp');
    f = get(a, f);
    assert.equal(f.entries.length, 20);
    assert.equal(f.pendingTaskIds.length, 2);
    const removed = f.entries[0].taskId,
      waiting = f.pendingTaskIds[0];
    f = save(a, f, { entries: f.entries.slice(1) });
    assert.equal(f.entries.length, 20);
    assert.equal(f.pendingTaskIds.length, 1);
    assert.ok(f.entries.some((x) => x.taskId === waiting));
    assert.ok(f.excludedTaskIds.includes(removed));
    f = save(a, f, { autoProductIds: [] });
    assert.equal(f.pendingTaskIds.length, 0);
    assert.equal(a.snapshot().tasks.length, 22);
  } finally {
    a.close();
  }
});

test('report, knowledge, and derived drafts roll back together on a write failure', async (t) => {
  const { a, p } = await fixture(t);
  try {
    const f = a.createPortfolio({ target: '원자성', autoProductIds: [p.id] });
    const before = a.snapshot();
    const original = a.store.update.bind(a.store);
    a.store.update = (kind, ...args) => {
      if (kind === 'portfolio') throw new Error('simulated write failure');
      return original(kind, ...args);
    };
    assert.throws(() => a.reportWork(report(p.id), 'mcp'), /simulated/);
    assert.deepEqual(a.snapshot(), before);
    a.store.update = original;
    a.reportWork(report(p.id), 'mcp');
    assert.equal(get(a, f).entries.length, 1);
  } finally {
    a.close();
  }
});

test('in-progress edits merge incoming reports but concurrent manual conflicts require an explicit choice', async (t) => {
  const { a, p } = await fixture(t);
  try {
    const f = a.createPortfolio({ target: '병합', autoProductIds: [p.id] });
    const input = report(p.id);
    a.reportWork(input, 'mcp');
    const base = get(a, f);
    const local = structuredClone(base);
    local.entries[0].description = '작성 중인 문장';
    local.intro = '작성 중인 소개';
    a.reportWork(
      { ...input, sourceVersion: 2, summary: '외부 수정 보고', title: '수정된 제목' },
      'mcp',
    );
    a.reportWork(report(p.id, 'new-task'), 'mcp');
    let remote = get(a, f);
    const merged = mergeDraft(base, local, remote);
    assert.equal(merged.entries.length, 2);
    assert.equal(merged.intro, local.intro);
    assert.equal(merged.entries[0].description, local.entries[0].description);
    assert.equal(merged.entries[0].title, '수정된 제목');
    remote = save(a, remote, { intro: '다른 창의 소개' });
    assert.throws(() => mergeDraft(base, local, remote), /다른 창/);
    const chosen = mergeDraft(base, local, remote, true);
    assert.equal(chosen.intro, local.intro);
    assert.equal(chosen.entries.length, 2);
    const excluded = structuredClone(base);
    excluded.entries = [];
    assert.equal(mergeDraft(base, excluded, remote).entries.length, 1);
  } finally {
    a.close();
  }
});
