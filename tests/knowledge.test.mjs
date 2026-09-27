import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { Workroom } from '../src/core/service.mjs';
import { AgentEngine } from '../src/runtime/engine.mjs';
import { readProductFile } from '../src/runtime/files.mjs';
import { projectRoot } from '../src/core/paths.mjs';

async function fixture(t) {
  const parent = path.join(projectRoot, 'work/tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'knowledge-'));
  const folder = path.join(directory, 'product');
  await mkdir(folder);
  await writeFile(path.join(folder, 'README.md'), 'Alpha uses the original setting.');
  const filename = path.join(directory, 'test.sqlite');
  const room = new Workroom(filename);
  const product = await room.createProduct({ name: 'Knowledge fixture', folder });
  t.after(async () => {
    room.close();
    assert.equal(path.dirname(directory), parent);
    await rm(directory, { recursive: true, force: true });
  });
  const evidence = room.store.create('agent-evidence', {
    productId: product.id,
    ...(await readProductFile(folder, 'README.md')),
  });
  const add = (fields = {}) =>
    room.store.create('record', {
      productId: product.id,
      title: 'Alpha setting',
      content: 'Alpha uses the original setting.',
      scope: 'Alpha configuration',
      source: 'Isolated fixture',
      active: true,
      validity: 'current',
      evidenceIds: [evidence.id],
      ...fields,
    });
  const mcp = (query = 'Alpha') => room.context({ productId: product.id, query });
  const pi = (goal = 'Alpha') =>
    AgentEngine.prototype.prepareContext.call(
      { room, store: room.store },
      { productId: product.id, goal },
    );
  return { room, product, folder, filename, evidence, add, mcp, pi };
}
const ids = (context) => context.records.map((r) => r.id);

test('unrelated questions and stopword-only queries do not match identifier fragments', async (t) => {
  const f = await fixture(t);
  f.add({ title: '모델 설정', content: 'revision, offline, IDisposable', scope: '이 제품의 설정' });
  for (const query of [
    'What is the capital of Argentina?',
    'How do I bake sourdough bread?',
    '이 제품의 월 구독 요금과 환불 규정은?',
    'what is the',
  ]) {
    assert.deepEqual(ids(await f.mcp(query)), [], query);
    assert.deepEqual(ids(await f.pi(query)), [], query);
  }
  assert.equal((await f.mcp('')).records.length, 1);
});

test('short technical names and complete identifiers remain distinct searchable terms', async (t) => {
  const f = await fixture(t);
  const records = new Map();
  for (const name of ['C++', 'C#', 'R', 'userId', 'userIdentity', 'HTTP 429'])
    records.set(name, f.add({ title: name, content: name, scope: '기술 자료' }));
  for (const name of records.keys())
    assert.deepEqual(ids(await f.mcp(name)), [records.get(name).id], name);
  assert.deepEqual(ids(await f.mcp('ＵＳＥＲＩＤ')), [records.get('userId').id]);
});

test('weak lexical overlap cannot outrank a strong semantic match, and low relevance is withheld', async (t) => {
  const f = await fixture(t);
  const strong = f.add({ title: '서명 자격증명 교체', content: '안전한 갱신 절차', scope: '인증' });
  const weak = f.add({ title: 'revision status', content: 'a status report', scope: 'status' });
  let scores = new Map([
    [strong.id, 0.83],
    [weak.id, 0.36],
  ]);
  f.room.knowledge.index = { search: async () => ({ scores, mode: 'hybrid' }), close() {} };
  const query = 'How do I rotate a signing credential?';
  assert.deepEqual(ids(await f.mcp(query)), [strong.id]);
  assert.deepEqual(ids(await f.pi(query)), [strong.id]);
  scores = new Map([[weak.id, 0.38]]);
  assert.deepEqual(ids(await f.mcp('Which Kubernetes namespace hosts PostgreSQL?')), []);
});

test('Pi and MCP use the same normalized query, ranking, exclusions and result limit', async (t) => {
  const f = await fixture(t);
  const partial = f.add({ title: 'Alpha only', content: 'Alpha', scope: 'Alpha' });
  const best = f.add({ title: 'Alpha beta' });
  f.add({ active: false });
  f.add({ validity: 'needs_review' });
  f.add({ productId: 'another-product' });
  const query = 'ＡＬＰＨＡ, beta!';
  const mcp = await f.mcp(query);
  assert.deepEqual(ids(mcp), [best.id, partial.id]);
  assert.equal(mcp.records.length, 2);
  assert.deepEqual(ids(await f.pi(query)), ids(mcp));
  assert.deepEqual(ids(await f.mcp('?!')), []);
  assert.deepEqual(ids(await f.pi('?!')), []);
  for (let i = 0; i < 15; i++) f.add();
  assert.deepEqual(ids(await f.pi('')), ids(await f.mcp('')));
  assert.deepEqual(ids(await f.pi()), ids(await f.mcp()));
  assert.equal((await f.pi()).records.length, 8);
});

test('MCP independently withholds changed and deleted file evidence and preserves supplied versions', async (t) => {
  const f = await fixture(t);
  const record = f.add();
  assert.deepEqual(ids(await f.mcp()), [record.id]);
  const supplied = f.room.snapshot().contextUses[0];
  await writeFile(path.join(f.folder, 'README.md'), 'Alpha now uses a different setting.');
  assert.deepEqual(ids(await f.mcp()), []);
  assert.equal(f.room.store.get('record', record.id).validity, 'needs_review');
  assert.deepEqual(ids(await f.pi()), []);
  assert.deepEqual(f.room.store.get('context-use', supplied.id), supplied);
  assert.equal(f.room.snapshot().recordHistory[0].snapshot.revision, record.revision);
  const deleted = f.add();
  await unlink(path.join(f.folder, 'README.md'));
  assert.deepEqual(ids(await f.mcp()), []);
  assert.equal(f.room.store.get('record', deleted.id).validity, 'needs_review');
});

test('stale candidates never consume the valid-result limit on the first query', async (t) => {
  const f = await fixture(t);
  const valid = f.add({ evidenceIds: [] });
  for (let i = 0; i < 12; i++) f.add();
  await writeFile(path.join(f.folder, 'README.md'), 'Changed source');
  assert.deepEqual(ids(await f.pi()), [valid.id]);
  assert.deepEqual(ids(await f.mcp()), [valid.id]);
  assert.deepEqual(ids(await f.pi()), [valid.id]);
});

test('missing and other-product evidence is withheld even when its path and hash match', async (t) => {
  const f = await fixture(t);
  const foreign = f.room.store.create('agent-evidence', {
    ...f.evidence,
    productId: 'other-product',
  });
  const wrongProduct = f.add({ evidenceIds: [foreign.id] });
  const missing = f.add({ evidenceIds: ['missing-evidence'] });
  assert.deepEqual(ids(await f.mcp()), []);
  for (const record of [wrongProduct, missing])
    assert.equal(f.room.store.get('record', record.id).validity, 'needs_review');
});

test('a concurrent exclusion of an already checked record wins before results are returned', async (t) => {
  const f = await fixture(t);
  const retained = f.add();
  const excluded = f.add();
  const peer = new Workroom(f.filename);
  try {
    let reads = 0;
    f.room.knowledge.readFile = async (...args) => {
      const file = await readProductFile(...args);
      if (++reads === 2)
        peer.toggleRecord({ id: excluded.id, revision: excluded.revision, active: false });
      return file;
    };
    assert.deepEqual(ids(await f.mcp()), [retained.id]);
    assert.equal(f.room.store.get('record', excluded.id).active, false);
    assert.deepEqual(ids({ records: f.room.snapshot().contextUses[0].records }), [retained.id]);
  } finally {
    peer.close();
  }
});

test('concurrent record corrections are neither supplied at the old revision nor overwritten by a stale check', async (t) => {
  const f = await fixture(t);
  const record = f.add();
  const peer = new Workroom(f.filename);
  await writeFile(path.join(f.folder, 'README.md'), 'Changed file');
  try {
    f.room.knowledge.readFile = async (...args) => {
      const file = await readProductFile(...args);
      peer.store.update('record', record.id, record.revision, {
        ...record,
        content: 'Manually corrected Alpha note',
        evidenceIds: [],
      });
      return file;
    };
    assert.deepEqual(ids(await f.mcp()), []);
    const current = f.room.store.get('record', record.id);
    assert.equal(current.content, 'Manually corrected Alpha note');
    assert.equal(current.validity, 'current');
    assert.equal(f.room.snapshot().recordHistory.length, 0);
    assert.deepEqual(ids(await f.mcp()), [record.id]);
  } finally {
    peer.close();
  }
});

test('evidence revisions changed during I/O cannot authorize a result from the old evidence', async (t) => {
  const f = await fixture(t);
  const record = f.add();
  const peer = new Workroom(f.filename);
  try {
    f.room.knowledge.readFile = async (...args) => {
      const file = await readProductFile(...args);
      peer.store.update('agent-evidence', f.evidence.id, f.evidence.revision, {
        ...f.evidence,
        productId: 'other-product',
      });
      return file;
    };
    assert.deepEqual(ids(await f.mcp()), []);
    assert.equal(f.room.store.get('record', record.id).validity, 'current');
    assert.deepEqual(ids(await f.mcp()), []);
    assert.equal(f.room.store.get('record', record.id).validity, 'needs_review');
  } finally {
    peer.close();
  }
});

test('product scope changes abort the query before supplied-version history is written', async (t) => {
  const f = await fixture(t);
  f.add();
  const peer = new Workroom(f.filename);
  try {
    f.room.knowledge.readFile = async (...args) => {
      const file = await readProductFile(...args);
      peer.updateProduct({ id: f.product.id, revision: f.product.revision, goal: 'New scope' });
      return file;
    };
    await assert.rejects(f.mcp(), /제품 범위가 변경/);
    assert.equal(f.room.snapshot().contextUses.length, 0);
  } finally {
    peer.close();
  }
});

test('invalid-source history and hold status roll back together if their audit write fails', async (t) => {
  const f = await fixture(t);
  const record = f.add();
  await unlink(path.join(f.folder, 'README.md'));
  f.room.store.log = () => {
    throw new Error('fixture audit failure');
  };
  await assert.rejects(f.mcp(), /fixture audit failure/);
  assert.deepEqual(f.room.store.get('record', record.id), record);
  assert.equal(f.room.snapshot().recordHistory.length, 0);
  assert.equal(f.room.snapshot().contextUses.length, 0);
});
