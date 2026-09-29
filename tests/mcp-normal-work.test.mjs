import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Workroom } from '../src/core/service.mjs';
import { ControlService } from '../src/control/service.mjs';
import { createCommands } from '../src/control/commands.mjs';
import { listenControl } from '../src/control/transport.mjs';
import { projectRoot } from '../src/core/paths.mjs';

// SDK transport coverage, deliberately not described as autonomous Codex/Claude behavior.
test('ordinary direct file work reports real checks, preserves management fields and confirms storage over MCP without AI', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workroom-normal-mcp-'));
  const folder = path.join(directory, 'product');
  await mkdir(folder);
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  const product = await room.createProduct({ name: 'Ordinary fixture', folder });
  room.updateProjectStatus({
    id: product.id,
    revision: product.revision,
    lead: 'Fixture owner',
    targetDate: '2026-12-01',
    phase: 'active',
    health: 'at_risk',
    summary: 'Input defect',
    risks: 'Separate delivery risk',
    nextStep: 'Fix input',
  });
  const milestone = room.saveMilestone({
    productId: product.id,
    title: 'Input check',
    assignee: 'Fixture reviewer',
    targetDate: '2026-11-01',
    status: 'planned',
    note: '',
    taskIds: [],
  });
  const control = new ControlService({
    room,
    commands: createCommands({ room, getEngine: () => null }),
    getEngine: () => null,
    dataDirectory: directory,
  });
  const server = await listenControl(directory, (message, caller) =>
    control.handle(message, caller),
  );
  const client = new Client({ name: 'ordinary-work-sdk-test', version: '2' });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(projectRoot, 'src/mcp/server.mjs')],
        env: { ...process.env, WORKROOM_DATA_DIR: directory, WORKROOM_SEMANTIC_SEARCH: '0' },
        stderr: 'pipe',
      }),
    );
    const call = async (name, args = {}) => {
      const value = await client.callTool({ name, arguments: args });
      assert(!value.isError, JSON.stringify(value));
      return JSON.parse(value.content[0].text);
    };
    const run = async (command, args, requestId = randomUUID()) => {
      let value = await call('workroom_control_execute', { command, args, requestId });
      for (let n = 0; ['accepted', 'running'].includes(value.status) && n < 100; n++) {
        await new Promise((r) => setTimeout(r, 10));
        value = await call('workroom_control_operation', { requestId });
      }
      assert.equal(value.status, 'completed', value.error);
      return value.result;
    };
    assert.equal((await call('workroom_guide')).guidanceVersion, 2);
    assert.equal((await call('workroom_control_connect')).contractCompatible, true);
    assert.equal((await call('workroom_list_products'))[0].id, product.id);
    await run('core.context', { productId: product.id, query: 'Input defect' });
    const file = path.join(folder, 'input.mjs');
    const check = path.join(folder, 'input.test.mjs');
    await writeFile(file, 'export const clean = s => s;\n');
    await writeFile(
      check,
      "import { clean } from './input.mjs'; import assert from 'node:assert/strict'; assert.equal(clean(' ok '), 'ok');\n",
    );
    const { NODE_TEST_CONTEXT: _context, ...checkEnv } = process.env;
    const checkOptions = { windowsHide: true, env: checkEnv, encoding: 'utf8' };
    const before = spawnSync(process.execPath, ['--test', check], checkOptions);
    assert.notEqual(before.status, 0);
    assert.match(before.stdout + before.stderr, /AssertionError/);
    const base = {
      productId: product.id,
      externalId: 'input-problem',
      title: 'Input defect',
      summary: 'Reproduced; fix pending',
      evidence: 'Node assertion failed before modification',
      limitations: 'Not fixed yet; no deployment',
      contribution: 'Local fixture author',
      checks: [
        { name: 'Input assertion', result: 'failed', detail: 'Actual Node process exited nonzero' },
      ],
    };
    const partial = await call('workroom_report_work', { ...base, requestId: randomUUID() });
    assert.equal(partial.status, 'reported');
    assert.equal(room.store.list('work-receipt').length, 1);
    assert.equal(room.store.get('milestone', milestone.id).status, 'planned');
    await writeFile(file, 'export const clean = s => s.trim();\n');
    assert.equal(spawnSync(process.execPath, ['--test', check], checkOptions).status, 0);
    const requestId = randomUUID();
    const corrected = {
      ...base,
      sourceVersion: 2,
      summary: 'Trim defect fixed',
      evidence: 'Fail before edit, pass after edit',
      limitations: 'Local assertion only; no deployment',
      checks: [
        { name: 'Input assertion', result: 'passed', detail: 'Actual Node process exited 0' },
      ],
    };
    const saved = await run('core.reportWork', corrected, requestId);
    assert.equal((await run('core.reportWork', corrected, requestId)).id, saved.id);
    assert.equal(
      (await call('workroom_control_read', { kind: 'task', id: saved.id })).summary,
      corrected.summary,
    );
    const latest = await call('workroom_control_read', { kind: 'product', id: product.id });
    const { updatedAt: _updatedAt, ...management } = latest.management;
    await run('core.updateProjectStatus', {
      id: latest.id,
      revision: latest.revision,
      ...management,
      summary: 'Input defect fixed',
      nextStep: 'Delivery review',
    });
    const { id, revision, productId, title, assignee, targetDate } = await call(
      'workroom_control_read',
      { kind: 'milestone', id: milestone.id },
    );
    await run('core.saveMilestone', {
      id,
      revision,
      productId,
      title,
      assignee,
      targetDate,
      status: 'done',
      note: 'Node assertion fails before, passes after direct edit',
      taskIds: [saved.id],
    });
    const result = await run('core.projectReport', {
      productId: product.id,
      language: 'en',
      days: 7,
    });
    await writeFile(path.join(directory, 'report.md'), result.markdown);
    const final = room.store.get('product', product.id).management;
    for (const key of ['lead', 'targetDate', 'risks', 'phase'])
      assert.equal(final[key], management[key]);
    assert.equal((await call('workroom_list_work', { productId: product.id })).length, 1);
    assert.equal(room.store.list('change-set').length, 0, 'normal direct work was not resubmitted');
    assert.equal(room.store.list('agent-run').length, 0);
    assert.equal(room.store.list('publication').length, 0);
  } finally {
    await client.close();
    await new Promise((r) => server.close(r));
    room.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
