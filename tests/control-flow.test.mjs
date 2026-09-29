import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Workroom } from '../src/core/service.mjs';
import { AgentEngine } from '../src/runtime/engine.mjs';
import { ControlService } from '../src/control/service.mjs';
import { createCommands } from '../src/control/commands.mjs';
import { listenControl, controlRequest } from '../src/control/transport.mjs';
import { authorize } from './control-support.mjs';
import { projectRoot } from '../src/core/paths.mjs';

const before = 'export const add = (a,b) => a - b;\n';
const after = 'export const add = (a,b) => a + b;\n';
const digest = (s) => createHash('sha256').update(s).digest('hex');

test('an actual executor process killed after an effect preserves uncertainty and never replays it', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workroom-crash-'));
  let child;
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exited;
  };
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const launch = async (interrupt) => {
    // The pause is fault injection; SQLite, socket, process death and restart are real.
    const source = `
      import { Workroom } from ${JSON.stringify(new URL('../src/core/service.mjs', import.meta.url).href)};
      import { ControlService } from ${JSON.stringify(new URL('../src/control/service.mjs', import.meta.url).href)};
      import { listenControl } from ${JSON.stringify(new URL('../src/control/transport.mjs', import.meta.url).href)};
      const directory = ${JSON.stringify(directory)};
      const room = new Workroom(${JSON.stringify(path.join(directory, 'workroom.sqlite'))});
      const commands = { core: async (method, args) => {
        const result = await room[method](args);
        if (${interrupt} && method === 'createPortfolio') {
          process.stdout.write('effect\\n');
          await new Promise(() => {});
        }
        return result;
      }};
      const control = new ControlService({room, commands, getEngine: () => null, dataDirectory: directory});
      await listenControl(directory, (message, caller) => control.handle(message, caller));
      process.stdout.write('ready\\n');
    `;
    child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      errors = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    const waitFor = async (line) => {
      for (let n = 0; n < 250; n++) {
        if (output.includes(line)) return;
        if (child.exitCode !== null) throw new Error(errors);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Executor did not report ${line}: ${errors}`);
    };
    await waitFor('ready');
    return waitFor;
  };
  const effect = await launch(true);
  const request = {
    command: 'core.createPortfolio',
    args: { target: 'Durable effect' },
    requestId: randomUUID(),
  };
  await controlRequest(directory, 'execute', request);
  await effect('effect');
  await stop();
  await launch(false);
  const interrupted = await controlRequest(directory, 'operation', {
    requestId: request.requestId,
  });
  assert.equal(interrupted.status, 'uncertain');
  assert.equal((await controlRequest(directory, 'execute', request)).status, 'uncertain');
  assert.equal((await controlRequest(directory, 'read', { kind: 'portfolio' })).total, 1);
  await assert.rejects(
    () =>
      controlRequest(directory, 'execute', {
        ...request,
        args: { target: 'Changed request' },
      }),
    { code: 'REQUEST_ID_CONFLICT' },
  );
});

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workroom-flow-')),
    folder = path.join(directory, 'product');
  await mkdir(folder);
  await writeFile(path.join(folder, 'math.mjs'), before);
  await writeFile(
    path.join(folder, 'math.test.mjs'),
    "import test from 'node:test';import assert from 'node:assert/strict';import {add} from './math.mjs';test('adds',()=>assert.equal(add(2,3),5));",
  );
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  let aiCalls = 0;
  const engine = new AgentEngine(
    room,
    {
      status: { state: 'disconnected', models: [] },
      request: async () => {
        aiCalls++;
        throw new Error('No AI allowed');
      },
    },
    { agentDirectory: path.join(directory, 'pi'), nodeExecutable: process.execPath },
  );
  const commands = createCommands({
    room,
    getEngine: () => engine,
    getBroker: () => engine.broker,
    publishVault: { status: () => ({ state: 'missing' }) },
  });
  const options = {
    room,
    commands,
    getEngine: () => engine,
    languageFile: path.join(directory, 'language.json'),
    dataDirectory: directory,
  };
  const control = new ControlService(options);
  t.after(async () => {
    engine.closed = true;
    room.close();
    await rm(directory, { recursive: true, force: true });
  });
  const product = await control.fromApp('core.createProduct', { name: 'Control fixture', folder });
  const submit = (files = [{ path: 'math.mjs', beforeHash: digest(before), content: after }]) => ({
    productId: product.id,
    productRevision: product.revision,
    goal: 'Fix addition',
    source: 'Codex fixture',
    limitations: 'Integer fixture only',
    testFiles: ['math.test.mjs'],
    allowTests: true,
    files,
  });
  const runReviewed = async (command, args) =>
    control.run(command, args, await authorize(control, command, args));
  return {
    directory,
    folder,
    room,
    engine,
    commands,
    control,
    options,
    product,
    submit,
    runReviewed,
    aiCalls: () => aiCalls,
  };
}

test('account-free real MCP submits, checks, reviews, decides and applies an external change once', async (t) => {
  const f = await setup(t);
  const server = await listenControl(f.directory, (message) => f.control.handle(message));
  const client = new Client({ name: 'external-flow', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, 'src/mcp/server.mjs')],
    env: { ...process.env, WORKROOM_DATA_DIR: f.directory, WORKROOM_SEMANTIC_SEARCH: '0' },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const call = async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      assert(!r.isError, JSON.stringify(r));
      return JSON.parse(r.content[0].text);
    };
    const settle = async (op) => {
      for (let n = 0; ['accepted', 'running'].includes(op.status) && n < 500; n++) {
        await new Promise((r) => setTimeout(r, 20));
        op = await call('workroom_control_operation', { requestId: op.requestId });
      }
      assert.equal(op.status, 'completed', JSON.stringify(op));
      return op;
    };
    const run = async (command, args) =>
      (
        await settle(
          await call('workroom_control_execute', { command, args, requestId: randomUUID() }),
        )
      ).result;
    const reviewed = async (command, args) => {
      const p = await call('workroom_control_prepare', { command, args });
      const r = await run('review.submit', {
        packageId: p.id,
        verdict: 'supported',
        assessment: 'Read all changed files and actual checks',
        limitations: 'Local fixture only',
        files: (p.evidence.find((e) => e.kind === 'change-set')?.changes || []).map((c) => ({
          path: c.path,
          hash: c.afterHash,
        })),
      });
      const d = await run('review.decide', {
        reviewId: r.id,
        choice: 'execute',
        authority: {
          basis: 'delegated',
          reference: 'User delegated this fixture review and apply',
        },
      });
      return { command, args, reviewId: r.id, decisionId: d.id, requestId: randomUUID() };
    };
    const request = await reviewed('external.submit', f.submit());
    const usage = await call('workroom_guide', { topic: 'development', language: 'en' });
    assert(usage.commands.some((c) => c.name === 'external.submit' && c.reviewRequired));
    assert.match(client.getInstructions(), /hashes are not (?:review or )?consent/i);
    const accepted = await call('workroom_control_execute', request);
    assert.equal((await call('workroom_control_execute', request)).id, accepted.id);
    const task = (await settle(accepted)).result;
    assert.equal(task.status, 'awaiting_review');
    assert.equal(task.outputs.check.result.status, 'passed');
    assert.equal(task.outputs.change_review, undefined);
    assert.equal(await readFile(path.join(f.folder, 'math.mjs'), 'utf8'), before);
    const change = await call('workroom_control_read', {
      kind: 'change-set',
      id: task.changeSetId,
    });
    const apply = await reviewed('runtime.applyChange', {
      id: task.id,
      revision: task.revision,
      artifactHash: change.artifactHash,
    });
    const result = (await settle(await call('workroom_control_execute', apply))).result;
    assert(result.appliedAt);
    assert.equal(await readFile(path.join(f.folder, 'math.mjs'), 'utf8'), after);
    assert.equal((await call('workroom_control_execute', apply)).status, 'completed');
    assert.equal(f.room.store.list('apply-journal').length, 1);
    assert.equal(f.aiCalls(), 0);
    const snapshot = await f.commands.core('snapshot');
    assert(snapshot.reviewRecords.some((r) => r.id === apply.reviewId));
    assert(snapshot.executionDecisions.some((d) => d.id === apply.decisionId));
    assert.equal(
      f.room.store.get(
        'task',
        result.resultTaskId || f.room.store.get('task', task.id).resultTaskId,
      ).actor,
      'mcp',
    );
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('hash-only authority, incomplete review, rejection and superseded decisions cannot apply', async (t) => {
  const f = await setup(t),
    task = await f.runReviewed('external.submit', f.submit());
  const args = {
      id: task.id,
      revision: task.revision,
      artifactHash: task.outputs.check.result.artifactHash,
    },
    command = 'runtime.applyChange';
  const p = f.control.review({ command, args });
  assert.throws(
    () => f.control.execute({ command, args, requestId: randomUUID(), reviewHash: p.packageHash }),
    { code: 'DECISION_REQUIRED' },
  );
  await assert.rejects(
    () =>
      f.control.run('review.submit', {
        packageId: p.id,
        verdict: 'supported',
        assessment: 'Claim',
        limitations: 'None read',
        files: [],
      }),
    { code: 'REVIEW_INCOMPLETE' },
  );
  const good = await authorize(f.control, command, args);
  await f.control.run('review.decide', {
    reviewId: good.reviewId,
    choice: 'reject',
    authority: { basis: 'user_instruction', reference: 'Do not apply' },
  });
  assert.throws(() => f.control.execute({ command, args, ...good, requestId: randomUUID() }), {
    code: 'DECISION_SUPERSEDED',
  });
  const p2 = f.control.review({ command, args });
  const negative = await f.control.run('review.submit', {
    packageId: p2.id,
    verdict: 'changes_requested',
    assessment: 'More work needed',
    limitations: 'Partial review',
  });
  await assert.rejects(
    () =>
      f.control.run('review.decide', {
        reviewId: negative.id,
        choice: 'execute',
        authority: { basis: 'delegated', reference: 'Fixture' },
      }),
    { code: 'REVIEW_NOT_SUPPORTED' },
  );
  assert.equal(await readFile(path.join(f.folder, 'math.mjs'), 'utf8'), before);
});

test('explicit dependencies reject changed scope while unrelated language changes preserve review', async (t) => {
  const f = await setup(t),
    args = f.submit(),
    authority = await authorize(f.control, 'external.submit', args);
  await f.control.fromApp('settings.language', { language: 'en' });
  const task = await f.control.run('external.submit', args, authority);
  const input = {
    id: task.id,
    revision: task.revision,
    artifactHash: task.outputs.check.result.artifactHash,
  };
  const decision = await authorize(f.control, 'runtime.applyChange', input);
  await f.control.fromApp('core.updateProduct', {
    id: f.product.id,
    revision: f.product.revision,
    goal: 'Changed scope',
  });
  assert.throws(
    () =>
      f.control.execute({
        command: 'runtime.applyChange',
        args: input,
        ...decision,
        requestId: randomUUID(),
      }),
    { code: 'REVIEW_STALE' },
  );
  assert.equal(await readFile(path.join(f.folder, 'math.mjs'), 'utf8'), before);
});

test('failed actual checks cannot be overridden, and original changes remain protected', async (t) => {
  const f = await setup(t);
  const task = await f.runReviewed(
    'external.submit',
    f.submit([
      { path: 'math.mjs', beforeHash: digest(before), content: 'export const add = () => 0;\n' },
    ]),
  );
  assert.equal(task.outputs.check.result.status, 'failed');
  const args = {
    id: task.id,
    revision: task.revision,
    artifactHash: task.outputs.check.result.artifactHash,
    acceptUnconfirmed: true,
  };
  await assert.rejects(() => f.runReviewed('runtime.applyChange', args));
  assert.equal(await readFile(path.join(f.folder, 'math.mjs'), 'utf8'), before);
  const good = await f.runReviewed('external.submit', f.submit());
  const input = {
    id: good.id,
    revision: good.revision,
    artifactHash: good.outputs.check.result.artifactHash,
  };
  const decision = await authorize(f.control, 'runtime.applyChange', input);
  await writeFile(path.join(f.folder, 'math.mjs'), 'user edit');
  await assert.rejects(() => f.control.run('runtime.applyChange', input, decision), /원본 코드/);
  assert.equal(await readFile(path.join(f.folder, 'math.mjs'), 'utf8'), 'user edit');
});

test('partial-apply interruption stays uncertain until actual remaining files and journal confirm completion', async (t) => {
  const f = await setup(t);
  const task = await f.runReviewed(
    'external.submit',
    f.submit([
      { path: 'math.mjs', beforeHash: digest(before), content: after },
      { path: 'extra.mjs', beforeHash: null, content: 'export const extra = true;\n' },
    ]),
  );
  const change = f.room.store.get('change-set', task.changeSetId);
  await writeFile(path.join(f.folder, 'math.mjs'), after);
  f.room.store.create('apply-journal', {
    taskId: task.id,
    productId: task.productId,
    changeSetId: change.id,
    artifactHash: change.artifactHash,
    state: 'applying',
    appliedPaths: ['math.mjs'],
  });
  const current = f.engine.updateTask(task, { status: 'apply_partial' });
  const requestId = randomUUID();
  f.room.store.create('control-operation', {
    requestId,
    command: 'runtime.applyChange',
    status: 'running',
    targets: { id: task.id, artifactHash: change.artifactHash },
    fingerprint: 'interrupted-fixture',
  });
  const recovered = new ControlService(f.options);
  assert.equal(recovered.operation(requestId).status, 'uncertain');
  assert.equal(
    (await recovered.run('operation.reconcile', { requestId })).resolution.outcome,
    'unresolved',
  );
  const args = { id: current.id, revision: current.revision, artifactHash: change.artifactHash };
  await recovered.run(
    'runtime.applyChange',
    args,
    await authorize(recovered, 'runtime.applyChange', args),
  );
  assert.equal(
    (await recovered.run('operation.reconcile', { requestId })).operation.status,
    'completed',
  );
  assert.equal(
    await readFile(path.join(f.folder, 'extra.mjs'), 'utf8'),
    'export const extra = true;\n',
  );
  assert.equal(f.room.store.list('apply-journal').length, 1);
});

test('app and MCP share admission, store enforces request uniqueness and queued cancellation has no effect', async (t) => {
  const f = await setup(t),
    requestId = randomUUID(),
    args = { target: 'Same request' };
  const first = await f.control.fromApp('core.createPortfolio', args, requestId);
  assert.equal((await f.control.run('core.createPortfolio', args, { requestId })).id, first.id);
  assert.throws(
    () =>
      f.control.execute({ command: 'core.createPortfolio', args: { target: 'Other' }, requestId }),
    { code: 'REQUEST_ID_CONFLICT' },
  );
  assert.throws(
    () => f.room.store.create('control-operation', { requestId, status: 'accepted' }),
    /UNIQUE/,
  );
  const cancelled = randomUUID();
  f.control.execute({
    command: 'core.createPortfolio',
    args: { target: 'Cancelled' },
    requestId: cancelled,
  });
  await f.control.invoke(
    'operation.cancel',
    { requestId: cancelled },
    { caller: { channel: 'app', sessionId: 'fixture' } },
  );
  await f.control.pending.get(cancelled);
  assert.equal(f.control.operation(cancelled).status, 'cancelled');
  assert.equal(f.room.store.list('portfolio').length, 1);
});

test('the actual Codex hook sends scoped events to the common executor and keeps reports idempotent', async (t) => {
  const f = await setup(t);
  await f.control.fromApp('core.setCodexCapture', { productId: f.product.id, enabled: true });
  const server = await listenControl(f.directory, (message, caller) =>
    f.control.handle(message, caller),
  );
  const binding = Buffer.from(
    JSON.stringify({
      database: path.join(f.directory, 'workroom.sqlite'),
      productId: f.product.id,
    }),
  ).toString('base64url');
  const event = { session_id: 'fixture-session', turn_id: 'fixture-turn', cwd: f.folder };
  const hook = (input) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.join(projectRoot, 'src/integrations/codex-hook.mjs'), '--binding', binding],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      );
      let output = '';
      child.stdout.on('data', (c) => {
        output += c;
      });
      child.stderr.resume();
      child.on('error', reject);
      child.on('close', (code) => {
        try {
          assert.equal(code, 0);
          assert.deepEqual(JSON.parse(output), {});
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(JSON.stringify(input));
    });
  try {
    await hook({
      ...event,
      hook_event_name: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_use_id: 'fixture-patch',
      tool_input: {
        command: '*** Begin Patch\n*** Update File: math.mjs\n@@\n-a\n+b\n*** End Patch',
      },
      tool_response: {},
    });
    const stop = {
      ...event,
      hook_event_name: 'Stop',
      last_assistant_message: 'Recorded fixture change.',
    };
    await hook(stop);
    const token = f.room.changes();
    await hook(stop);
    assert.equal(f.room.changes(), token);
    assert.equal(f.room.store.list('task').filter((task) => task.actor === 'codex-hook').length, 1);
    assert.equal(
      f.room.store
        .list('control-operation')
        .filter((op) => op.command === 'capture.event' && op.status === 'completed').length,
      3,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
