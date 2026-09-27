import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { Workroom } from '../src/core/service.mjs';
import { portfolioHTML } from '../src/core/export.mjs';
import { projectRoot } from '../src/core/paths.mjs';

function fixture(t) {
  const parent = path.join(projectRoot, 'work/tests');
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(path.join(parent, 'core-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  mkdirSync(repo);
  return { dir, repo, db: path.join(dir, 'workroom.sqlite') };
}
const report = (productId) => ({
  productId,
  title: '검색 오류 수정',
  summary: '누락 조건을 재현해 수정했습니다.',
  evidence: '작업자가 test 3건 통과를 보고함',
  limitations: '운영 환경과 실제 사용자 데이터 미검증',
  contribution: '사용자: 요구사항 결정, 에이전트: 코드 작성',
});
test('product registration persists, rejects duplicate roots, and protects stale edits across connections', async (t) => {
  const f = fixture(t);
  const a = new Workroom(f.db);
  const b = new Workroom(f.db);
  try {
    const p = await a.createProduct({ name: '제품 A', folder: f.repo });
    assert.equal(b.snapshot().products[0].id, p.id);
    await assert.rejects(() => b.createProduct({ name: '중복', folder: f.repo }), /이미 등록/);
    a.updateProduct({ id: p.id, revision: p.revision, goal: '새 목표' });
    assert.throws(
      () => b.updateProduct({ id: p.id, revision: p.revision, goal: '덮어쓰기' }),
      /먼저 수정/,
    );
    assert.equal(b.snapshot().products[0].goal, '새 목표');
  } finally {
    a.close();
    b.close();
  }
  const reopened = new Workroom(f.db);
  assert.equal(reopened.snapshot().products[0].goal, '새 목표');
  reopened.close();
});
test('inspection observes files without executing scripts; repeated inspection updates one record and preserves exclusion', async (t) => {
  const f = fixture(t),
    a = new Workroom(f.db);
  writeFileSync(
    path.join(f.repo, 'package.json'),
    JSON.stringify({
      scripts: { test: "node -e \"require('fs').writeFileSync('executed','bad')\"" },
    }),
  );
  try {
    const p = await a.createProduct({ name: '테스트 제품', folder: f.repo });
    const first = await a.inspect({ productId: p.id });
    assert.equal(first.verification, 'observed');
    assert.ok(first.result.findings.some((x) => x.includes('README')));
    assert.equal(first.status, 'partial');
    assert.ok(first.result.unconfirmed.length > 0);
    assert.ok(!existsSync(path.join(f.repo, 'executed')));
    let record = a.snapshot().records[0];
    a.toggleRecord({ id: record.id, revision: record.revision, active: false });
    await a.inspect({ productId: p.id });
    assert.equal(a.snapshot().records.length, 1);
    assert.equal(a.snapshot().records[0].active, false);
    assert.equal(a.snapshot().tasks.length, 2);
    assert.equal((await a.context({ productId: p.id })).records.length, 0);
  } finally {
    a.close();
  }
});
test('decision and knowledge are atomic, one-time, and scoped to the selected product', async (t) => {
  const f = fixture(t),
    a = new Workroom(f.db);
  const repo2 = path.join(f.dir, 'repo2');
  mkdirSync(repo2);
  try {
    const p = await a.createProduct({ name: '제품 A', folder: f.repo });
    const other = await a.createProduct({ name: '제품 B', folder: repo2 });
    let t = a.requestDecision(
      {
        productId: p.id,
        title: '중복 처리',
        reason: '같은 ID 충돌',
        options: [
          { label: '유지', effect: '충돌한 항목 제외' },
          { label: '변경', effect: '기존 값 덮어쓰기' },
        ],
      },
      'mcp',
    );
    t = a.deferDecision({ id: t.id, revision: t.revision, deferred: true });
    assert.equal(t.status, 'deferred');
    a.resolveDecision({ id: t.id, revision: t.revision, option: 0 });
    assert.throws(() => a.resolveDecision({ id: t.id, revision: t.revision, option: 1 }));
    assert.equal(a.snapshot().records.length, 1);
    assert.equal((await a.context({ productId: other.id })).records.length, 0);
    assert.match((await a.context({ productId: p.id, query: '중복' })).records[0].content, /유지/);
  } finally {
    a.close();
  }
});
test('work reports retain provenance; portfolio snapshots exclude internal metadata and escape HTML', async (t) => {
  const f = fixture(t),
    a = new Workroom(f.db);
  try {
    const p = await a.createProduct({ name: '제품', folder: f.repo });
    const task = a.reportWork(report(p.id), 'mcp');
    assert.equal(task.verification, 'reported');
    assert.equal(a.snapshot().records[0].provenance, 'reported');
    let portfolio = a.createPortfolio({
      target: '비공개 기업',
      requirements: '내부 메모 SECRET_SCOPE',
    });
    portfolio = a.savePortfolio({
      id: portfolio.id,
      revision: portfolio.revision,
      intro: '<script>alert(1)</script>',
      requirements: portfolio.requirements,
      entries: [
        {
          taskId: task.id,
          title: task.title,
          description: task.summary,
          contribution: task.contribution,
        },
      ],
    });
    const snapshot = a.prepareExport(portfolio.id, portfolio.revision);
    const html = portfolioHTML(snapshot);
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!html.includes('SECRET_SCOPE'));
    assert.ok(!html.includes(f.repo));
    assert.ok(!html.includes(task.evidence));
    const out = path.join(f.dir, 'portfolio.html');
    writeFileSync(out, html);
    a.recordExport(portfolio.id, snapshot, out);
    portfolio = a.snapshot().portfolios[0];
    a.savePortfolio({
      id: portfolio.id,
      revision: portfolio.revision,
      intro: '새 초안',
      requirements: portfolio.requirements,
      entries: portfolio.entries,
    });
    assert.equal(readFileSync(out, 'utf8'), html);
    assert.equal(a.snapshot().portfolios[0].exports[0].snapshot.intro, snapshot.intro);
    assert.throws(() => a.prepareExport(portfolio.id, portfolio.revision), /변경/);
    const second = a.createPortfolio({ target: '다른 기업' });
    assert.equal(second.intro, '');
  } finally {
    a.close();
  }
});
test('invalid references and revisions cannot leave partial data', async (t) => {
  const f = fixture(t),
    a = new Workroom(f.db);
  try {
    const p = await a.createProduct({ name: '제품', folder: f.repo });
    const t = a.requestDecision({
      productId: p.id,
      title: '결정',
      reason: '확인',
      options: [
        { label: 'A', effect: 'A' },
        { label: 'B', effect: 'B' },
      ],
    });
    assert.throws(
      () => a.resolveDecision({ id: t.id, revision: t.revision + 1, option: 0 }),
      /먼저 수정/,
    );
    assert.equal(a.snapshot().records.length, 0);
    assert.equal(a.snapshot().tasks[0].status, 'needs_decision');
    const folio = a.createPortfolio({ target: '대상' });
    assert.throws(
      () =>
        a.savePortfolio({
          id: folio.id,
          revision: folio.revision,
          intro: '제목',
          requirements: '',
          entries: [{ taskId: t.id, title: '제목', description: '설명', contribution: '기여' }],
        }),
      /성과/,
    );
    assert.equal(a.snapshot().portfolios[0].entries.length, 0);
  } finally {
    a.close();
  }
});

test('structured evidence remains reported, validates check outcomes, and preserves legacy reports', async (t) => {
  const f = fixture(t),
    a = new Workroom(f.db);
  try {
    const p = await a.createProduct({ name: '제품', folder: f.repo });
    const legacy = a.reportWork(report(p.id));
    assert.deepEqual(legacy.changedFiles, []);
    assert.deepEqual(legacy.checks, []);
    const changedFiles = [{ path: 'src/input.js', summary: '미저장 입력 보존' }];
    const checks = [
      { name: '회귀 검사', result: 'passed', detail: '작업자가 통과를 보고함' },
      { name: '운영 환경', result: 'unconfirmed', detail: '실행 안 함' },
    ];
    const task = a.reportWork({ ...report(p.id), changedFiles, checks }, 'mcp');
    assert.equal(task.verification, 'reported');
    const stored = a.snapshot().tasks.find((t) => t.id === task.id);
    assert.deepEqual(stored.changedFiles, changedFiles);
    assert.deepEqual(stored.checks, checks);
    const before = a.snapshot();
    assert.throws(() =>
      a.reportWork({
        ...report(p.id),
        checks: [{ name: '검사', result: 'verified', detail: '증명 아님' }],
      }),
    );
    assert.equal(a.snapshot().tasks.length, before.tasks.length);
    assert.equal(a.snapshot().records.length, before.records.length);
  } finally {
    a.close();
  }
});
