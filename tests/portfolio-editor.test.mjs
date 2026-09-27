import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workroom } from '../src/core/service.mjs';
import { AgentEngine } from '../src/runtime/engine.mjs';
async function until(fn) {
  for (let i = 0; i < 400; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('editor wait timed out');
}
async function fixture(
  t,
  { badQuote = false, hold = false, limitQuote = false, failures = 0 } = {},
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workroom-editor-')),
    folder = path.join(dir, 'p');
  await mkdir(folder);
  const room = new Workroom(path.join(dir, 'db.sqlite')),
    product = await room.createProduct({ name: 'tool', folder, goal: 'input' });
  const p = room.createPortfolio({
    target: 'Tools team',
    requirements: 'Input reliability and developer workflows',
    autoProductIds: [product.id],
  });
  const report = room.reportWork({
    productId: product.id,
    title: 'Input repair',
    summary: 'Preserved drafts when changing views.',
    evidence: 'Recorded fixture checks.',
    limitations: 'Fixture only.',
    contribution: 'Implemented draft persistence.',
  });
  let engine;
  const calls = [];
  const broker = {
    status: { state: 'ready', models: [{ id: 'fixture' }] },
    request: async (method, input) => {
      if (method === 'abort') return {};
      calls.push(input.role);
      if (failures-- > 0) return { failure: { code: 'network', message: 'fixture' } };
      if (hold && input.role === 'curate') await new Promise((r) => (broker.release = r));
      const source = input.handoff.portfolio.sources[0];
      assert.equal(source.evidence, undefined);
      assert.equal(source.folder, undefined);
      if (input.role === 'curate')
        return {
          result: {
            intro: 'I build reliable input tools.',
            introCitations: [
              { taskId: source.id, revision: source.revision, quote: source.summary },
            ],
            entries: [
              {
                taskId: source.id,
                title: 'Reliable input',
                description: 'Preserved drafts across views.',
                contribution: source.contribution,
                reason: 'Matches input reliability.',
                citations: [
                  {
                    taskId: source.id,
                    revision: source.revision,
                    quote: badQuote
                      ? 'Invented performance numbers'
                      : limitQuote
                        ? source.limitations
                        : source.summary,
                  },
                ],
              },
            ],
            limitations: 'No production metrics.',
          },
        };
      return {
        result: {
          verdict: 'supported',
          assessment: 'Claims match supplied source.',
          sourceTaskIds: [source.id],
          limitations: 'Source report only.',
        },
      };
    },
  };
  engine = new AgentEngine(room, broker, { agentDirectory: dir });
  engine.configure({ modelId: 'fixture' });
  t.after(async () => {
    engine.closed = true;
    broker.release?.();
    await until(() => !engine.active.size && !engine.operations.busy);
    room.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { room, product, p, report, engine, broker, calls };
}
test('automatic failed edit recovers the same signature and keeps a single proposal', async (t) => {
  const f = await fixture(t, { failures: 1 });
  const p = f.room.store.get('portfolio', f.p.id);
  f.engine.editor.configure({ id: p.id, revision: p.revision, enabled: true });
  const task = f.engine.editor.request({ portfolioId: p.id, automatic: true });
  await until(
    () =>
      f.room.store.get('task', task.id).retryAt &&
      !f.engine.active.size &&
      !f.engine.operations.busy,
  );
  f.engine.recovery.now = () => Date.now() + 31000;
  f.engine.recovery.tick();
  await until(
    () =>
      f.room.store.list('portfolio-edit')[0].status === 'applied' &&
      !f.engine.active.size &&
      !f.engine.operations.busy,
  );
  assert.equal(f.room.store.list('portfolio-edit').length, 1);
  assert.equal(f.room.store.get('task', task.id).recoveryRetries, 1);
});
test('relevance selection includes old experience beyond the recent 30 and versions pasted job sources', async (t) => {
  const f = await fixture(t);
  for (let n = 0; n < 35; n++)
    f.room.reportWork({
      productId: f.product.id,
      title: `Unrelated layout ${n}`,
      summary: 'Spacing colors.',
      evidence: 'Fixture',
      limitations: 'Fixture',
      contribution: 'Layout',
    });
  let p = f.room.store.get('portfolio', f.p.id);
  f.room.saveJobSource({
    portfolioId: p.id,
    revision: p.revision,
    url: 'https://example.com/job',
    description: 'Input reliability and developer workflows',
  });
  p = f.room.store.get('portfolio', p.id);
  assert(f.engine.editor.sources(p).some((s) => s.id === f.report.id));
  const first = p.jobSourceId;
  f.room.saveJobSource({
    portfolioId: p.id,
    revision: p.revision,
    url: 'https://example.com/job',
    description: 'Updated input reliability',
  });
  const latest = f.room.store.list('job-source')[0];
  assert.equal(latest.previousId, first);
  assert.equal(latest.version, 2);
  assert.equal(
    f.room.store.get('job-source', first).description,
    'Input reliability and developer workflows',
  );
});
test('target editing and independent review auto-apply once, preserving human fields and order', async (t) => {
  const f = await fixture(t);
  let p = f.room.store.get('portfolio', f.p.id);
  f.room.savePortfolio({
    id: p.id,
    revision: p.revision,
    intro: 'Human introduction',
    requirements: p.requirements,
    entries: p.entries.map((e) => ({ ...e, contribution: 'Human contribution' })),
    autoProductIds: p.autoProductIds,
  });
  p = f.room.store.get('portfolio', p.id);
  f.engine.editor.configure({ id: p.id, revision: p.revision, enabled: true });
  await f.engine.editor.tick();
  await until(
    () =>
      f.room.store.list('portfolio-edit')[0]?.status === 'applied' &&
      !f.engine.active.size &&
      !f.engine.operations.busy,
  );
  p = f.room.store.get('portfolio', p.id);
  assert.equal(p.intro, 'Human introduction');
  assert.equal(p.entries[0].contribution, 'Human contribution');
  assert.equal(p.entries[0].title, 'Reliable input');
  assert.equal(p.entrySources[f.report.id].selectionReason, 'Matches input reliability.');
  await f.engine.editor.tick();
  assert.deepEqual(f.calls, ['curate', 'curate_review']);
});
test('unverifiable quotes are rejected before an independent review or any draft change', async (t) => {
  const f = await fixture(t, { badQuote: true });
  const p = f.room.store.get('portfolio', f.p.id);
  const task = f.engine.editor.request({ portfolioId: p.id });
  await until(
    () => f.room.store.get('task', task.id).status === 'needs_review' && !f.engine.active.size,
  );
  assert.equal(f.room.store.get('portfolio', p.id).revision, p.revision);
  assert.deepEqual(f.calls, ['curate']);
});
test('editing the target while a model is running preserves the newer version', async (t) => {
  const f = await fixture(t, { hold: true });
  const task = f.engine.editor.request({ portfolioId: f.p.id });
  await until(() => !!f.broker.release);
  const p = f.room.store.get('portfolio', f.p.id);
  f.room.savePortfolio({
    id: p.id,
    revision: p.revision,
    intro: 'A newer human draft',
    requirements: p.requirements,
    entries: p.entries,
    autoProductIds: p.autoProductIds,
  });
  f.broker.release();
  await until(
    () => f.room.store.get('task', task.id).status === 'needs_review' && !f.engine.active.size,
  );
  assert.equal(f.room.store.get('portfolio', p.id).intro, 'A newer human draft');
  assert.deepEqual(f.calls, ['curate']);
});

test('verbatim limitation citations remain valid and are reviewed before application', async (t) => {
  const f = await fixture(t, { limitQuote: true });
  f.engine.editor.request({ portfolioId: f.p.id });
  await until(
    () =>
      f.room.store.list('portfolio-edit')[0]?.status === 'proposed' &&
      !f.engine.active.size &&
      !f.engine.operations.busy,
  );
  const edit = f.room.store.list('portfolio-edit')[0];
  f.engine.editor.apply({ id: edit.id });
  assert.equal(f.room.store.get('portfolio-edit', edit.id).status, 'applied');
  assert.deepEqual(f.calls, ['curate', 'curate_review']);
});
test('curation omits unselected automatic cases but preserves explicit exclusions and edited cases', async (t) => {
  const f = await fixture(t);
  const payload = {
    productId: f.product.id,
    title: 'Another report',
    summary: 'Another source.',
    evidence: 'fixture',
    limitations: 'fixture',
    contribution: 'fixture',
  };
  const second = f.room.reportWork({ ...payload, externalId: 'two' }),
    third = f.room.reportWork({ ...payload, externalId: 'three' }),
    excluded = f.room.reportWork({ ...payload, externalId: 'excluded' });
  let p = f.room.store.get('portfolio', f.p.id);
  f.room.savePortfolio({
    id: p.id,
    revision: p.revision,
    intro: p.intro,
    requirements: p.requirements,
    autoProductIds: p.autoProductIds,
    entries: p.entries
      .filter((e) => e.taskId !== excluded.id)
      .map((e) => (e.taskId === third.id ? { ...e, title: 'Human-selected case' } : e)),
  });
  f.engine.editor.request({ portfolioId: p.id });
  await until(
    () =>
      f.room.store.list('portfolio-edit')[0]?.status === 'proposed' &&
      !f.engine.active.size &&
      !f.engine.operations.busy,
  );
  const edit = f.room.store.list('portfolio-edit')[0],
    chosen = edit.proposal.entries[0].taskId;
  f.engine.editor.apply({ id: edit.id });
  p = f.room.store.get('portfolio', p.id);
  assert(p.entries.some((e) => e.taskId === chosen));
  assert(p.entries.some((e) => e.taskId === third.id && e.title === 'Human-selected case'));
  assert(!p.entries.some((e) => e.taskId === excluded.id));
  const omitted = [f.report.id, second.id].filter((id) => id !== chosen);
  assert(omitted.every((id) => !p.entries.some((e) => e.taskId === id)));
  f.room.reportWork({
    ...payload,
    externalId: second.id === chosen ? 'three' : 'two',
    sourceVersion: 2,
    summary: 'Changed source.',
  });
  p = f.room.store.get('portfolio', p.id);
  assert(omitted.every((id) => !p.entries.some((e) => e.taskId === id)));
});
