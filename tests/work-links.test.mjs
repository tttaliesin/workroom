import test from 'node:test';
import assert from 'node:assert/strict';
import { Workroom } from '../src/core/service.mjs';
import { projectWork } from '../src/core/work-projection.mjs';
const input = (productId, externalId, workTaskId) => ({
  productId,
  externalId,
  ...(workTaskId ? { workTaskId } : {}),
  title: externalId,
  summary: `${externalId}의 결과`,
  evidence: '보고된 근거',
  limitations: '운영 미확인',
  contribution: '사용자 검토 / 에이전트 구현',
});
const task = (r, id) => r.store.get('task', id);
const portfolio = (r, id) => r.store.get('portfolio', id);
const save = (r, p, entries = p.entries) =>
  r.savePortfolio({
    id: p.id,
    revision: p.revision,
    intro: '개발 경험',
    requirements: p.requirements,
    entries,
  });
async function setup() {
  const r = new Workroom(':memory:');
  const p = await r.createProduct({ name: '제품', folder: process.cwd() });
  return { r, p };
}

test('explicitly linked reports survive corrections, updates and immutable export history', async () => {
  const { r, p } = await setup();
  try {
    const f = r.createPortfolio({ target: '기업', autoProductIds: [p.id] });
    const root = r.reportWork(input(p.id, '입력 보존'), 'mcp');
    const childInput = input(p.id, 'CSV 인코딩', root.id);
    const child = r.reportWork(childInput, 'mcp');
    let f1 = portfolio(r, f.id);
    assert.equal(f1.entries.length, 1);
    assert.match(f1.entries[0].description, /CSV/);
    f1 = save(r, f1);
    const exported = r.prepareExport(f.id, f1.revision);
    r.recordExport(f.id, exported, 'frozen.html');
    const separated = r.changeWorkLink({
      id: child.id,
      revision: child.revision,
      parentTaskId: null,
      reason: '다른 문제의 실행',
    });
    assert.equal(separated.task.id, child.id);
    assert.equal(separated.task.evidence, child.evidence);
    f1 = portfolio(r, f.id);
    assert.equal(f1.entries.length, 1);
    assert.doesNotMatch(f1.entries[0].description, /CSV/);
    assert.match(f1.exports[0].snapshot.entries[0].description, /CSV/);
    const updated = r.reportWork(
      { ...childInput, sourceVersion: 2, summary: '분리 이후 새 근거' },
      'mcp',
    );
    assert.equal(
      updated.parentTaskId,
      null,
      'incoming original workTaskId must not undo user correction',
    );
    assert.equal(
      portfolio(r, f.id).entries.length,
      1,
      'separated work stays material rather than auto-added case',
    );
    assert.equal(r.snapshot().reports.filter((v) => v.taskId === child.id).length, 2);
    const rootNow = task(r, root.id);
    r.changeWorkLink({
      id: child.id,
      revision: updated.revision,
      parentTaskId: root.id,
      parentRevision: rootNow.revision,
      reason: '원본 연결 복원',
    });
    assert.equal(r.snapshot().tasks.length, 2);
    assert.match(projectWork(task(r, root.id), r.snapshot().tasks).summary, /새 근거/);
  } finally {
    r.close();
  }
});

test('manual copy needs source review, export remains blocked after ordinary draft save, targets stay isolated', async () => {
  const { r, p } = await setup();
  try {
    const a = r.createPortfolio({ target: 'A', autoProductIds: [p.id] }),
      b = r.createPortfolio({ target: 'B', autoProductIds: [p.id] });
    const root = r.reportWork(input(p.id, '입력'));
    const child = r.reportWork(input(p.id, '별도 조사', root.id));
    let f = portfolio(r, a.id);
    f = save(r, f, [{ ...f.entries[0], description: '직접 편집한 글' }]);
    const frozen = r.prepareExport(f.id, f.revision);
    r.recordExport(f.id, frozen, 'old.html');
    r.changeWorkLink({
      id: child.id,
      revision: child.revision,
      parentTaskId: null,
      reason: '잘못된 연결',
    });
    f = portfolio(r, a.id);
    assert.equal(f.entries[0].description, '직접 편집한 글');
    assert.ok(f.entrySources[root.id].sourceConflict);
    assert.doesNotMatch(portfolio(r, b.id).entries[0].description, /별도 조사/);
    f = save(r, f);
    assert.throws(() => r.prepareExport(f.id, f.revision), /연결이 바뀐/);
    assert.throws(
      () =>
        r.reviewPortfolioSource({
          id: f.id,
          revision: f.revision - 1,
          taskId: root.id,
          mode: 'keep',
        }),
      /초안이 바뀌/,
    );
    f = r.reviewPortfolioSource({
      id: f.id,
      revision: f.revision,
      taskId: root.id,
      mode: 'regenerate',
    });
    assert.equal(f.entries[0].description, '입력의 결과');
    assert.equal(f.exports[0].snapshot.entries[0].description, '직접 편집한 글');
    assert.doesNotThrow(() => r.prepareExport(f.id, f.revision));
  } finally {
    r.close();
  }
});

test('link correction rejects stale graphs and cycles and rolls back all derived writes', async () => {
  const { r, p } = await setup();
  try {
    r.createPortfolio({ target: 'A', autoProductIds: [p.id] });
    const a = r.reportWork(input(p.id, 'A')),
      b = r.reportWork(input(p.id, 'B'));
    assert.throws(
      () =>
        r.changeWorkLink({
          id: a.id,
          revision: a.revision,
          parentTaskId: a.id,
          parentRevision: a.revision,
          reason: '순환',
        }),
      /독립된/,
    );
    const before = r.snapshot();
    const update = r.store.update.bind(r.store);
    r.store.update = (kind, ...args) => {
      if (kind === 'portfolio') throw new Error('write failure');
      return update(kind, ...args);
    };
    assert.throws(
      () =>
        r.changeWorkLink({
          id: b.id,
          revision: b.revision,
          parentTaskId: a.id,
          parentRevision: a.revision,
          reason: '같은 문제',
        }),
      /write failure/,
    );
    assert.deepEqual(r.snapshot(), before);
    r.store.update = update;
    r.changeWorkLink({
      id: b.id,
      revision: b.revision,
      parentTaskId: a.id,
      parentRevision: a.revision,
      reason: '같은 문제',
    });
    assert.throws(
      () =>
        r.changeWorkLink({
          id: b.id,
          revision: b.revision,
          parentTaskId: null,
          reason: '오래된 검토',
        }),
      /변경/,
    );
    assert.throws(
      () =>
        r.changeWorkLink({
          id: a.id,
          revision: task(r, a.id).revision,
          parentTaskId: b.id,
          parentRevision: task(r, b.id).revision,
          reason: '순환',
        }),
      /하위 실행/,
    );
  } finally {
    r.close();
  }
});

test('held records are not served; changed reports preserve edited conditions and exact earlier retrievals', async () => {
  const { r, p } = await setup();
  try {
    const report = input(p.id, '입력 보호');
    r.reportWork(report, 'mcp');
    let record = r.snapshot().records[0];
    r.context({ productId: p.id, query: '입력' });
    const provided = r.snapshot().contextUses[0].records[0];
    record = r.reviewRecord({
      id: record.id,
      revision: record.revision,
      content: '폼 이동 시 입력 보존',
      scope: '폼 상태와 종료 처리 변경',
      validity: 'valid',
      reason: '현재 폼의 적용 범위 확인',
    });
    r.reportWork({ ...report, sourceVersion: 2, summary: '자동 저장 구조로 변경' }, 'mcp');
    record = r.store.get('record', record.id);
    assert.equal(record.validity, 'needs_review');
    assert.equal(record.scope, '폼 상태와 종료 처리 변경');
    assert.equal(r.context({ productId: p.id }).records.length, 0);
    assert.equal(r.snapshot().contextUses[0].records[0].content, provided.content);
    assert.ok(r.snapshot().recordHistory.length >= 2);
    record = r.toggleRecord({ id: record.id, revision: record.revision, active: false });
    r.reviewRecord({
      id: record.id,
      revision: record.revision,
      content: record.content,
      scope: record.scope,
      validity: 'valid',
      reason: '재확인',
    });
    assert.equal(
      r.context({ productId: p.id }).records.length,
      0,
      'validity review does not revoke user exclusion',
    );
  } finally {
    r.close();
  }
});
