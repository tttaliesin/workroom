import test from 'node:test';
import assert from 'node:assert/strict';
import { Workroom } from '../src/core/service.mjs';
import { Publications } from '../src/core/publication.mjs';
import { VercelPublisher } from '../src/integrations/vercel.mjs';

function fixture(t, { timeout = false, wrongBody = false } = {}) {
  const room = new Workroom(':memory:');
  t.after(() => room.close());
  const product = room.store.create('product', { name: 'fixture' });
  const task = room.reportWork({
    productId: product.id,
    title: 'Public case',
    summary: 'Public description',
    evidence: 'PRIVATE evidence',
    limitations: 'PRIVATE notes',
    contribution: 'Public contribution',
  });
  let p = room.createPortfolio({ target: 'Employer' });
  p = room.savePortfolio({
    id: p.id,
    revision: p.revision,
    intro: 'Public introduction',
    requirements: '',
    entries: [
      {
        taskId: task.id,
        title: task.title,
        description: task.summary,
        contribution: task.contribution,
      },
    ],
  });
  const calls = [];
  let deployment, html;
  const provider = new VercelPublisher(
    { read: () => ({ access: 'fixture-token' }) },
    async (url, options) => {
      url = String(url);
      calls.push({ url, options });
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        html = Buffer.from(body.files[0].data, 'base64').toString('utf8');
        assert(!html.includes('PRIVATE'));
        deployment = {
          id: 'dpl_fixture',
          url: 'fixture.vercel.app',
          readyState: 'READY',
          meta: body.meta,
        };
        if (timeout) throw new Error('network timeout after remote commit');
        return Response.json(deployment);
      }
      if (url.includes('/v9/projects/')) return Response.json({ id: 'prj_fixture' });
      if (url.includes('/v7/deployments'))
        return Response.json({ deployments: deployment ? [deployment] : [], pagination: {} });
      if (url.includes('/v13/deployments/')) return Response.json(deployment);
      assert.equal(url, 'https://fixture.vercel.app');
      assert.equal(options.headers, undefined);
      return new Response(wrongBody ? 'unreviewed body' : html);
    },
  );
  const publications = new Publications(room, provider);
  publications.configure({ portfolioId: p.id, version: 0, project: 'fixture', teamId: '' });
  const version = publications.prepare({ portfolioId: p.id, revision: p.revision });
  return { room, p, task, publications, calls, version };
}
test('uncertain submission reconciles after restart without another deployment and verifies public bytes', async (t) => {
  const f = fixture(t, { timeout: true });
  await f.publications.publish({ id: f.version.id, artifactHash: f.version.artifactHash });
  assert.equal(f.room.store.get('publication', f.version.id).status, 'uncertain');
  const another = f.publications.prepare({ portfolioId: f.p.id, revision: f.p.revision });
  await assert.rejects(
    () => f.publications.publish({ id: another.id, artifactHash: another.artifactHash }),
    /이전 요청/,
  );
  const restarted = new Publications(f.room, f.publications.provider);
  const result = await restarted.publish({
    id: f.version.id,
    artifactHash: f.version.artifactHash,
  });
  assert.equal(result.status, 'published');
  assert(result.verifiedAt);
  assert.equal(f.calls.filter((c) => c.options.method === 'POST').length, 1);
  const p = f.room.store.get('portfolio', f.p.id);
  f.room.savePortfolio({
    id: p.id,
    revision: p.revision,
    intro: 'New introduction',
    requirements: '',
    entries: p.entries,
  });
  assert.equal(f.room.store.get('publication', result.id).snapshot.intro, 'Public introduction');
  const restored = restarted.prepare({
    portfolioId: p.id,
    revision: p.revision + 1,
    restoreId: result.id,
  });
  assert.equal(restored.artifactHash, result.artifactHash);
  assert.equal(restored.status, 'prepared');
  assert.equal(f.calls.filter((c) => c.options.method === 'POST').length, 1);
});
test('changed drafts reject publication and READY alone is not public verification', async (t) => {
  const f = fixture(t, { wrongBody: true });
  await assert.rejects(() => f.publications.publish({ id: f.version.id, artifactHash: 'wrong' }));
  await f.publications.publish({ id: f.version.id, artifactHash: f.version.artifactHash });
  const result = await f.publications.reconcile({ id: f.version.id });
  assert.equal(result.status, 'unverified');
  assert.equal(result.verifiedAt, null);
  const draft = f.publications.prepare({ portfolioId: f.p.id, revision: f.p.revision });
  f.room.savePortfolio({
    id: f.p.id,
    revision: f.p.revision,
    intro: 'Changed',
    requirements: '',
    entries: f.p.entries,
  });
  await assert.rejects(
    () => f.publications.publish({ id: draft.id, artifactHash: draft.artifactHash }),
    /바뀌었습니다/,
  );
});

test('submission is durable before network activity without separate attempt records', async (t) => {
  const f = fixture(t);
  const deploy = f.publications.provider.deploy.bind(f.publications.provider);
  f.publications.provider.deploy = async (p) => {
    assert.equal(f.room.store.get('publication', p.id).status, 'submitting');
    assert.deepEqual(f.room.store.list('publication-attempt'), []);
    return deploy(p);
  };
  const result = await f.publications.publish({
    id: f.version.id,
    artifactHash: f.version.artifactHash,
  });
  assert.equal(result.status, 'building');
  assert.equal(result.deploymentId, 'dpl_fixture');
  assert.deepEqual(f.room.store.list('publication-attempt'), []);
});

test('failed persistence before submission never sends a deployment', async (t) => {
  const f = fixture(t);
  const log = f.room.store.log.bind(f.room.store);
  f.room.store.log = () => {
    throw new Error('disk full');
  };
  await assert.rejects(
    () => f.publications.publish({ id: f.version.id, artifactHash: f.version.artifactHash }),
    /disk full/,
  );
  f.room.store.log = log;
  assert.equal(f.calls.length, 0);
  assert.equal(f.room.store.get('publication', f.version.id).status, 'prepared');
});

test('legacy attempt deployment ID is recovered without resubmitting', async (t) => {
  const f = fixture(t);
  const attempt = f.room.store.create('publication-attempt', {
    publicationId: f.version.id,
    operationKey: f.version.id,
    deploymentId: 'dpl_legacy',
    status: 'submitted',
  });
  f.publications.save(f.version, { status: 'submitting', attemptId: attempt.id });
  const recovered = new Publications(f.room, {
    find: async (p) => {
      assert.equal(p.deploymentId, 'dpl_legacy');
      return { id: 'dpl_legacy', readyState: 'BUILDING' };
    },
  });
  const result = await recovered.publish({
    id: f.version.id,
    artifactHash: f.version.artifactHash,
  });
  assert.equal(result.status, 'building');
  assert.equal(result.deploymentId, 'dpl_legacy');
  assert.equal(f.calls.length, 0);
  assert.equal(f.room.store.list('publication-attempt').length, 1);
});
