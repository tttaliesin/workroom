import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workroom } from '../src/core/service.mjs';
import { ControlService, fingerprint } from '../src/control/service.mjs';
import { createCommands } from '../src/control/commands.mjs';
import {
  commandContracts,
  commandSchemas,
  contractVersion,
  failure,
} from '../src/control/contracts.mjs';
import { catalog, schemaHash } from '../src/control/catalog.mjs';
import { listenControl, controlRequest } from '../src/control/transport.mjs';

function setup(t) {
  const room = new Workroom(':memory:');
  t.after(() => room.close());
  const commands = createCommands({ room, getEngine: () => null });
  const options = { room, commands, getEngine: () => null };
  return { room, commands, options, control: new ControlService(options) };
}
const request = () => ({
  command: 'core.createPortfolio',
  args: { target: 'Contract fixture' },
  requestId: randomUUID(),
});

test('every command has a concrete result contract and catalog shares the exact definitions', () => {
  assert.deepEqual(Object.keys(commandContracts), Object.keys(commandSchemas));
  for (const [name, contract] of Object.entries(commandContracts)) {
    assert.equal(contract.output.safeParse('unstructured response').success, false, name);
    if (name !== 'runtime.tick') assert.equal(catalog[name].contractVersion, contractVersion);
  }
  assert.equal(
    commandContracts['core.createPortfolio'].output.safeParse({ id: randomUUID(), revision: 1 })
      .success,
    false,
  );
  assert.equal(commandContracts['runtime.stop'].output.safeParse(null).success, true);
  assert.equal(
    commandContracts['settings.language'].output.safeParse({ language: 'invalid' }).success,
    false,
  );
  assert.match(schemaHash, /^[a-f0-9]{64}$/);
  const disk = new Error('disk unavailable');
  disk.code = 'SQLITE_IOERR';
  const problem = failure(disk, { phase: 'execution', effectMayHaveOccurred: true });
  assert.equal(problem.code, 'DOMAIN_REJECTED');
  assert.equal(problem.details.causeCode, 'SQLITE_IOERR');
  assert.equal(problem.recovery.action, 'inspect_effects');
  assert.equal(failure(disk, { requestId: 'invalid-id' }).recovery.requestId, undefined);
});

test('a malformed result after a real effect becomes uncertain and retry never repeats it', async (t) => {
  const f = setup(t),
    call = request(),
    original = f.commands.core;
  f.commands.core = async (...args) => {
    await original(...args);
    return { diagnostic: 'PRIVATE_OUTPUT_MUST_NOT_PERSIST' };
  };
  f.control.execute(call);
  await f.control.pending.get(call.requestId);
  const op = f.control.operation(call.requestId);
  assert.equal(op.status, 'uncertain');
  assert.equal(op.errorCode, 'RESULT_CONTRACT_INVALID');
  assert.equal(op.failure.phase, 'result');
  assert.equal(op.failure.effectMayHaveOccurred, true);
  assert.equal(op.failure.recovery.requestId, call.requestId);
  assert.equal(op.failure.recovery.automaticRetry, false);
  assert(!JSON.stringify(f.room.store.list('control-operation')).includes('PRIVATE_OUTPUT'));
  assert.equal(f.control.execute(call).status, 'uncertain');
  assert.equal(f.room.store.list('portfolio').length, 1);
  await assert.rejects(
    () => f.control.run(call.command, call.args, { requestId: call.requestId }),
    (error) => {
      const wire = failure(error);
      assert.equal(wire.phase, 'result');
      assert.equal(wire.effectMayHaveOccurred, true);
      return wire.recovery.requestId === call.requestId;
    },
  );
});

test('completion persistence failure keeps its effect uncertain even if saving diagnostics also fails', async (t) => {
  const f = setup(t),
    call = request(),
    update = f.room.store.update.bind(f.room.store);
  let broken = true;
  f.room.store.update = (kind, id, revision, body) => {
    if (broken && kind === 'control-operation' && ['completed', 'uncertain'].includes(body.status))
      throw new Error('disk unavailable');
    return update(kind, id, revision, body);
  };
  f.control.execute(call);
  await f.control.pending.get(call.requestId);
  assert.equal(f.control.operation(call.requestId).status, 'uncertain');
  assert.equal(f.control.operation(call.requestId).failure.phase, 'persistence');
  assert.equal(f.room.store.operation(call.requestId).status, 'running');
  assert.equal(f.control.execute(call).status, 'uncertain');
  broken = false;
  const restarted = new ControlService(f.options);
  assert.equal(restarted.execute(call).status, 'uncertain');
  assert.equal(restarted.operation(call.requestId).failure.effectMayHaveOccurred, true);
  assert.equal(f.room.store.list('portfolio').length, 1);
});

test('reconciliation cannot confirm a malformed task even when its stored status looks complete', async (t) => {
  const f = setup(t),
    requestId = randomUUID();
  const task = f.room.store.create('task', { status: 'awaiting_review' });
  f.room.store.create('control-operation', {
    requestId,
    command: 'external.submit',
    status: 'uncertain',
    targets: { taskId: task.id },
  });
  const result = await f.control.run('operation.reconcile', { requestId });
  assert.equal(result.operation.status, 'uncertain');
  assert.equal(result.resolution.outcome, 'unresolved');
  assert.equal(result.resolution.validationError, 'RESULT_CONTRACT_INVALID');
});

test('old durable results retain their original shape while new results identify their contract', async (t) => {
  const f = setup(t),
    call = request();
  const args = commandSchemas[call.command].parse(call.args);
  f.room.store.create('control-operation', {
    requestId: call.requestId,
    command: call.command,
    fingerprint: fingerprint({ command: call.command, args }),
    status: 'completed',
    result: { oldResult: true },
  });
  assert.deepEqual(f.control.execute(call).result, { oldResult: true });
  assert.equal(f.control.operation(call.requestId).contractVersion, 0);
  const next = request();
  await f.control.run(next.command, next.args, { requestId: next.requestId });
  assert.equal(f.control.operation(next.requestId).contractVersion, contractVersion);
  assert.equal(f.control.operation(next.requestId).schemaHash, schemaHash);
  assert.equal(f.control.status().schemaHash, schemaHash);
});

test('credential projection validates its actual acknowledgement and never stores malformed private output', async (t) => {
  const f = setup(t);
  f.commands.publication = async () => ({
    saved: false,
    private: 'PRIVATE_MALFORMED_CREDENTIAL_RESULT',
  });
  const call = {
    command: 'publication.credentials',
    args: { token: 'fixture-token-value' },
    requestId: randomUUID(),
  };
  f.control.execute(call);
  await f.control.pending.get(call.requestId);
  const op = f.control.operation(call.requestId);
  assert.equal(op.status, 'uncertain');
  assert.equal(op.failure.code, 'RESULT_CONTRACT_INVALID');
  assert.equal(op.failure.phase, 'result');
  assert(!JSON.stringify(f.room.store.list('control-operation')).includes('PRIVATE_MALFORMED'));
});

test('oversized legacy responses retain the completed effect and guide callers to the original request', async (t) => {
  const f = setup(t),
    directory = await mkdtemp(path.join(os.tmpdir(), 'workroom-result-wire-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const product = await f.room.createProduct({ name: 'Wire fixture', folder: directory });
  const call = {
    command: 'core.requestDecision',
    args: {
      productId: product.id,
      title: 'Choose next work',
      reason: 'Fixture decision',
      options: [
        { label: 'Continue', effect: 'Continue fixture' },
        { label: 'Stop', effect: 'Stop fixture' },
      ],
    },
    requestId: randomUUID(),
  };
  const original = f.commands.core;
  f.commands.core = async (...args) => ({
    ...(await original(...args)),
    largeExtension: 'x'.repeat(17 * 1024 * 1024),
  });
  const server = await listenControl(directory, (message, caller) =>
    f.control.handle(message, caller),
  );
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(
        () => controlRequest(directory, 'legacy', call),
        (error) => {
          const wire = failure(error);
          assert.equal(wire.phase, 'transport');
          assert.equal(wire.effectMayHaveOccurred, true);
          assert.equal(wire.recovery.action, 'query_request');
          return wire.recovery.requestId === call.requestId;
        },
      );
    }
    assert.equal(f.control.operation(call.requestId).status, 'completed');
    assert.equal(f.room.store.list('task').length, 1);
    await assert.rejects(
      () => controlRequest(directory, 'legacy', { ...call, args: {} }),
      (error) => {
        const wire = failure(error);
        assert.equal(wire.phase, 'admission');
        assert.equal(wire.effectMayHaveOccurred, false);
        return wire.recovery.requestId === call.requestId;
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
