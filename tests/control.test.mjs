import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Workroom } from '../src/core/service.mjs';
import { AgentEngine } from '../src/runtime/engine.mjs';
import { Publications } from '../src/core/publication.mjs';
import { createCommands } from '../src/control/commands.mjs';
import { ControlService } from '../src/control/service.mjs';
import { listenControl, controlRequest } from '../src/control/transport.mjs';
import { projectRoot } from '../src/core/paths.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workroom-control-'));
  const folder = path.join(directory, 'product');
  await mkdir(folder);
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  const broker = {
    status: { state: 'ready', models: [{ id: 'fixture' }] },
    request: async () => ({ ok: true }),
  };
  const engine = new AgentEngine(room, broker, { agentDirectory: path.join(directory, 'pi') });
  engine.configure({ paused: true, modelId: 'fixture' });
  let deployed = 0;
  const publications = new Publications(room, {
    assertReady() {},
    async deploy() {
      deployed++;
      return { id: 'fixture-deployment' };
    },
  });
  const commands = createCommands({
    room,
    getEngine: () => engine,
    getBroker: () => broker,
    publications,
    publishVault: { status: () => ({ state: 'missing' }), write() {} },
    shell: {},
  });
  const options = {
    room,
    commands,
    getEngine: () => engine,
    languageFile: path.join(directory, 'language.json'),
  };
  const control = new ControlService(options);
  t.after(async () => {
    engine.closed = true;
    room.close();
    await rm(directory, { recursive: true, force: true });
  });
  const execute = async (command, args, reviewed = false) => {
    const request = { command, args, requestId: randomUUID() };
    if (reviewed) request.reviewHash = control.review({ command, args }).reviewHash;
    control.execute(request);
    await control.pending.get(request.requestId);
    const result = control.operation(request.requestId);
    assert.equal(result.status, 'completed', result.error);
    return result.result;
  };
  return {
    directory,
    folder,
    room,
    engine,
    commands,
    options,
    control,
    execute,
    deployed: () => deployed,
  };
}

test('control replays concurrent request IDs, rejects changed content and stale reviewed state', async (t) => {
  const f = await fixture(t);
  const command = 'core.createProduct',
    args = { name: 'Fixture', folder: f.folder };
  assert.throws(() => f.control.execute({ command, args, requestId: randomUUID() }), /review/);
  const review = f.control.review({ command, args });
  const request = { command, args, reviewHash: review.reviewHash, requestId: randomUUID() };
  const first = f.control.execute(request);
  assert.equal(
    f.control.execute({ ...request, args: { folder: f.folder, name: 'Fixture' } }).id,
    first.id,
  );
  await f.control.pending.get(request.requestId);
  assert.equal(f.control.execute(request).status, 'completed');
  assert.equal(f.room.store.list('product').length, 1);
  assert.throws(
    () => f.control.execute({ ...request, args: { ...args, name: 'Changed' } }),
    /different content/,
  );
  const product = f.room.store.list('product')[0];
  const update = {
    command: 'core.updateProduct',
    args: { id: product.id, revision: product.revision, goal: 'Reviewed' },
  };
  const reviewed = f.control.review(update);
  await f.commands.core('updateProduct', { ...update.args, goal: 'Changed in app' });
  assert.throws(
    () =>
      f.control.execute({ ...update, reviewHash: reviewed.reviewHash, requestId: randomUUID() }),
    /changed/,
  );
  assert.throws(
    () => f.control.execute({ command: 'core.close', args: {}, requestId: randomUUID() }),
    /Unknown/,
  );
});

test('control publishes only the reviewed frozen version and replays without deploying twice', async (t) => {
  const f = await fixture(t);
  const p = await f.execute('core.createProduct', { name: 'Fixture', folder: f.folder }, true);
  const task = await f.execute('core.reportWork', {
    productId: p.id,
    title: 'Case',
    summary: 'Public result',
    evidence: 'PRIVATE',
    limitations: 'Fixture',
    contribution: 'Implemented',
  });
  assert.equal(task.actor, 'mcp');
  let portfolio = await f.execute('core.createPortfolio', { target: 'Target' });
  portfolio = await f.execute('core.savePortfolio', {
    id: portfolio.id,
    revision: portfolio.revision,
    intro: 'Introduction',
    requirements: '',
    entries: [
      {
        taskId: task.id,
        title: task.title,
        description: task.summary,
        contribution: task.contribution,
      },
    ],
  });
  await f.execute('publication.configure', {
    portfolioId: portfolio.id,
    version: 0,
    project: 'fixture-project',
    teamId: '',
  });
  const version = await f.execute('publication.prepare', {
    portfolioId: portfolio.id,
    revision: portfolio.revision,
  });
  const command = 'publication.publish',
    args = { id: version.id, artifactHash: version.artifactHash };
  const review = f.control.review({ command, args });
  assert.equal(
    review.evidence.find((r) => r.kind === 'publication').snapshot.intro,
    'Introduction',
  );
  const request = { command, args, requestId: randomUUID(), reviewHash: review.reviewHash };
  f.control.execute(request);
  await f.control.pending.get(request.requestId);
  assert.equal(f.control.operation(request.requestId).status, 'completed');
  assert.equal(f.control.execute(request).status, 'completed');
  assert.equal(f.deployed(), 1);
  const exported = f.control.export({
    id: portfolio.id,
    revision: portfolio.revision,
    language: 'en',
  });
  assert.match(exported.html, /Introduction/);
  assert.doesNotMatch(exported.html, /PRIVATE/);
});

test('unsettled commands become uncertain on restart; credential arguments and errors never persist', async (t) => {
  const f = await fixture(t);
  f.commands.runtime = () => new Promise(() => {});
  const request = { command: 'runtime.verify', args: {}, requestId: randomUUID() };
  f.control.execute(request);
  await Promise.resolve();
  const recovered = new ControlService(f.options);
  assert.equal(recovered.operation(request.requestId).status, 'uncertain');
  assert.equal(recovered.execute(request).status, 'uncertain');
  f.commands.publication = async () => {
    throw new Error('fixture-private-token');
  };
  const secret = {
    command: 'publication.credentials',
    args: { token: 'fixture-private-token' },
    requestId: randomUUID(),
  };
  assert.deepEqual(recovered.review({ command: secret.command, args: secret.args }).args, {
    redacted: true,
  });
  recovered.execute(secret);
  await recovered.pending.get(secret.requestId);
  assert.equal(
    JSON.stringify(f.room.store.list('control-operation')).includes('fixture-private-token'),
    false,
  );
});

test('real MCP stdio controls a single live executor through its authenticated local channel', async (t) => {
  const f = await fixture(t);
  const server = await listenControl(f.directory, (message) => f.control.handle(message));
  const client = new Client({ name: 'control-fixture', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, 'src/mcp/server.mjs')],
    env: { ...process.env, WORKROOM_DATA_DIR: f.directory, WORKROOM_SEMANTIC_SEARCH: '0' },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(!!result.isError, false, JSON.stringify(result));
      return JSON.parse(result.content[0].text);
    };
    const run = async (command, args, reviewed = false) => {
      const request = { command, args, requestId: randomUUID() };
      if (reviewed)
        request.reviewHash = (await call('workroom_control_prepare', { command, args })).reviewHash;
      let result = await call('workroom_control_execute', request);
      for (let n = 0; result.status === 'running' && n < 100; n++) {
        await new Promise((r) => setTimeout(r, 10));
        result = await call('workroom_control_operation', { requestId: request.requestId });
      }
      assert.equal(result.status, 'completed', result.error);
      return result.result;
    };
    const status = await call('workroom_control_connect');
    assert.equal(status.liveConnection, true);
    assert.equal(status.instanceId, f.control.instanceId);
    const product = await run(
      'core.createProduct',
      { name: 'MCP product', folder: f.folder },
      true,
    );
    const decision = await run('core.requestDecision', {
      productId: product.id,
      title: 'Direction',
      reason: 'Need a choice',
      options: [
        { label: 'A', effect: 'A effect' },
        { label: 'B', effect: 'B effect' },
      ],
    });
    await run('core.resolveDecision', { id: decision.id, revision: decision.revision, option: 0 });
    assert.equal(f.room.store.get('task', decision.id).status, 'decided');
    const task = await run('runtime.start', { productId: product.id, goal: 'Review source' });
    await run('runtime.stop', { id: task.id });
    assert.equal(f.room.store.get('task', task.id).status, 'stopped');
    const current = f.room.store.get('task', task.id);
    await run('runtime.resume', { id: task.id, revision: current.revision });
    assert.equal(f.room.store.get('task', task.id).status, 'queued');
    const portfolio = await run('core.createPortfolio', { target: 'MCP target' });
    await run('core.savePortfolio', {
      id: portfolio.id,
      revision: portfolio.revision,
      intro: 'Written via MCP',
      requirements: 'Experience',
      entries: [],
    });
    const result = await call('workroom_control_read', { kind: 'portfolio', id: portfolio.id });
    assert.equal(result.intro, 'Written via MCP');
    assert.equal((await f.commands.core('snapshot')).portfolios[0].intro, result.intro);
    // Authenticated success above cannot be reproduced with a guessed token.
    const endpoint =
      process.platform === 'win32' ? server.address() : path.join(f.directory, 'control.sock');
    const response = await new Promise((resolve, reject) => {
      const socket = net.createConnection(endpoint, () =>
        socket.write(JSON.stringify({ token: 'wrong', action: 'status' }) + '\n'),
      );
      socket.setEncoding('utf8');
      let value = '';
      socket.on('data', (chunk) => {
        value += chunk;
      });
      socket.on('end', () => resolve(JSON.parse(value)));
      socket.on('error', reject);
    });
    assert.equal(response.ok, false);
    assert.equal(
      Object.keys(
        JSON.parse(await readFile(path.join(f.directory, 'auth.control.json'), 'utf8')),
      ).includes('token'),
      true,
    );
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  }
  await assert.rejects(() => controlRequest(f.directory, 'status'), /unreachable/);
});
