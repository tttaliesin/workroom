import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Workroom } from '../src/core/service.mjs';
import { LocalEmbeddings } from '../src/runtime/local-embeddings.mjs';
import { projectRoot } from '../src/core/paths.mjs';
const dataset = JSON.parse(
  await readFile(new URL('../tests/fixtures/knowledge-retrieval.json', import.meta.url), 'utf8'),
);
const directory = await mkdtemp(path.join(projectRoot, 'work/retrieval-holdout-'));
const room = new Workroom(path.join(directory, 'eval.sqlite'), {
  embedding: new LocalEmbeddings(path.join(projectRoot, 'work/semantic-models'), { offline: true }),
});
try {
  const product = await room.createProduct({ name: '독립 검색 평가', folder: directory });
  const keys = new Map();
  for (const { key, ...record } of dataset.records) {
    const saved = room.addRecord({ ...record, productId: product.id, source: '별도 평가 자료' });
    keys.set(saved.id, key);
  }
  await room.knowledge.index.drain(100);
  const status = room.knowledge.index.status();
  if (status.pending || status.retrying) throw new Error(JSON.stringify(status));
  const results = [];
  for (const q of dataset.queries) {
    const result = await room.knowledge.query({ productId: product.id, query: q.query });
    const returned = result.records.map((r) => keys.get(r.id));
    results.push({
      ...q,
      mode: result.retrieval.mode,
      reranked: result.retrieval.reranked,
      returned,
      rank: q.expected ? returned.indexOf(q.expected) + 1 : null,
    });
  }
  const positive = results.filter((r) => r.expected),
    negative = results.filter((r) => !r.expected);
  const summary = {
    positive: positive.length,
    top1: positive.filter((r) => r.rank === 1).length,
    top3: positive.filter((r) => r.rank > 0 && r.rank <= 3).length,
    top8: positive.filter((r) => r.rank > 0).length,
    negative: negative.length,
    falseReturns: negative.filter((r) => r.returned.length).length,
  };
  await writeFile(
    path.join(directory, 'result.json'),
    JSON.stringify({ dataset, summary, results }, null, 2),
  );
  console.log(JSON.stringify({ directory, summary }, null, 2));
} finally {
  room.close();
}
