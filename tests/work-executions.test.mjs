import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { Workroom } from '../src/core/service.mjs';
import { ControlService } from '../src/control/service.mjs';
import { createCommands } from '../src/control/commands.mjs';
import { captureCodexEvent } from '../src/integrations/codex-capture.mjs';
import { isExecutionEvidence, executionEvidence } from '../src/core/work-projection.mjs';
import { projectSummary } from '../src/shared/project-status.mjs';
import { PortfolioEditor } from '../src/runtime/portfolio-editor.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workroom-executions-'));
  const folder = path.join(directory, 'product');
  await mkdir(folder);
  const room = new Workroom(path.join(directory, 'room.sqlite'));
  t.after(async () => {
    room.close();
    await rm(directory, { recursive: true, force: true });
  });
  const product = await room.createProduct({ name: 'isolated', folder });
  room.setCodexCapture({ productId: product.id, enabled: true });
  const options = {
    room,
    getEngine: () => null,
    commands: createCommands({ room, getEngine: () => null }),
  };
  const control = new ControlService(options);
  const base = { session_id: 'host-session', turn_id: 'host-turn', cwd: folder };
  const report = (extra = {}) => ({
    productId: product.id,
    title: 'Fix',
    summary: 'Partial implementation',
    evidence: 'A real local fixture',
    limitations: 'Not a real client run',
    contribution: 'Fixture author',
    externalId: 'problem-a',
    ...extra,
  });
  const request = (extra = {}) => ({
    command: 'core.reportWork',
    args: report(extra),
    requestId: randomUUID(),
  });
  const observe = (req, event = {}) =>
    captureCodexEvent(room, product.id, {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_use_id: req.requestId,
      tool_name: 'mcp__workroom_acceptance__workroom_control_execute',
      tool_input: req,
      ...event,
    });
  const execute = async (req) => {
    control.execute(req);
    await control.pending.get(req.requestId);
    const op = control.operation(req.requestId);
    assert.equal(op.status, 'completed', op.error);
    return op.result;
  };
  const hook = () => {
    captureCodexEvent(room, product.id, {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_use_id: 'patch',
      tool_name: 'apply_patch',
      tool_input: { command: '*** Update File: input.js' },
      tool_response: {},
    });
    return captureCodexEvent(room, product.id, {
      ...base,
      hook_event_name: 'Stop',
      last_assistant_message: 'Fixed fixture input; remaining checks unverified.',
    });
  };
  const visible = () =>
    room.store.list('task').filter((r) => !isExecutionEvidence(r, room.store.list('task')));
  return {
    room,
    control,
    options,
    product,
    report,
    request,
    observe,
    execute,
    hook,
    visible,
    base,
    database: path.join(directory, 'room.sqlite'),
  };
}

for (const order of ['hook-first', 'report-first', 'concurrent'])
  test(`execution linkage handles ${order}, retry, report revision and distinct problems`, async (t) => {
    const f = await fixture(t);
    const portfolio = f.room.createPortfolio({ target: 'Fixture', autoProductIds: [f.product.id] });
    const req = f.request();
    if (order !== 'report-first') f.hook();
    if (order === 'concurrent') {
      f.control.execute(req);
      f.observe(req);
      await f.control.pending.get(req.requestId);
    } else {
      await f.execute(req);
      f.observe(req);
    }
    if (order === 'report-first') f.hook();
    const taskId = f.control.operation(req.requestId).result.id;
    assert.equal(f.visible().length, 1);
    assert.equal(f.room.store.get('task', taskId).executionLink.status, 'linked');
    assert.equal(
      executionEvidence(f.room.store.get('task', taskId), f.room.store.list('task')).length,
      1,
    );
    assert.equal(f.room.store.get('portfolio', portfolio.id).entries.length, 1);
    assert.equal(
      new PortfolioEditor({ store: f.room.store }).sources(
        f.room.store.get('portfolio', portfolio.id),
      ).length,
      1,
    );
    assert.equal(projectSummary(f.room.snapshot(), f.product).recentResults.length, 1);
    await f.execute(req);
    f.observe(req);
    f.hook();
    assert.equal(f.room.store.list('task').length, 2);
    const updated = { ...f.request({ sourceVersion: 2, summary: 'Corrected, still partial' }) };
    await f.execute(updated);
    f.observe(updated);
    assert.equal(f.visible().length, 1);
    assert.equal(f.room.store.list('work-report').filter((r) => r.taskId === taskId).length, 2);
    const another = f.request({ externalId: 'problem-b', title: 'Different problem' });
    await f.execute(another);
    f.observe(another);
    assert.equal(f.visible().length, 2, 'same turn does not merge different problems');
    assert.equal(f.room.store.get('portfolio', portfolio.id).entries.length, 2);
  });

test('pending observation survives delivery before admission and does not repeat effects', async (t) => {
  const f = await fixture(t);
  f.hook();
  const req = f.request();
  f.observe(req);
  assert.equal(f.room.store.list('execution-link')[0].observations[0].status, 'pending');
  await f.execute(req);
  assert.equal(f.visible().length, 1);
  new ControlService(f.options);
  assert.equal(f.visible().length, 1);
  assert.equal(f.room.store.list('work-receipt').length, 1);
});

test('nested registered folder owns MCP observations and parent hooks cannot claim them', async (t) => {
  const f = await fixture(t);
  const nestedFolder = path.join(f.base.cwd, 'nested');
  await mkdir(nestedFolder);
  const nested = await f.room.createProduct({ name: 'Nested fixture', folder: nestedFolder });
  f.room.setCodexCapture({ productId: nested.id, enabled: true });
  const req = f.request({ productId: nested.id });
  await f.execute(req);
  const event = {
    ...f.base,
    cwd: nestedFolder,
    hook_event_name: 'PostToolUse',
    tool_use_id: req.requestId,
    tool_name: 'mcp__alias__workroom_control_execute',
    tool_input: req,
  };
  assert.equal(captureCodexEvent(f.room, f.product.id, event).status, 'outside-product');
  assert.equal(captureCodexEvent(f.room, nested.id, event).status, 'observed');
  assert.equal(f.room.store.list('execution-link').length, 1);
  assert.equal(f.room.store.list('execution-link')[0].productId, nested.id);
  f.room.setCodexCapture({ productId: nested.id, enabled: false });
  assert.equal(
    captureCodexEvent(f.room, nested.id, { ...event, turn_id: 'opted-out' }).status,
    'disabled',
  );
  assert.equal(f.room.store.list('execution-link').length, 1);
});

test('wrong report, project, claimed origin and competing sessions never hide hook records', async (t) => {
  const f = await fixture(t);
  f.hook();
  const req = f.request({ execution: { client: 'claude', sessionId: 'not-host' } });
  await f.execute(req);
  f.observe(req);
  assert.equal(f.visible().length, 2);
  assert.equal(f.room.store.list('execution-link')[0].observations[0].status, 'conflict');
  const valid = f.request({ externalId: 'problem-c' });
  await f.execute(valid);
  f.observe({ ...valid, args: { ...valid.args, summary: 'wrong payload' } });
  assert.equal(f.visible().length, 3);
  const correct = f.request({ externalId: 'problem-d' });
  await f.execute(correct);
  f.observe(correct);
  f.observe(correct, { session_id: 'other-session' });
  assert.equal(f.visible().length, 4);
  const outsider = { ...f.request(), args: { ...f.report(), productId: randomUUID() } };
  assert.equal(f.observe(outsider).status, 'outside-product');
});

test('legacy report tool and omitted execution work; claimed IDs alone cannot integrate records', async (t) => {
  const f = await fixture(t);
  f.hook();
  const req = f.request({
    execution: { client: 'codex', sessionId: f.base.session_id, turnId: f.base.turn_id },
  });
  await f.execute(req);
  assert.equal(f.visible().length, 2);
  f.observe(req, {
    tool_name: 'mcp__alias__workroom_report_work',
    tool_input: { ...req.args, requestId: req.requestId },
  });
  assert.equal(f.visible().length, 1);
  assert.equal(f.control.read({ kind: 'execution-link', productId: f.product.id }).total, 1);
});

test('manual portfolio text and manual work links survive integration', async (t) => {
  const f = await fixture(t);
  const p = f.room.createPortfolio({ target: 'Fixture', autoProductIds: [f.product.id] });
  const hook = f.hook();
  const draft = f.room.store.get('portfolio', p.id);
  f.room.savePortfolio({
    id: p.id,
    revision: draft.revision,
    intro: '',
    requirements: '',
    entries: draft.entries.map((e) => ({ ...e, description: 'User-authored text' })),
  });
  const req = f.request();
  await f.execute(req);
  f.observe(req);
  assert.equal(
    f.room.store.get('portfolio', p.id).entries.find((e) => e.taskId === hook.taskId).description,
    'User-authored text',
  );
  const task = f.room.store.get('task', hook.taskId);
  f.room.changeWorkLink({
    id: task.id,
    revision: task.revision,
    parentTaskId: null,
    reason: 'Keep this separately',
  });
  f.room.executions.reconcile();
  assert.equal(f.visible().length, 2);
  assert.equal(
    executionEvidence(
      f.room.store.get('task', f.control.operation(req.requestId).result.id),
      f.room.store.list('task'),
    ).length,
    0,
  );
});

test('integration replaces duplicate automatic evidence even when a portfolio is full', async (t) => {
  const f = await fixture(t);
  const p = f.room.createPortfolio({ target: 'Full fixture', autoProductIds: [f.product.id] });
  for (let n = 0; n < 19; n++) f.room.reportWork(f.report({ externalId: `other-${n}` }));
  const hook = f.hook();
  const req = f.request();
  const task = await f.execute(req);
  assert(f.room.store.get('portfolio', p.id).pendingTaskIds.includes(task.id));
  f.observe(req);
  const saved = f.room.store.get('portfolio', p.id);
  assert.equal(saved.entries.length, 20);
  assert(saved.entries.some((e) => e.taskId === task.id));
  assert(!saved.entries.some((e) => e.taskId === hook.taskId));
  assert(!saved.pendingTaskIds.includes(task.id));
});

test('result persistence uncertainty links durable effect without declaring command completion', async (t) => {
  const f = await fixture(t);
  f.hook();
  const req = f.request();
  f.observe(req);
  const save = f.control.save.bind(f.control);
  f.control.save = (op, patch) => {
    if (patch.status === 'completed') throw new Error('fixture write failure');
    return save(op, patch);
  };
  f.control.execute(req);
  await f.control.pending.get(req.requestId);
  assert.equal(f.control.operation(req.requestId).status, 'uncertain');
  assert.equal(f.visible().length, 1);
  assert.equal(f.room.store.list('execution-link')[0].observations[0].operationStatus, 'uncertain');
  f.control.execute(req);
  assert.equal(f.room.store.list('work-receipt').length, 1);
});

test('actual process interruption recovers committed report receipt and pending observation', async (t) => {
  const f = await fixture(t);
  f.hook();
  const req = f.request();
  f.observe(req);
  const child = fork(new URL('./fixtures/execution-crash.mjs', import.meta.url), [], {
    execArgv: [],
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const exited = once(child, 'exit');
  const timer = setTimeout(() => child.kill(), 15000);
  t.after(async () => {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
    await exited;
  });
  const committed = once(child, 'message');
  child.send({ database: f.database, request: req });
  await Promise.race([
    committed,
    exited.then(() => {
      throw new Error('Crash fixture exited before commit');
    }),
  ]);
  child.kill();
  await exited;
  clearTimeout(timer);
  const recovered = new ControlService(f.options);
  assert.equal(recovered.operation(req.requestId).status, 'uncertain');
  assert.equal(f.visible().length, 1);
  assert.equal(f.room.store.list('execution-link')[0].observations[0].operationStatus, 'uncertain');
  recovered.execute(req);
  assert.equal(f.room.store.list('work-receipt').length, 1);
});
