import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Workroom } from '../src/core/service.mjs';
import { AgentEngine } from '../src/runtime/engine.mjs';
import { BrokerCredentials, CredentialVault } from '../src/runtime/vault.mjs';
import { readProductFile, listProductFiles } from '../src/runtime/files.mjs';
import { publicFailure } from '../src/runtime/errors.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(fn) {
  for (let i = 0; i < 300; i++) {
    if (fn()) return;
    await tick();
  }
  throw new Error('test condition timed out');
}
async function fixture(t, request) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workroom-runtime-'));
  const productDir = path.join(directory, 'product');
  await mkdir(productDir);
  await writeFile(path.join(productDir, 'README.md'), '# Import tool\nImport validates input.');
  const room = new Workroom(path.join(directory, 'test.sqlite'));
  const product = await room.createProduct({
    name: 'Import tool',
    folder: productDir,
    goal: 'Import',
  });
  const broker = { status: { state: 'ready', models: [{ id: 'model' }] }, request };
  const engine = new AgentEngine(room, broker, { agentDirectory: directory });
  engine.configure({ modelId: 'model' });
  t.after(async () => {
    engine.closed = true;
    room.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { engine, room, product, productDir, broker, directory };
}
async function answer(engine, input) {
  if (input.role === 'knowledge')
    return {
      result: {
        records: [
          {
            title: 'Import validation',
            content: 'Import validates input.',
            scope: 'When updating Import input handling',
            evidenceIds: input.handoff.outputs.review.result.evidenceIds,
          },
        ],
      },
    };
  const file = await engine.tool({ runId: input.runId, name: 'read', args: { path: 'README.md' } });
  return {
    result:
      input.role === 'investigate'
        ? {
            summary: 'Import validates input.',
            findings: [
              {
                title: 'Validation',
                detail: 'README describes validation.',
                evidenceIds: [file.evidenceId],
              },
            ],
            limitations: 'No commands executed.',
            nextStep: 'Review implementation.',
          }
        : {
            verdict: 'supported',
            assessment: 'The source supports the documented claim.',
            evidenceIds: [file.evidenceId],
            limitations: 'Runtime behavior untested.',
          },
    turns: 1,
    tokens: 100,
  };
}
test('three isolated roles persist handoffs, source versions and reusable records without claiming code execution', async (t) => {
  let f;
  f = await fixture(t, async (method, input) => {
    assert.equal(method, 'run');
    return answer(f.engine, input);
  });
  const task = f.engine.start({ productId: f.product.id, goal: 'Import' });
  const duplicate = f.engine.start({ productId: f.product.id, goal: 'Import' });
  assert.equal(duplicate.id, task.id);
  await until(
    () => f.room.store.get('task', task.id).status === 'accepted' && f.engine.active.size === 0,
  );
  const done = f.room.store.get('task', task.id);
  assert.deepEqual(Object.keys(done.outputs), ['investigate', 'review', 'knowledge']);
  assert.equal(f.room.store.list('agent-run').length, 3);
  assert.equal(f.room.store.list('agent-evidence').length, 2);
  assert.equal(f.room.store.get('task', done.resultTaskId).verification, 'reported');
  const record = f.room.store.list('record').find((r) => r.sourceRunId);
  assert.equal(record.active, true);
  assert.equal(
    (await f.engine.prepareContext(done)).records.some((r) => r.id === record.id),
    true,
  );
  await writeFile(path.join(f.productDir, 'README.md'), 'changed');
  assert.equal(
    (await f.engine.prepareContext(done)).records.some((r) => r.id === record.id),
    false,
  );
  assert.equal(f.room.store.get('record', record.id).validity, 'needs_review');
  const count = f.room.store.list('task').length;
  f.engine.materialize(task.id);
  assert.equal(f.room.store.list('task').length, count);
});
test('stop retains ownership until settled; a late response never starts the next role', async (t) => {
  let release;
  const f = await fixture(t, (method) =>
    method === 'abort'
      ? Promise.resolve({ requested: true })
      : new Promise((resolve) => {
          release = resolve;
        }),
  );
  const task = f.engine.start({ productId: f.product.id, goal: 'Import' });
  await until(() => !!release);
  await f.engine.stop({ id: task.id });
  assert.equal(f.room.store.get('task', task.id).status, 'stopping');
  assert.equal(f.engine.active.size, 1);
  assert.throws(() =>
    f.engine.resume({ id: task.id, revision: f.room.store.get('task', task.id).revision }),
  );
  release({ result: { summary: 'late' } });
  await until(() => f.engine.active.size === 0);
  assert.equal(f.room.store.get('task', task.id).status, 'stopped');
  assert.equal(f.room.store.list('agent-run').length, 1);
});

test('a follow-up carries its reviewed investigation and rejects unrelated or unreviewed origins', async (t) => {
  let f, handoff;
  f = await fixture(t, async (_method, input) => {
    if (input.mode === 'change') {
      handoff = input.handoff;
      return { failure: { code: 'cancelled', message: 'fixture stop' } };
    }
    return answer(f.engine, input);
  });
  const source = f.engine.start({ productId: f.product.id, goal: 'Import' });
  await until(
    () => f.room.store.get('task', source.id).status === 'accepted' && f.engine.active.size === 0,
  );
  f.engine.configure({ paused: true });
  const follow = f.engine.start({
    productId: f.product.id,
    goal: 'Improve import',
    mode: 'change',
    sourceTaskId: source.id,
  });
  assert.equal(follow.sourceTaskId, source.id);
  assert.equal(f.room.store.get('task', source.id).status, 'accepted');
  assert.throws(
    () =>
      f.engine.start({ productId: f.product.id, goal: 'Invalid origin', sourceTaskId: follow.id }),
    /조사만/,
  );
  const otherFolder = path.join(f.directory, 'other');
  await mkdir(otherFolder);
  const other = await f.room.createProduct({ name: 'Other', folder: otherFolder, goal: 'Other' });
  assert.throws(
    () =>
      f.engine.start({
        productId: other.id,
        goal: 'Unrelated',
        mode: 'change',
        sourceTaskId: source.id,
      }),
    /같은 제품/,
  );
  f.engine.configure({ paused: false });
  await until(
    () => f.room.store.get('task', follow.id).status === 'stopped' && f.engine.active.size === 0,
  );
  assert.equal(handoff.origin.taskId, source.id);
  assert.equal(handoff.origin.nextStep, 'Review implementation.');
});
test('a file changed between investigation and independent review blocks acceptance and knowledge', async (t) => {
  let f;
  f = await fixture(t, async (_method, input) => {
    if (input.role === 'review')
      await writeFile(path.join(f.productDir, 'README.md'), 'new version');
    return answer(f.engine, input);
  });
  const task = f.engine.start({ productId: f.product.id, goal: 'Import' });
  await until(
    () => f.room.store.get('task', task.id).status === 'needs_review' && f.engine.active.size === 0,
  );
  assert.equal(f.room.store.list('task').filter((t) => t.kind === 'work').length, 0);
  assert.equal(f.room.store.list('agent-run').length, 2);
});
test('global concurrency is bounded and pause prevents additional starts', async (t) => {
  const pending = [];
  const f = await fixture(
    t,
    (_method, input) => new Promise((resolve) => pending.push({ input, resolve })),
  );
  for (let i = 0; i < 3; i++) f.engine.start({ productId: f.product.id, goal: `Import ${i}` });
  await until(() => pending.length === 2);
  assert.equal(f.engine.active.size, 2);
  f.engine.configure({ paused: true });
  for (const item of pending)
    item.resolve({ failure: { code: 'cancelled', message: 'cancelled' } });
  await until(() => f.engine.active.size === 0);
  assert.equal(f.room.store.list('task').filter((t) => t.status === 'queued').length, 1);
});
test('restart marks former owners interrupted and completed stages remain durable', async (t) => {
  const f = await fixture(t, async () => ({ failure: { code: 'runtime', message: 'failure' } }));
  f.engine.configure({ paused: true });
  const task = f.engine.start({ productId: f.product.id, goal: 'Import' });
  const run = f.room.store.create('agent-run', {
    taskId: task.id,
    status: 'running',
    owner: 'previous-process',
  });
  f.room.store.update('task', task.id, task.revision, {
    ...task,
    status: 'running',
    activeRunId: run.id,
  });
  const restarted = new AgentEngine(f.room, f.broker, { agentDirectory: f.directory });
  restarted.closed = true;
  assert.equal(f.room.store.get('task', task.id).status, 'interrupted');
  assert.equal(f.room.store.get('agent-run', run.id).status, 'interrupted');
});
test('knowledge failure preserves the reviewed result and resumes only the derived stage', async (t) => {
  let f,
    failKnowledge = true;
  f = await fixture(t, async (_method, input) =>
    input.role === 'knowledge' && failKnowledge
      ? { failure: { code: 'runtime', message: 'fixture failure' } }
      : answer(f.engine, input),
  );
  const task = f.engine.start({ productId: f.product.id, goal: 'Import' });
  await until(
    () => f.room.store.get('task', task.id).status === 'failed' && f.engine.active.size === 0,
  );
  const failed = f.room.store.get('task', task.id);
  assert(failed.resultTaskId);
  assert.equal(failed.stage, 'knowledge');
  failKnowledge = false;
  f.engine.resume({ id: task.id, revision: failed.revision });
  await until(
    () => f.room.store.get('task', task.id).status === 'accepted' && f.engine.active.size === 0,
  );
  assert.equal(f.room.store.list('agent-run').filter((r) => r.role === 'investigate').length, 1);
  assert.equal(f.room.store.get('task', task.id).resultTaskId, failed.resultTaskId);
});
test('an authentication failure waits for a deliberate reconnect and never loops automatically', async (t) => {
  let attempts = 0;
  const f = await fixture(t, async () => {
    attempts++;
    return { failure: { code: 'auth', message: 'fixture expired' } };
  });
  const task = f.engine.start({ productId: f.product.id, goal: 'Import' });
  await until(
    () => f.room.store.get('task', task.id).status === 'waiting_auth' && f.engine.active.size === 0,
  );
  f.engine.pump();
  await tick();
  assert.equal(attempts, 1);
  f.broker.status.authenticatedAt = Date.now() + 1;
  f.engine.pump();
  await until(() => attempts === 2 && f.engine.active.size === 0);
  assert.equal(attempts, 2);
});
test('changing product scope fences the old owner before its next tool call', async (t) => {
  let input, release;
  const f = await fixture(
    t,
    (_method, payload) =>
      new Promise((resolve) => {
        input = payload;
        release = resolve;
      }),
  );
  const task = f.engine.start({ productId: f.product.id, goal: 'Import' });
  await until(() => !!input);
  f.room.updateProduct({ id: f.product.id, revision: f.product.revision, goal: 'Different goal' });
  await assert.rejects(() =>
    f.engine.tool({ runId: input.runId, name: 'read', args: { path: 'README.md' } }),
  );
  release({
    result: { summary: 'Old scope', findings: [], limitations: 'none', nextStep: 'none' },
  });
  await until(() => f.engine.active.size === 0);
  assert.equal(f.room.store.get('task', task.id).status, 'needs_review');
});
test('scoped file tools reject escapes and credentials and redact common inline secrets', async (t) => {
  const f = await fixture(t, () => {});
  await writeFile(path.join(f.directory, 'outside.md'), 'outside');
  await writeFile(path.join(f.productDir, '.env'), 'secret');
  await writeFile(path.join(f.productDir, 'auth.json'), 'secret');
  await writeFile(path.join(f.productDir, 'config.json'), 'API_KEY="sk-12345678901234567890"');
  for (const file of ['../outside.md', '.env', 'auth.json', 'C:/outside.md', 'README.md:stream'])
    await assert.rejects(() => readProductFile(f.productDir, file));
  const files = await listProductFiles(f.productDir);
  assert.equal(
    files.entries.some((x) => ['.env', 'auth.json'].includes(x.name)),
    false,
  );
  const content = await readProductFile(f.productDir, 'config.json');
  assert.equal(content.content.includes('sk-123'), false);
});
test('credential refreshes serialize and failed persistence never commits a rotated token', async () => {
  const initial = { type: 'oauth', access: 'old', refresh: 'old-refresh', expires: 0 };
  const writes = [];
  const credentials = new BrokerCredentials(initial, async (value) => {
    writes.push(value.access);
  });
  await Promise.all([
    credentials.modify('openai-codex', async (current) => {
      await tick();
      return { ...current, access: current.access + '1' };
    }),
    credentials.modify('openai-codex', async (current) => ({
      ...current,
      access: current.access + '2',
    })),
  ]);
  assert.deepEqual(writes, ['old1', 'old12']);
  credentials.persist = async () => {
    throw new Error('disk failed');
  };
  await assert.rejects(() =>
    credentials.modify('openai-codex', async (current) => ({ ...current, access: 'lost' })),
  );
  assert.equal((await credentials.read('openai-codex')).access, 'old12');
  assert.equal(JSON.stringify(await credentials.list()).includes('old'), false);
});
test('vault requires OS encryption and public failures never expose upstream response contents', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workroom-vault-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vault = new CredentialVault(directory, { isEncryptionAvailable: () => false });
  assert.throws(() => vault.write({ type: 'oauth', access: 'secret', refresh: 'secret' }));
  const failure = publicFailure(new Error('401 refresh failed: {access_token: "sensitive"}'));
  assert.equal(failure.code, 'auth');
  assert.equal(JSON.stringify(failure).includes('sensitive'), false);
});
