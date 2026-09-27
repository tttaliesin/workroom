// Opt-in derived passage retrieval on a deterministic KorQuAD dev subset.
// Not the official QA EM/F1 benchmark; no assertion about training-data overlap.
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Workroom } from '../src/core/service.mjs';
import { LocalEmbeddings } from '../src/runtime/local-embeddings.mjs';
import { projectRoot } from '../src/core/paths.mjs';

const source =
  'https://raw.githubusercontent.com/korquad/korquad.github.io/master/dataset/KorQuAD_v1.0_dev.json';
const sha256 = '25ffeb51e6c51ec02c071b60a10188e10005c144110f0d876b26079d80a35bdf';
const parent = path.join(projectRoot, 'work');
const cache = path.join(parent, 'retrieval-research');
await mkdir(cache, { recursive: true });
const datasetPath = path.join(cache, 'KorQuAD_v1.0_dev.json');
if (process.argv.includes('--download')) {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Dataset download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== sha256)
    throw new Error('Dataset version changed');
  await writeFile(datasetPath, bytes);
}
const raw = await readFile(datasetPath);
if (createHash('sha256').update(raw).digest('hex') !== sha256)
  throw new Error('Dataset checksum mismatch');
const records = [],
  queries = [];
JSON.parse(raw).data.forEach((article, i) => {
  if (i % 5) return;
  article.paragraphs.slice(0, 5).forEach((paragraph, j) => {
    const key = `${i}:${j}`;
    records.push({ key, title: article.title, content: paragraph.context, scope: '위키백과 문단' });
    if (j === 1 && paragraph.qas.length)
      queries.push({
        query: paragraph.qas[0].question,
        expected: key,
        sourceId: paragraph.qas[0].id,
      });
  });
});
const directory = await mkdtemp(path.join(parent, 'retrieval-external-'));
const embedding = new LocalEmbeddings(path.join(parent, 'semantic-models'), { offline: true });
const room = new Workroom(path.join(directory, 'eval.sqlite'), { embedding });
try {
  const product = await room.createProduct({ name: 'KorQuAD 문단 검색 표본', folder: directory });
  const keys = new Map();
  for (const { key, ...record } of records) {
    const saved = room.addRecord({ ...record, productId: product.id, source });
    keys.set(saved.id, key);
  }
  const started = performance.now();
  await room.knowledge.index.drain(1000);
  const indexMs = performance.now() - started;
  const status = room.knowledge.index.status();
  if (status.pending || status.retrying) throw new Error(JSON.stringify(status));
  await embedding.rerank('모델 준비', ['준비용 문장']);
  const results = [];
  for (const q of queries) {
    const row = { ...q };
    for (const [name, enabled] of [
      ['baseline', false],
      ['reranked', true],
    ]) {
      embedding.rerankEnabled = enabled;
      const start = performance.now();
      const result = await room.knowledge.query({ productId: product.id, query: q.query });
      const returned = result.records.map((r) => keys.get(r.id));
      row[name] = {
        ms: performance.now() - start,
        ...result.retrieval,
        rank: returned.indexOf(q.expected) + 1,
        returned,
      };
    }
    results.push(row);
  }
  const summaries = {};
  for (const name of ['baseline', 'reranked']) {
    const times = results.map((r) => r[name].ms).sort((a, b) => a - b);
    summaries[name] = {
      count: results.length,
      top1: results.filter((r) => r[name].rank === 1).length,
      top3: results.filter((r) => r[name].rank > 0 && r[name].rank <= 3).length,
      top8: results.filter((r) => r[name].rank > 0).length,
      medianMs: times[Math.floor(times.length / 2)],
      p95Ms: times[Math.ceil(times.length * 0.95) - 1],
      rerankedQueries: results.filter((r) => r[name].reranked).length,
    };
  }
  await writeFile(
    path.join(directory, 'result.json'),
    JSON.stringify(
      {
        source,
        sha256,
        selection:
          'Every fifth article; first five paragraphs in one shared corpus; first question of second paragraph. Fixed before model comparison. Derived passage retrieval, not official QA EM/F1.',
        records: records.length,
        model: embedding.id,
        indexMs,
        summaries,
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ directory, records: records.length, indexMs, summaries }, null, 2));
} finally {
  room.close();
}
