import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Workroom } from '../src/core/service.mjs';
import { JevBridge, JEV_CONTRACT, jevSession } from '../src/integrations/jev-bridge.mjs';

async function fixture(t) {
  mkdirSync('work/tests', { recursive: true });
  const directory = mkdtempSync(path.resolve('work/tests/jev-'));
  const filename = path.join(directory, 'workroom.sqlite');
  const room = new Workroom(filename);
  t.after(() => room.close());
  const product = await room.createProduct({ name: 'Bridge example', folder: directory });
  const task = room.reportWork({
    productId: product.id,
    title: '복원 기능',
    summary: '입력 복원을 구현했습니다.',
    contribution: 'Agent proposal',
    limitations: 'Not independently verified',
    evidence: 'PRIVATE_EVIDENCE',
    changedFiles: [{ path: 'PRIVATE_PATH', summary: 'internal file' }],
  });
  const descriptor = {
    contract: JEV_CONTRACT,
    command: process.execPath,
    args: [path.resolve('tests/fixtures/jev-server.mjs'), path.join(directory, 'memories.json')],
    cwd: directory,
  };
  const bridge = new JevBridge(room);
  return { room, product, task, descriptor, bridge, directory, filename };
}

test('real stdio contract: opt-in, reviewed transfer, replay, update, search and restart without Jev repository', async (t) => {
  const f = await fixture(t);
  const input = { productId: f.product.id, reportId: f.task.id };
  const original = f.room.snapshot();
  const native = await f.room.context({ productId: f.product.id, query: '복원' });
  assert.throws(() => f.bridge.prepare(input), /먼저 설정/);
  await f.bridge.configure({ productId: f.product.id, descriptor: f.descriptor });
  const preview = f.bridge.prepare(input);
  assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_|evidence|changedFiles/);
  assert.equal((await f.bridge.publish({ previewId: preview.id })).status, 'created');
  const retry = f.bridge.prepare(input);
  assert.equal((await f.bridge.publish({ previewId: retry.id })).status, 'unchanged');
  assert.equal(JSON.parse(readFileSync(f.descriptor.args[1], 'utf8')).length, 1);
  const updated = f.room.store.update('task', f.task.id, f.task.revision, {
    ...f.task,
    summary: '복원 수정 후 결과',
  });
  const next = f.bridge.prepare(input);
  assert.equal((await f.bridge.publish({ previewId: next.id })).status, 'updated');
  const found = await f.bridge.search({ productId: f.product.id, query: '복원' });
  assert.equal(found.items[0].revision, updated.revision);
  assert.equal(found.items[0].summary, '복원 수정 후 결과');
  assert.equal(f.room.snapshot().records.length, original.records.length);
  assert.deepEqual(
    (await f.room.context({ productId: f.product.id, query: '복원' })).records,
    native.records,
  );
  const reopened = new Workroom(f.filename);
  try {
    const bridge = new JevBridge(reopened);
    assert.equal(bridge.origin(), preview.payload.originId);
    assert.equal((await bridge.search({ productId: f.product.id, query: '복원' })).items.length, 1);
    const connection = bridge.connection(f.product.id);
    bridge.disable({ productId: f.product.id, expectedRevision: connection.revision });
    await assert.rejects(bridge.search({ productId: f.product.id, query: '복원' }), /먼저 설정/);
    assert.equal(reopened.snapshot().tasks.length, original.tasks.length);
  } finally {
    reopened.close();
  }
});

test('changed reports and disconnected/reconfigured destinations invalidate reviewed transfers', async (t) => {
  const f = await fixture(t);
  await f.bridge.configure({ productId: f.product.id, descriptor: f.descriptor });
  const input = { productId: f.product.id, reportId: f.task.id };
  const preview = f.bridge.prepare(input);
  f.room.store.update('task', f.task.id, f.task.revision, { ...f.task, title: 'Changed' });
  await assert.rejects(f.bridge.publish({ previewId: preview.id }), /다시 검토/);
  const next = f.bridge.prepare(input);
  const connection = f.bridge.connection(f.product.id);
  await f.bridge.configure({
    productId: f.product.id,
    descriptor: f.descriptor,
    expectedRevision: connection.revision,
  });
  await assert.rejects(f.bridge.publish({ previewId: next.id }), /다시 검토/);
  assert.equal(f.bridge.summary().receipts.length, 0);
});

test('wrong workspace, unsupported descriptor/version and failed connection cannot enable or publish', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.bridge.configure({
      productId: f.product.id,
      descriptor: { ...f.descriptor, contract: 'workroom-jev/2' },
    }),
  );
  await assert.rejects(
    f.bridge.configure({
      productId: f.product.id,
      descriptor: { ...f.descriptor, cwd: path.resolve('.') },
    }),
    /제품과 다릅니다/,
  );
  await assert.rejects(
    f.bridge.configure({
      productId: f.product.id,
      descriptor: { ...f.descriptor, args: [...f.descriptor.args, 'version'] },
    }),
  );
  assert.equal(f.bridge.connection(f.product.id), undefined);
  await assert.rejects(
    jevSession(
      { ...f.descriptor, args: [...f.descriptor.args, 'timeout'] },
      (call) => call('bridge_status', { contract: JEV_CONTRACT }),
      { timeout: 500 },
    ),
    /초과|timed out/i,
  );
  assert.equal(f.room.snapshot().tasks.length, 1);
});

test('consumer rejects an unexpected server workspace before publishing', async (t) => {
  const f = await fixture(t);
  await f.bridge.configure({ productId: f.product.id, descriptor: f.descriptor });
  const preview = f.bridge.prepare({ productId: f.product.id, reportId: f.task.id });
  const calls = [];
  f.bridge.session = async (_descriptor, action) =>
    action(async (name) => {
      calls.push(name);
      return {
        contract: JEV_CONTRACT,
        workspaceId: 'changed-workspace',
        workspaceRoot: f.directory,
        capabilities: ['publish', 'search'],
      };
    });
  await assert.rejects(f.bridge.publish({ previewId: preview.id }), /다시 연결/);
  assert.deepEqual(calls, ['bridge_status']);
  assert.equal(f.bridge.summary().receipts.length, 0);
});
