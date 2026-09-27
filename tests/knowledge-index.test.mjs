import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Workroom } from '../src/core/service.mjs';
import { KnowledgeIndex } from '../src/core/knowledge-index.mjs';
import { projectRoot } from '../src/core/paths.mjs';
import { readProductFile } from '../src/runtime/files.mjs';
import { DatabaseSync } from 'node:sqlite';
import { LocalEmbeddings } from '../src/runtime/local-embeddings.mjs';

const fakeEmbedding = () => ({
  id: 'fixture-v1',
  dimensions: 2,
  embed: async (texts) => texts.map((text) => (/복구|restore/.test(text) ? [1, 0] : [0, 1])),
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function fixture(t) {
  const parent = path.join(projectRoot, 'work/tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'index-'));
  const filename = path.join(directory, 'test.sqlite');
  const embedding = fakeEmbedding();
  const room = new Workroom(filename, { embedding });
  const product = await room.createProduct({ name: 'Index fixture', folder: directory });
  const add = (fields = {}) =>
    room.addRecord({
      productId: product.id,
      title: '복구',
      content: '이전 정상 버전으로 복구한다.',
      scope: '배포',
      source: '합성 자료',
      ...fields,
    });
  t.after(async () => {
    room.close();
    assert.equal(path.dirname(directory), parent);
    await rm(directory, { recursive: true, force: true });
  });
  const jobs = () => room.store.db.prepare('SELECT * FROM knowledge_jobs').all();
  const vectors = () => room.store.db.prepare('SELECT * FROM knowledge_vectors').all();
  return {
    room,
    index: room.knowledge.index,
    embedding,
    product,
    add,
    jobs,
    vectors,
    filename,
    directory,
  };
}

test('record writes and index jobs commit or roll back together across SQLite connections', async (t) => {
  const f = await fixture(t);
  assert.throws(() =>
    f.room.store.transaction(() => {
      f.room.store.create('record', { productId: f.product.id, active: true });
      throw new Error('rollback');
    }),
  );
  assert.equal(f.jobs().length, 0);
  const r = f.add();
  const peer = new Workroom(f.filename);
  try {
    assert.equal(
      peer.store.db.prepare('SELECT source_revision FROM knowledge_jobs').get().source_revision,
      r.revision,
    );
    assert.throws(() =>
      peer.store.transaction(() => {
        peer.store.update('record', r.id, r.revision, { ...r, active: false });
        throw new Error('rollback');
      }),
    );
    assert.equal(f.jobs()[0].source_revision, r.revision);
    assert.equal(f.room.store.get('record', r.id).active, true);
    peer.toggleRecord({ id: r.id, revision: r.revision, active: false });
    assert.equal(f.jobs()[0].operation, 'delete');
    assert.equal(f.jobs()[0].source_revision, r.revision + 1);
  } finally {
    peer.close();
  }
});

test('existing records are backfilled without changing IDs, revisions or content', async (t) => {
  const f = await fixture(t);
  const filename = path.join(f.directory, 'legacy.sqlite');
  const db = new DatabaseSync(filename);
  db.exec(
    'CREATE TABLE entities(id TEXT PRIMARY KEY,kind TEXT,revision INTEGER,body TEXT,created TEXT,updated TEXT)',
  );
  db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?)').run(
    'legacy',
    'record',
    7,
    JSON.stringify({ productId: f.product.id, active: true, content: 'original' }),
    'old',
    'old',
  );
  db.close();
  const migrated = new Workroom(filename);
  try {
    assert.equal(migrated.store.get('record', 'legacy').revision, 7);
    assert.equal(migrated.store.get('record', 'legacy').content, 'original');
    assert.equal(
      migrated.store.db.prepare('SELECT source_revision FROM knowledge_jobs').get().source_revision,
      7,
    );
  } finally {
    migrated.close();
  }
});

test('semantic lookup finds non-overlapping text and never crosses products or source revisions', async (t) => {
  const f = await fixture(t);
  const r = f.add();
  assert.deepEqual(
    (await f.room.context({ productId: f.product.id, query: 'restore' })).records,
    [],
  );
  const otherFolder = path.join(f.directory, 'other');
  await mkdir(otherFolder);
  const other = await f.room.createProduct({ name: 'Other', folder: otherFolder });
  f.add({ productId: other.id });
  await f.index.drain();
  const found = await f.room.context({ productId: f.product.id, query: 'restore' });
  assert.equal(found.retrieval.mode, 'hybrid');
  assert.equal(found.records[0].id, r.id);
  assert.equal(found.records.length, 1);
  assert.equal(f.vectors().find((v) => v.source_id === r.id).source_revision, r.revision);
  f.room.toggleRecord({ id: r.id, revision: r.revision, active: false });
  assert.equal(f.vectors().filter((v) => v.source_id === r.id).length, 0);
  assert.deepEqual(
    (await f.room.context({ productId: f.product.id, query: 'restore' })).records,
    [],
  );
  await f.index.drain();
  assert.equal(f.jobs()[0].state, 'done');
});

test('late embedding cannot restore a revised, excluded or deleted source', async (t) => {
  for (const action of ['revise', 'exclude', 'delete']) {
    const f = await fixture(t);
    const r = f.add();
    const started = deferred(),
      finish = deferred();
    f.embedding.embed = async (texts) => {
      started.resolve();
      await finish.promise;
      return texts.map(() => [1, 0]);
    };
    const run = f.index.drain(1);
    await started.promise;
    if (action === 'delete')
      f.room.store.db.prepare("DELETE FROM entities WHERE id=? AND kind='record'").run(r.id);
    else
      f.room.store.update('record', r.id, r.revision, {
        ...r,
        content: 'new content',
        active: action !== 'exclude',
      });
    finish.resolve();
    await run;
    assert.equal(f.vectors().length, 0, action);
    assert.equal(f.jobs()[0].state, 'pending');
    await f.index.drain(1);
    assert.equal(f.vectors().length, action === 'revise' ? 1 : 0);
  }
});

test('only one worker owns a live lease and an expired owner cannot overwrite its successor', async (t) => {
  const f = await fixture(t);
  f.add();
  let now = 1000;
  f.index.now = () => now;
  f.index.leaseMs = 100;
  const started = deferred(),
    finish = deferred();
  f.embedding.embed = async () => {
    started.resolve();
    await finish.promise;
    return [[1, 0]];
  };
  const peer = new Workroom(f.filename);
  const second = new KnowledgeIndex(
    peer.store,
    { ...fakeEmbedding(), embed: async () => [[0, 1]] },
    { now: () => now, leaseMs: 100 },
  );
  try {
    const run = f.index.drain(1);
    await started.promise;
    assert.equal(await second.drain(1), 0);
    now = 1101;
    assert.equal(await second.drain(1), 1);
    finish.resolve();
    await run;
    assert.deepEqual(JSON.parse(f.vectors()[0].vector), [0, 1]);
  } finally {
    second.close();
    peer.close();
  }
});

test('embedding failures persist bounded retries, preserve the source and fall back to lexical search', async (t) => {
  const f = await fixture(t);
  const r = f.add();
  let now = 1000;
  f.index.now = () => now;
  f.embedding.embed = async () => {
    throw new Error('private upstream contents must not be persisted');
  };
  await f.index.drain();
  assert.equal(f.jobs()[0].state, 'retry');
  assert.equal(f.jobs()[0].last_error, 'embedding_unavailable');
  assert.equal(await f.index.drain(), 0);
  assert.equal(
    (await f.room.context({ productId: f.product.id, query: '복구' })).records[0].id,
    r.id,
  );
  const peer = new Workroom(f.filename);
  try {
    assert.equal(peer.store.db.prepare('SELECT state FROM knowledge_jobs').get().state, 'retry');
  } finally {
    peer.close();
  }
  now = f.jobs()[0].next_attempt;
  f.index.close();
  const replacement = fakeEmbedding();
  const restarted = new Workroom(f.filename, { embedding: replacement });
  try {
    restarted.knowledge.index.now = () => now;
    await restarted.knowledge.index.drain();
    assert.equal(f.jobs()[0].state, 'done');
    replacement.embed = async () => {
      throw new Error('query unavailable');
    };
    const fallback = await restarted.context({ productId: f.product.id, query: '복구' });
    assert.equal(fallback.retrieval.mode, 'lexical');
    assert.equal(fallback.records[0].id, r.id);
  } finally {
    restarted.close();
  }
});

test('invalid vectors are rejected and a model change fences in-flight old-model results', async (t) => {
  const f = await fixture(t);
  const r = f.add();
  f.embedding.embed = async () => [[NaN, 1]];
  await f.index.drain();
  assert.equal(f.vectors().length, 0);
  assert.equal(f.jobs()[0].state, 'retry');
  f.room.toggleRecord({ id: r.id, revision: r.revision, active: true });
  const started = deferred(),
    finish = deferred();
  f.embedding.embed = async () => {
    started.resolve();
    await finish.promise;
    return [[0, 1]];
  };
  const oldRun = f.index.drain(1);
  await started.promise;
  const second = new KnowledgeIndex(f.room.store, { ...fakeEmbedding(), id: 'fixture-v2' });
  try {
    await second.drain();
    finish.resolve();
    await oldRun;
    assert.equal(f.vectors()[0].model_id, 'fixture-v2');
    assert.equal(await f.index.drain(), 0);
    assert.equal(
      (await f.index.search(f.product.id, 'restore', f.room.store.list('record'))).mode,
      'lexical',
    );
  } finally {
    finish.resolve();
    second.close();
  }
});

test('semantic matches still pass current file verification and invalidation immediately removes their vectors', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.directory, 'README.md');
  await writeFile(file, 'original');
  const e = f.room.store.create('agent-evidence', {
    productId: f.product.id,
    ...(await readProductFile(f.directory, 'README.md')),
  });
  const r = f.add();
  f.room.store.update('record', r.id, r.revision, { ...r, evidenceIds: [e.id] });
  await f.index.drain();
  await writeFile(file, 'changed');
  assert.deepEqual(
    (await f.room.context({ productId: f.product.id, query: 'restore' })).records,
    [],
  );
  assert.equal(f.room.store.get('record', r.id).validity, 'needs_review');
  assert.equal(f.vectors().length, 0);
  assert.equal(f.jobs()[0].operation, 'delete');
});

test('long records index the tail in separate chunks and shutdown discards unfinished inference', async (t) => {
  const f = await fixture(t);
  f.add({ title: '자료', scope: '자료', content: '무관한 내용 '.repeat(300) + '복구 절차' });
  await f.index.drain();
  assert.ok(f.vectors().length > 1);
  assert.equal(
    (await f.room.context({ productId: f.product.id, query: 'restore' })).records.length,
    1,
  );
  f.add();
  const started = deferred(),
    finish = deferred();
  f.embedding.embed = async () => {
    started.resolve();
    await finish.promise;
    return [[1, 0]];
  };
  const run = f.index.drain(1);
  await started.promise;
  f.index.close();
  finish.resolve();
  await run;
  assert.ok(f.jobs().some((job) => job.state === 'pending'));
});

test('a corroborating passage recovers diluted context without lowering a strong context match', async (t) => {
  const f = await fixture(t);
  const record = f.add({
    title: '운영 방침',
    scope: '서비스',
    content:
      '실행이 중단되면 완료한 파일과 남은 파일을 확인하고 이어서 처리한다.\n```json\n{\n}\n```',
  });
  let contextScore = 0.3,
    passageScore = 0.7;
  const seen = [];
  const vector = (cosine) => [cosine, Math.sqrt(1 - cosine * cosine)];
  f.embedding.embed = async (texts) => {
    seen.push(...texts);
    return texts.map((text) =>
      text === 'restore' ? [1, 0] : vector(text.includes('\n') ? contextScore : passageScore),
    );
  };
  await f.index.drain();
  assert.ok(!seen.some((text) => ['{', '}', '```', '```json'].includes(text)));
  assert.equal(
    (await f.room.context({ productId: f.product.id, query: 'restore' })).records[0]?.id,
    record.id,
  );
  contextScore = 0.8;
  passageScore = 0.1;
  f.room.store.update('record', record.id, record.revision, {
    ...record,
    content: record.content + ' 완료 항목은 보존한다.',
  });
  await f.index.drain();
  const score = (
    await f.index.search(f.product.id, 'restore', f.room.store.list('record'))
  ).scores.get(record.id);
  assert.ok(Math.abs(score - 0.8) < 1e-9);
});

test('reranking improves ordering without admitting unrelated records or changing short identifiers', async (t) => {
  const f = await fixture(t);
  const a = f.add(),
    b = f.add({ title: '복구 확인' });
  f.add({ title: '식당', scope: '요리', content: '메뉴 추천' });
  await f.index.drain(100);
  let calls = 0;
  f.embedding.rerank = async (_query, texts) => {
    calls++;
    assert.equal(texts.length, 2);
    return texts.map((text) => (text.startsWith('복구\n') ? 10 : -10));
  };
  const found = await f.room.context({
    productId: f.product.id,
    query: 'restore interrupted deployment',
  });
  assert.equal(found.retrieval.reranked, true);
  assert.deepEqual(
    found.records.map((r) => r.id),
    [a.id, b.id],
  );
  await f.room.context({ productId: f.product.id, query: 'restore' });
  assert.equal(calls, 1);
  f.embedding.rerankEnabled = false;
  assert.equal(
    (await f.room.context({ productId: f.product.id, query: 'restore interrupted deployment' }))
      .retrieval.reranked,
    false,
  );
  assert.equal(calls, 1);
});

test('reranking failure, malformed output and timeout preserve the original retrieval order', async (t) => {
  const f = await fixture(t);
  f.add();
  f.add();
  await f.index.drain();
  const query = { productId: f.product.id, query: 'restore interrupted deployment' };
  const original = (await f.room.context(query)).records.map((r) => r.id);
  f.index.rerankMs = 10;
  for (const score of [
    async () => {
      throw new Error('unavailable');
    },
    async () => [NaN, 1],
    async () => [1],
    () => new Promise(() => {}),
  ]) {
    f.embedding.rerank = score;
    const found = await f.room.context(query);
    assert.equal(found.retrieval.reranked, false);
    assert.deepEqual(
      found.records.map((r) => r.id),
      original,
    );
  }
});

test('late reranking cannot return records excluded by another connection and preserves unscored candidates', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 26; i++) f.add();
  await f.index.drain(100);
  const started = deferred(),
    finish = deferred();
  f.embedding.rerank = async (_query, texts) => {
    assert.equal(texts.length, 24);
    started.resolve();
    await finish.promise;
    return texts.map((_, i) => i);
  };
  const query = 'restore interrupted deployment';
  const original = await f.index.search(f.product.id, query, f.room.store.list('record'));
  const { rankKnowledge } = await import('../src/core/knowledge-ranking.mjs');
  const ranked = rankKnowledge(f.room.store.list('record'), query, original.scores);
  const pending = f.room.context({ productId: f.product.id, query });
  await started.promise;
  const peer = new Workroom(f.filename);
  try {
    for (const r of ranked.slice(0, 24))
      peer.toggleRecord({ id: r.id, revision: r.revision, active: false });
    finish.resolve();
    assert.deepEqual(
      (await pending).records.map((r) => r.id),
      ranked.slice(24).map((r) => r.id),
    );
  } finally {
    finish.resolve();
    peer.close();
  }
});

test('a model change discards an in-flight rerank', async (t) => {
  const f = await fixture(t);
  const records = [f.add(), f.add()];
  const started = deferred(),
    finish = deferred();
  f.embedding.rerank = async () => {
    started.resolve();
    await finish.promise;
    return [1, 2];
  };
  const pending = f.index.rerank('restore interrupted deployment', records);
  await started.promise;
  const replacement = new KnowledgeIndex(f.room.store, { ...fakeEmbedding(), id: 'replacement' });
  try {
    finish.resolve();
    assert.equal(await pending, null);
  } finally {
    finish.resolve();
    replacement.close();
  }
});

test('cached vectors observe replacement and corruption from another SQLite connection', async (t) => {
  const f = await fixture(t);
  const r = f.add();
  await f.index.drain();
  const search = () => f.index.search(f.product.id, 'restore', [r]);
  assert.equal((await search()).scores.get(r.id), 1);
  const peer = new Workroom(f.filename);
  try {
    peer.store.db
      .prepare('UPDATE knowledge_vectors SET vector=? WHERE source_id=?')
      .run('[0,1]', r.id);
    assert.equal((await search()).scores.has(r.id), false);
    peer.store.db
      .prepare('UPDATE knowledge_vectors SET vector=? WHERE source_id=?')
      .run('corrupt', r.id);
    assert.equal((await search()).mode, 'lexical');
  } finally {
    peer.close();
  }
});

test('a lexical candidate can expose its best passage without bypassing semantic admission', async (t) => {
  const f = await fixture(t);
  const content = '중단된 배포의 이전 버전을 확인하고 남은 절차를 이어서 처리한다.';
  const r = f.add({ content });
  const vector = (score) => [score, Math.sqrt(1 - score * score)];
  f.embedding.embed = async (texts) =>
    texts.map((text) => (text === 'restore' ? [1, 0] : vector(text.includes('\n') ? 0.1 : 0.3)));
  await f.index.drain();
  const result = await f.index.search(f.product.id, 'restore', [r]);
  assert.equal(result.scores.has(r.id), false);
  assert.equal(result.passages.get(r.id), content);
});

test('a busy or failed reranker does not share the embedding queue or retry cooldown', async () => {
  const provider = new LocalEmbeddings('unused', { offline: true });
  try {
    provider.reranking.pending.set(1, {});
    await assert.rejects(provider.rerank('query', ['text']), /busy/);
    provider.reranking.pending.clear();
    provider.reranking.retryAfter = Date.now() + 30000;
    await assert.rejects(provider.rerank('query', ['text']), /temporarily unavailable/);
    assert.equal(provider.embeddings.pending.size, 0);
    assert.equal(provider.embeddings.retryAfter, undefined);
  } finally {
    provider.close();
  }
});
