// Opt-in real-model check. Only synthetic records are used; the model is cached in work/.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Workroom } from '../src/core/service.mjs';
import { LocalEmbeddings } from '../src/runtime/local-embeddings.mjs';
import { projectRoot } from '../src/core/paths.mjs';

const parent = path.join(projectRoot, 'work');
await mkdir(parent, { recursive: true });
const directory = await mkdtemp(path.join(parent, 'semantic-check-'));
const filename = path.join(directory, 'test.sqlite');
const cache = path.join(parent, 'semantic-models');
const embedding = new LocalEmbeddings(cache);
let room = new Workroom(filename, { embedding });
const started = Date.now();
try {
  const product = await room.createProduct({ name: '검색 검증 예제', folder: directory });
  const texts = [
    [
      '배포 실패 복구',
      '배포에 문제가 생기면 직전 정상 버전으로 되돌린다. 복원 후 서비스 상태를 확인한다.',
    ],
    ['입력 초안 보존', '화면을 떠나기 전에 작성 중인 내용을 저장하고 돌아왔을 때 복원한다.'],
    ['중복 결제 방지', '같은 요청 식별자로 재전송된 결제는 한 번만 처리한다.'],
    ['화면 색상', '버튼과 현재 선택은 주황색으로 표시한다.'],
  ];
  const records = texts.map(([title, content]) =>
    room.addRecord({
      productId: product.id,
      title,
      content,
      scope: title,
      source: '합성 검증 자료',
    }),
  );
  console.log('Preparing the local model and indexing four synthetic records...');
  await room.knowledge.index.drain(20);
  const status = room.knowledge.index.status();
  assert.equal(status.retrying, 0, JSON.stringify(status));
  const probe = '앱 종료 후에는 이미 반영한 파일을 다시 바꾸지 않고 남은 파일을 확인한다.';
  const single = (await embedding.embed([probe]))[0];
  const grouped = (await embedding.embed(['짧은 제목', probe, '다른 긴 내용 '.repeat(40)]))[1];
  const batchDifference = Math.max(...single.map((value, i) => Math.abs(value - grouped[i])));
  assert.ok(batchDifference < 1e-6, `batch-dependent vectors: ${batchDifference}`);
  const results = [];
  const questions = [
    'How do we restore the previous release?',
    'Keep my unfinished text when navigating away',
    'How to avoid charging twice when a request is retried?',
  ];
  const rerankScores = await embedding.rerank(
    questions[0],
    texts.slice(0, 2).map((t) => t.join('\n')),
  );
  assert.equal(rerankScores.length, 2);
  assert.ok(rerankScores.every(Number.isFinite));
  assert.ok(rerankScores[0] > rerankScores[1], JSON.stringify(rerankScores));
  for (let i = 0; i < questions.length; i++) {
    const found = await room.context({ productId: product.id, query: questions[i] });
    results.push({
      query: questions[i],
      mode: found.retrieval.mode,
      reranked: found.retrieval.reranked,
      topId: found.records[0]?.id,
      expectedId: records[i].id,
    });
    assert.equal(found.records[0]?.id, records[i].id, JSON.stringify(results));
  }
  room.close();
  const offline = new LocalEmbeddings(cache, { offline: true });
  room = new Workroom(filename, { embedding: offline });
  await offline.embed(['Warm the cached model']);
  const offlineScores = await offline.rerank(
    questions[0],
    texts.slice(0, 2).map((t) => t.join('\n')),
  );
  assert.deepEqual(offlineScores, rerankScores);
  const reopened = await room.context({ productId: product.id, query: questions[0] });
  assert.equal(reopened.records[0]?.id, records[0].id);
  const result = {
    directory,
    model: embedding.id,
    elapsedMs: Date.now() - started,
    results,
    offlineReopen: true,
    batchDifference,
  };
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  room.close();
}
