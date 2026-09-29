import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Workroom } from '../src/core/service.mjs';
import { projectRoot } from '../src/core/paths.mjs';
import { readProductFile } from '../src/runtime/files.mjs';
import { createCommands } from '../src/control/commands.mjs';
import { ControlService } from '../src/control/service.mjs';
import { listenControl } from '../src/control/transport.mjs';

test('real MCP stdio preserves records and advertises explicit reviewed control separately', async (t) => {
  const parent = path.join(projectRoot, 'work/tests');
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(path.join(parent, 'mcp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  mkdirSync(repo);
  const room = new Workroom(path.join(dir, 'workroom.sqlite'));
  const product = await room.createProduct({ name: 'MCP 제품', folder: repo });
  const commands = createCommands({ room, getEngine: () => null });
  const control = new ControlService({ room, commands, getEngine: () => null });
  const socket = await listenControl(dir, (message) => control.handle(message));
  t.after(() => new Promise((resolve) => socket.close(resolve)));
  const client = new Client({ name: 'workroom-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, 'src/mcp/server.mjs')],
    env: { ...process.env, WORKROOM_DATA_DIR: dir, WORKROOM_SEMANTIC_SEARCH: '0' },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === 'workroom_guide' && t.annotations.readOnlyHint));
    assert.ok(tools.some((t) => t.name === 'workroom_list_work'));
    assert.ok(tools.some((t) => t.name === 'workroom_control_execute'));
    const catalog = await client.callTool({ name: 'workroom_control_catalog', arguments: {} });
    assert.equal(
      JSON.parse(catalog.content[0].text).commands['runtime.applyChange'].reviewRequired,
      true,
    );
    const operation = await client.callTool({
      name: 'workroom_operation_status',
      arguments: { productId: product.id },
    });
    assert.equal(operation.isError, undefined);
    assert.deepEqual(JSON.parse(operation.content[0].text).issues, []);
    const list = await client.callTool({ name: 'workroom_list_products', arguments: {} });
    assert.equal(JSON.parse(list.content[0].text)[0].id, product.id);
    const internal = room.store.create('task', {
      productId: product.id,
      kind: 'agent',
      title: '내장 조사',
      goal: '입력 조사',
      status: 'running',
      stage: 'investigate',
    });
    room.store.create('agent-run', {
      productId: product.id,
      taskId: internal.id,
      role: 'investigate',
      status: 'running',
      owner: 'private-owner',
      modelId: 'fixture-model',
    });
    const execution = await client.callTool({
      name: 'workroom_agent_status',
      arguments: { productId: product.id },
    });
    const executionData = JSON.parse(execution.content[0].text);
    assert.equal(executionData.liveConnection, false);
    assert.equal(executionData.tasks[0].id, internal.id);
    assert.equal('owner' in executionData.runs[0], false);
    const result = await client.callTool({
      name: 'workroom_request_decision',
      arguments: {
        productId: product.id,
        title: '중복 처리',
        reason: '방침 미정',
        options: [
          { label: '기존 유지', effect: '신규 충돌 제외' },
          { label: '갱신', effect: '기존 덮어쓰기' },
        ],
      },
    });
    assert.ok(!result.isError);
    const task = room.snapshot().tasks[0];
    assert.equal(task.actor, 'mcp');
    room.resolveDecision({ id: task.id, revision: task.revision, option: 0 });
    const context = await client.callTool({
      name: 'workroom_product_context',
      arguments: { productId: product.id, query: '중복' },
    });
    assert.match(JSON.parse(context.content[0].text).records[0].content, /기존 유지/);
    const bad = await client.callTool({
      name: 'workroom_product_context',
      arguments: { productId: 'not-a-uuid' },
    });
    assert.equal(bad.isError, true);
    const work = await client.callTool({
      name: 'workroom_report_work',
      arguments: {
        productId: product.id,
        title: '입력 보호',
        summary: '미저장 입력 보존',
        evidence: '회귀 검사 보고',
        limitations: '운영 미확인',
        contribution: '에이전트 구현',
        changedFiles: [{ path: 'src/input.js', summary: '입력 보호 추가' }],
        checks: [{ name: '회귀 검사', result: 'passed', detail: '에이전트가 보고한 결과' }],
      },
    });
    assert.ok(!work.isError);
    const reported = JSON.parse(work.content[0].text);
    assert.equal(reported.actor, 'mcp');
    assert.equal(reported.verification, 'reported');
    const readBack = await client.callTool({
      name: 'workroom_list_work',
      arguments: { productId: product.id },
    });
    assert.ok(!readBack.isError);
    assert.deepEqual(JSON.parse(readBack.content[0].text), [reported]);
    assert.equal(
      room.snapshot().tasks.find((t) => t.id === reported.id).checks[0].result,
      'passed',
    );
    // The separate MCP process must check current source files without an earlier Pi query.
    await writeFile(path.join(repo, 'README.md'), 'UniqueMarker original setting');
    const evidence = room.store.create('agent-evidence', {
      productId: product.id,
      ...(await readProductFile(repo, 'README.md')),
    });
    const record = room.store.create('record', {
      productId: product.id,
      title: 'UniqueMarker setting',
      content: 'Original setting',
      scope: 'UniqueMarker',
      source: 'Fixture',
      active: true,
      evidenceIds: [evidence.id],
    });
    const query = () =>
      client.callTool({
        name: 'workroom_product_context',
        arguments: { productId: product.id, query: 'UniqueMarker' },
      });
    assert.equal(JSON.parse((await query()).content[0].text).records[0].id, record.id);
    await writeFile(path.join(repo, 'README.md'), 'UniqueMarker changed setting');
    const stale = await query();
    assert.ok(!stale.isError);
    assert.deepEqual(JSON.parse(stale.content[0].text).records, []);
    assert.equal(room.store.get('record', record.id).validity, 'needs_review');
  } finally {
    await client.close();
    room.close();
  }
});
