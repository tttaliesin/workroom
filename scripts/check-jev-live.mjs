// Opt-in interoperability check. Ordinary tests never require a Jev installation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Workroom } from '../src/core/service.mjs';
import { JevBridge, JEV_CONTRACT, jevSession } from '../src/integrations/jev-bridge.mjs';
const [python, jevRoot] = process.argv.slice(2);
if (!python || !jevRoot || !path.isAbsolute(python) || !path.isAbsolute(jevRoot))
  throw new Error('Usage: node scripts/check-jev-live.mjs ABSOLUTE_PYTHON ABSOLUTE_JEV_DIRECTORY');
mkdirSync('work', { recursive: true });
const directory = mkdtempSync(path.resolve('work/jev-live-'));
const root = path.join(directory, 'example-product');
mkdirSync(root);
const config = path.join(directory, 'jev-project.toml');
const descriptorFile = path.join(directory, 'launch.json');
function cli(args) {
  const result = spawnSync(python, ['-X', 'utf8', '-m', 'jev_context', ...args], {
    cwd: jevRoot,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || result.error?.message || 'Jev CLI failed');
}
cli([
  'init',
  '--config',
  config,
  '--project-root',
  root,
  '--data-root',
  path.join(directory, 'jev-state'),
]);
cli(['bridge-config', '--config', config, '--output', descriptorFile]);
const descriptor = JSON.parse(readFileSync(descriptorFile, 'utf8'));
const room = new Workroom(path.join(directory, 'workroom.sqlite'));
const results = [];
try {
  const product = await room.createProduct({
    name: 'Isolated interoperability example',
    folder: root,
  });
  const report = {
    productId: product.id,
    externalId: 'example-report',
    title: '입력 복원',
    summary: '작성 중인 문장을 복원했습니다.',
    contribution: 'Illustrative agent contribution',
    limitations: 'Example only, not actual project results',
    evidence: 'PRIVATE_INTERNAL_EVIDENCE',
  };
  let task = room.reportWork(report);
  const bridge = new JevBridge(room);
  await bridge.configure({ productId: product.id, descriptor });
  results.push('descriptor + contract + workspace verification');
  const send = async () => {
    const preview = bridge.prepare({ productId: product.id, reportId: task.id });
    return bridge.publish({ previewId: preview.id });
  };
  const created = await send();
  assert.equal(created.status, 'created');
  const unchanged = await send();
  assert.equal(unchanged.status, 'unchanged');
  assert.equal(unchanged.memoryId, created.memoryId);
  task = room.reportWork({
    ...report,
    sourceVersion: 2,
    summary: '복원과 수정 보고를 확인했습니다.',
  });
  const updated = await send();
  assert.equal(updated.status, 'updated');
  assert.equal(updated.memoryId, created.memoryId);
  results.push('created → unchanged → updated, stable memory ID');
  const found = await bridge.search({ productId: product.id, query: '복원' });
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].revision, task.revision);
  assert.equal(found.items[0].summary, task.summary);
  assert.ok(!JSON.stringify(found).includes('PRIVATE_INTERNAL_EVIDENCE'));
  results.push('current revision search without private evidence');
  await jevSession(descriptor, async (call) => {
    const different = await call('bridge_search', {
      contract: JEV_CONTRACT,
      originId: bridge.origin(),
      productId: '00000000-0000-4000-8000-000000000001',
      query: '복원',
      limit: 8,
    });
    assert.deepEqual(different.items, []);
  });
  results.push('other product cannot retrieve this memory');
  const connection = bridge.connection(product.id);
  bridge.disable({ productId: product.id, expectedRevision: connection.revision });
  assert.ok((await room.context({ productId: product.id, query: '복원' })).records.length > 0);
  assert.equal(room.snapshot().tasks.length, 1);
  results.push('disconnect preserves native records and search');
  writeFileSync(
    path.join(directory, 'result.json'),
    JSON.stringify(
      { contract: JEV_CONTRACT, results, modelsStarted: false, scope: 'isolated example only' },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ directory, results }, null, 2));
} finally {
  room.close();
}
