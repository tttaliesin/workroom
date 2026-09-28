import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Workroom } from '../src/core/service.mjs';
import { AgentEngine } from '../src/runtime/engine.mjs';
import { applyOne, sourceTree } from '../src/runtime/change-files.mjs';
import { runNode } from '../src/runtime/node-process.mjs';
import { createCommands } from '../src/control/commands.mjs';
import { ControlService } from '../src/control/service.mjs';
import { randomUUID } from 'node:crypto';

const pause = () => new Promise((r) => setTimeout(r, 15));
async function until(fn) {
  for (let i = 0; i < 600; i++) {
    if (fn()) return;
    await pause();
  }
  throw new Error('change test timed out');
}
async function fixture(
  t,
  {
    testFiles = ['math.test.mjs'],
    code = 'export const add = (a,b) => a + b;\n',
    hold = false,
    extraFile = false,
  } = {},
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workroom-change-')),
    folder = path.join(directory, 'product');
  await mkdir(folder);
  await writeFile(path.join(folder, 'math.mjs'), 'export const add = (a,b) => a - b;\n');
  await writeFile(
    path.join(folder, 'math.test.mjs'),
    "import test from 'node:test';import assert from 'node:assert/strict';import {add} from './math.mjs';test('adds numbers',()=>assert.equal(add(2,3),5));",
  );
  const room = new Workroom(path.join(directory, 'data.sqlite')),
    product = await room.createProduct({ name: 'math', folder, goal: 'add repair' });
  let engine;
  const calls = [];
  const broker = {
    status: { state: 'ready', models: [{ id: 'fixture' }] },
    request: async (method, input) => {
      if (method === 'abort') return {};
      calls.push(input.role);
      if (input.role === 'develop') {
        if (hold)
          await new Promise((resolve) => {
            broker.release = resolve;
          });
        const originalHash = engine.changes.get(room.store.get('task', task.id)).candidateManifest[
          'math.mjs'
        ];
        await assert.rejects(
          () =>
            engine.tool({
              runId: input.runId,
              name: 'write',
              args: { path: 'math.mjs', expectedHash: originalHash, content: code },
            }),
          /전체를 읽은/,
        );
        const read = await engine.tool({
          runId: input.runId,
          name: 'read',
          args: { path: 'math.mjs' },
        });
        await assert.rejects(() =>
          engine.tool({
            runId: input.runId,
            name: 'write',
            args: { path: '../outside.mjs', expectedHash: null, content: 'outside' },
          }),
        );
        if (testFiles.length)
          await assert.rejects(() =>
            engine.tool({
              runId: input.runId,
              name: 'write',
              args: { path: 'math.test.mjs', expectedHash: null, content: 'weakened' },
            }),
          );
        const written = await engine.tool({
          runId: input.runId,
          name: 'write',
          args: { path: 'math.mjs', expectedHash: read.hash, content: code },
        });
        if (extraFile)
          await engine.tool({
            runId: input.runId,
            name: 'write',
            args: {
              path: 'extra.mjs',
              expectedHash: null,
              content: 'export const extra = true;\n',
            },
          });
        return {
          result: {
            summary: 'Addition now uses the sum.',
            evidenceIds: [written.evidenceId],
            limitations: 'Integer fixture only.',
          },
        };
      }
      if (input.role === 'change_review') {
        const baseline = await engine.tool({
          runId: input.runId,
          name: 'read_base',
          args: { path: 'math.mjs' },
        });
        assert.match(baseline.content, /a - b/);
        assert.equal(baseline.evidenceId, undefined);
        const read = await engine.tool({
          runId: input.runId,
          name: 'read',
          args: { path: 'math.mjs' },
        });
        await assert.rejects(() =>
          engine.tool({
            runId: input.runId,
            name: 'write',
            args: { path: 'math.mjs', expectedHash: read.hash, content: 'bad' },
          }),
        );
        return {
          result: {
            verdict: 'supported',
            assessment: 'The implementation matches the request and the recorded test.',
            evidenceIds: [read.evidenceId],
            limitations: 'Only the selected fixture test.',
          },
        };
      }
      assert.equal(input.role, 'knowledge');
      return { result: { records: [] } };
    },
  };
  engine = new AgentEngine(room, broker, {
    agentDirectory: path.join(directory, 'runtime'),
    nodeExecutable: process.execPath,
  });
  engine.configure({ modelId: 'fixture' });
  const task = engine.start({
    productId: product.id,
    goal: 'repair add',
    mode: 'change',
    testFiles,
    allowTests: true,
  });
  t.after(async () => {
    engine.closed = true;
    room.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, folder, room, product, engine, task, calls, broker };
}
async function ready(f) {
  await until(
    () =>
      ['awaiting_apply', 'check_failed', 'needs_review', 'failed'].includes(
        f.room.store.get('task', f.task.id).status,
      ) && f.engine.active.size === 0,
  );
  return f.room.store.get('task', f.task.id);
}
async function apply(f, extra = {}) {
  const task = f.room.store.get('task', f.task.id),
    change = f.engine.changes.get(task);
  return f.engine.changes.apply({
    id: task.id,
    revision: task.revision,
    artifactHash: change.artifactHash,
    ...extra,
  });
}
test('real Node before/after tests and reviewed control apply the exact isolated change once', async (t) => {
  const f = await fixture(t);
  const task = await ready(f);
  assert.equal(task.status, 'awaiting_apply', JSON.stringify(task.outputs.check));
  assert.match(await readFile(path.join(f.folder, 'math.mjs'), 'utf8'), /a - b/);
  const checks = task.outputs.check.result;
  assert.equal(checks.status, 'passed', JSON.stringify(checks));
  assert.equal(checks.checks.find((c) => c.target === 'baseline').result, 'failed');
  assert.equal(checks.checks.find((c) => c.name === '선택한 테스트 · 수정 후').result, 'passed');
  assert.deepEqual(f.calls, ['develop', 'change_review']);
  const commands = createCommands({
    room: f.room,
    getEngine: () => f.engine,
    getBroker: () => f.broker,
  });
  const control = new ControlService({ room: f.room, commands, getEngine: () => f.engine });
  const request = {
    command: 'runtime.applyChange',
    args: {
      id: task.id,
      revision: task.revision,
      artifactHash: f.engine.changes.get(task).artifactHash,
    },
  };
  const review = control.review(request);
  assert.ok(review.evidence.some((r) => r.kind === 'change-set' && r.changes.length));
  const execute = { ...request, requestId: randomUUID(), reviewHash: review.reviewHash };
  control.execute(execute);
  await control.pending.get(execute.requestId);
  assert.equal(control.operation(execute.requestId).status, 'completed');
  assert.equal(control.execute(execute).status, 'completed');
  await until(
    () => f.room.store.get('task', f.task.id).status === 'accepted' && f.engine.active.size === 0,
  );
  assert.match(await readFile(path.join(f.folder, 'math.mjs'), 'utf8'), /a \+ b/);
  assert.equal(f.room.store.list('apply-journal')[0].state, 'applied');
  const done = f.room.store.get('task', f.task.id);
  assert(done.resultTaskId);
  assert(done.appliedAt);
  const record = f.room.store.list('record').find((r) => r.sourceTaskId === done.resultTaskId);
  assert(record.evidenceIds.length);
  const external = f.room
    .agentWork({ productId: f.product.id })
    .tasks.find((t) => t.id === done.id);
  assert.equal(external.mode, 'change');
  assert.equal(external.appliedAt, done.appliedAt);
  await assert.rejects(() => apply(f));
  assert.equal(f.room.store.list('task').filter((t) => t.kind === 'work').length, 1);
  await writeFile(path.join(f.folder, 'math.mjs'), 'export const add=()=>99;\n');
  await f.engine.prepareContext(done);
  assert.equal(f.room.store.get('record', record.id).validity, 'needs_review');
});
test('original edits made during review are preserved and block apply', async (t) => {
  const f = await fixture(t);
  assert.equal((await ready(f)).status, 'awaiting_apply');
  await writeFile(
    path.join(f.folder, 'math.mjs'),
    '// user changed this\nexport const add=()=>100;\n',
  );
  await assert.rejects(() => apply(f), /원본 코드/);
  assert.match(await readFile(path.join(f.folder, 'math.mjs'), 'utf8'), /user changed/);
  assert.equal(f.room.store.get('task', f.task.id).status, 'apply_conflict');
  assert.equal(f.room.store.list('apply-journal').length, 0);
});
test('tampering with a checked candidate invalidates its check and apply authority', async (t) => {
  const f = await fixture(t);
  const task = await ready(f);
  const change = f.engine.changes.get(task);
  await writeFile(path.join(change.candidate, 'math.mjs'), 'export const add=()=>0;\n');
  await assert.rejects(() => apply(f), /수정본/);
  assert.match(await readFile(path.join(f.folder, 'math.mjs'), 'utf8'), /a - b/);
});
test('a syntax failure never reaches model review or original application', async (t) => {
  const f = await fixture(t, { code: 'export const add = ( =>;' });
  const task = await ready(f);
  assert.equal(task.status, 'check_failed', task.message);
  assert.deepEqual(f.calls, ['develop']);
  assert.equal(task.outputs.check.result.status, 'failed');
  await assert.rejects(() => apply(f));
});
test('missing functional tests require an explicit review acknowledgement', async (t) => {
  const f = await fixture(t, { testFiles: [] });
  const task = await ready(f);
  assert.equal(task.status, 'awaiting_apply');
  assert.equal(task.outputs.check.result.status, 'unconfirmed');
  await assert.rejects(() => apply(f), /미확인/);
  await apply(f, { acceptUnconfirmed: true });
  await until(
    () => f.engine.active.size === 0 && f.room.store.get('task', f.task.id).status === 'accepted',
  );
});
test('restart reconciles an apply journal with files already replaced instead of repeating the model', async (t) => {
  const f = await fixture(t);
  const task = await ready(f),
    change = f.engine.changes.get(task);
  f.room.store.create('apply-journal', {
    taskId: task.id,
    productId: task.productId,
    changeSetId: change.id,
    artifactHash: change.artifactHash,
    state: 'prepared',
    appliedPaths: [],
  });
  f.room.store.update('task', task.id, task.revision, { ...task, status: 'applying' });
  applyOne(f.folder, change.changes[0]); // Simulate a crash after filesystem write, before journal update.
  f.engine.closed = true;
  const restarted = new AgentEngine(f.room, f.broker, {
    agentDirectory: path.join(f.directory, 'runtime'),
    nodeExecutable: process.execPath,
  });
  restarted.configure({ paused: true });
  assert.equal(f.room.store.get('task', task.id).status, 'apply_partial');
  const restored = f.room.store.get('task', task.id);
  await restarted.changes.apply({
    id: task.id,
    revision: restored.revision,
    artifactHash: change.artifactHash,
  });
  assert(f.room.store.get('task', task.id).appliedAt);
  assert.equal(f.room.store.list('apply-journal').length, 1);
  restarted.closed = true;
});
test('the source snapshot excludes symlinks, credentials and inline secrets', async (t) => {
  const f = await fixture(t, { hold: true });
  await until(() => !!f.broker.release);
  const external = path.join(f.directory, 'external');
  await mkdir(external);
  await writeFile(path.join(external, 'private.mjs'), 'private');
  await symlink(external, path.join(f.folder, 'linked'), 'junction');
  await writeFile(path.join(f.folder, '.env'), 'SECRET=value');
  await writeFile(path.join(f.folder, 'credentials.json'), '{}');
  await writeFile(path.join(f.folder, 'config.json'), '"api_key":"sk-abcdefghijklmnop"');
  const source = await sourceTree(f.folder);
  assert.equal(source.files['linked/private.mjs'], undefined);
  assert.equal(source.files['.env'], undefined);
  assert.equal(source.files['credentials.json'], undefined);
  assert.equal(source.files['config.json'], undefined);
  f.broker.release();
  await ready(f);
});
test('same-product changes serialize and different test scopes are not silently deduplicated', async (t) => {
  const f = await fixture(t, { hold: true });
  await until(() => !!f.broker.release);
  const same = f.engine.start({
    productId: f.product.id,
    goal: 'repair add',
    mode: 'change',
    testFiles: ['math.test.mjs'],
    allowTests: true,
  });
  assert.equal(same.id, f.task.id);
  const different = f.engine.start({
    productId: f.product.id,
    goal: 'repair add',
    mode: 'change',
    testFiles: [],
  });
  assert.notEqual(different.id, f.task.id);
  await pause();
  assert.equal(f.room.store.get('task', different.id).status, 'queued');
  assert.deepEqual(f.calls, ['develop']);
  await f.engine.stop({ id: different.id });
  f.broker.release();
  await ready(f);
});
test('selected tests are refused without explicit consent to run product code', async (t) => {
  const f = await fixture(t, { hold: true });
  await until(() => !!f.broker.release);
  assert.throws(
    () =>
      f.engine.start({
        productId: f.product.id,
        goal: 'run the product tests',
        mode: 'change',
        testFiles: ['math.test.mjs'],
      }),
    /지정한 테스트의 실행을 허용/,
  );
  assert.equal(f.room.store.list('task').filter((x) => x.kind === 'agent').length, 1);
  f.broker.release();
  await ready(f);
});
test('independent review must read and cite every changed file', async (t) => {
  const f = await fixture(t, { extraFile: true });
  const task = await ready(f);
  assert.equal(task.status, 'needs_review');
  await assert.rejects(() => apply(f));
});
test('selected test execution cannot write to the original product folder', async (t) => {
  const f = await fixture(t);
  const task = await ready(f),
    change = f.engine.changes.get(task),
    original = path.join(f.folder, 'math.mjs');
  const result = await runNode(
    process.execPath,
    [
      '--permission',
      `--allow-fs-read=${change.candidate}`,
      '-e',
      "require('node:fs').writeFileSync(process.argv[1],'unexpected')",
      original,
    ],
    change.candidate,
  );
  assert.equal(result.result, 'failed');
  assert.match(result.output, /ERR_ACCESS_DENIED/);
  assert.match(await readFile(original, 'utf8'), /a - b/);
});
test('a running local check is stopped and the process exit is observed', async (t) => {
  const f = await fixture(t);
  const task = await ready(f),
    change = f.engine.changes.get(task),
    controller = new AbortController();
  const pending = runNode(
    process.execPath,
    ['-e', 'setInterval(()=>{},1000)'],
    change.candidate,
    controller.signal,
  );
  const timer = setTimeout(() => controller.abort(), 200);
  try {
    assert.equal((await pending).result, 'cancelled');
  } finally {
    clearTimeout(timer);
  }
});
