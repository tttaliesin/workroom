import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Workroom } from '../src/core/service.mjs';
import { projectRoot } from '../src/core/paths.mjs';

test('real MCP stdio handshake and tool calls share the app database without exposing authority changes', async () => {
  const parent = path.join(projectRoot, 'work/tests');
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(path.join(parent, 'mcp-'));
  const repo = path.join(dir, 'repo');
  mkdirSync(repo);
  const room = new Workroom(path.join(dir, 'workroom.sqlite'));
  const product = await room.createProduct({ name: 'MCP 제품', folder: repo });
  const client = new Client({ name: 'workroom-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, 'src/mcp/server.mjs')],
    env: { ...process.env, WORKROOM_DATA_DIR: dir },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 10);
    assert.ok(tools.some((t) => t.name === 'workroom_list_work'));
    assert.ok(!tools.some((t) => /resolve|export|create_product|configure|apply/.test(t.name)));
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
    assert.equal(
      room.snapshot().tasks.find((t) => t.id === reported.id).checks[0].result,
      'passed',
    );
  } finally {
    await client.close();
    room.close();
  }
});
