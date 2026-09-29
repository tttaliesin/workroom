const { createFixture } = require('./lib/fixture.cjs');
const { _electron } = require('./lib/playwright.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');

(async () => {
  const root = path.resolve(__dirname, '../..');
  // Windows may release Chromium/SQLite handles after the background process tree has exited.
  const directory = createFixture(path.join(root, 'work/control-ui-'), { cleanupRetries: 20 });
  const folder = path.join(directory, 'product'); fs.mkdirSync(folder);
  const original = 'export const add = (a,b) => a - b;\n', fixed = 'export const add = (a,b) => a + b;\n';
  fs.writeFileSync(path.join(folder, 'math.mjs'), original);
  fs.writeFileSync(path.join(folder, 'math.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';import {add} from './math.mjs';test('adds',()=>assert.equal(add(2,3),5));");
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { Workroom } = await import('../../src/core/service.mjs');
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  room.store.create('runtime-settings', { paused: true, modelId: null });
  room.close();
  const env = { ...process.env, WORKROOM_DATA_DIR: directory, WORKROOM_NODE: process.execPath, WORKROOM_SEMANTIC_SEARCH: '0', WORKROOM_HEADLESS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const client = new Client({ name: 'desktop-control-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src/mcp/server.mjs')], env, stderr: 'pipe' });
  let app, page, ownedServicePid;
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  const run = async (command, args, reviewed = false) => {
    const request = { command, args, requestId: randomUUID() };
    if (reviewed) {
      const p = await call('workroom_control_prepare', { command, args });
      const r = (await run('review.submit', { packageId: p.id, verdict: 'supported', assessment: 'Reviewed fixture', limitations: 'Local test', files: (p.evidence.find((e) => e.kind === 'change-set')?.changes || []).map((c) => ({ path: c.path, hash: c.afterHash })) })).result;
      const d = (await run('review.decide', { reviewId: r.id, choice: 'execute', authority: { basis: 'user_instruction', reference: 'Fixture instruction' } })).result;
      Object.assign(request, { reviewId: r.id, decisionId: d.id });
    }
    let result = await call('workroom_control_execute', request);
    for (let n = 0; ['accepted', 'running'].includes(result.status) && n < 500; n++) {
      await new Promise((r) => setTimeout(r, 20));
      result = await call('workroom_control_operation', { requestId: request.requestId });
    }
    assert.equal(result.status, 'completed', result.error);
    return result;
  };
  try {
    await client.connect(transport);
    assert.equal((await call('workroom_control_connect')).liveConnection, false);
    app = await _electron.launch({ executablePath: require('electron'), args: [root, '--workroom-service'], env });
    page = await app.firstWindow(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => !!window.workroom);
    const status = await call('workroom_control_connect');
    assert.equal(status.liveConnection, true);
    assert.equal(status.contractCompatible, true);
    assert.equal(status.readyForControl, true);
    assert.equal(status.adapter.freshness, 'current');
    assert.equal(status.executor.freshness, 'current');
    assert.equal((await call('workroom_guide', { topic: 'projects' })).topic, 'projects');
    const catalog = await call('workroom_control_catalog');
    assert.equal(status.contractVersion, 1);
    assert.equal(status.schemaHash, catalog.schemaHash);
    const appFailure = await page.evaluate(() => window.workroom.call('createPortfolio', {}));
    const mcpFailure = await client.callTool({ name: 'workroom_control_execute', arguments: { command: 'core.createPortfolio', args: {}, requestId: randomUUID() } });
    assert.equal(appFailure.ok, false);
    assert.equal(mcpFailure.isError, true);
    const wireFailure = JSON.parse(mcpFailure.content[0].text);
    for (const field of ['code', 'phase', 'effectMayHaveOccurred']) assert.deepEqual(appFailure[field], wireFailure[field]);
    assert.equal(wireFailure.code, 'INVALID_INPUT');
    assert.equal(wireFailure.recovery.automaticRetry, false);
    const duplicateConnection = await call('workroom_control_connect', { start: true });
    assert.equal(duplicateConnection.instanceId, status.instanceId);
    const product = (await run('core.createProduct', { name: 'Controlled from Codex', folder }, true)).result;
    const managed = (await run('core.updateProjectStatus', { id: product.id, revision: product.revision, lead: 'Fixture owner', targetDate: '2026-10-01', phase: 'active', health: 'on_track', summary: 'Reviewing a local addition', risks: '', nextStep: 'Run the addition check' })).result;
    const milestone = (await run('core.saveMilestone', { productId: product.id, title: 'Addition check', assignee: 'Fixture owner', targetDate: '2026-10-01', status: 'in_progress', note: '', taskIds: [] })).result;
    const report = (await run('core.projectReport', { productId: product.id, language: 'en', days: 7 })).result;
    assert.match(report.markdown, /Addition check/);
    assert(report.sourceVersions.some((v) => v.id === milestone.id));
    const reportFile = path.join(directory, 'mcp-report.html');
    fs.writeFileSync(reportFile, report.html);
    assert.equal(fs.readFileSync(reportFile, 'utf8'), report.html);
    Object.assign(product, managed);
    // Stub only the OS clipboard boundary, preserving the generated settings and IPC route.
    await app.evaluate(({ clipboard }) => { clipboard.writeText = (text) => { globalThis.copiedMcpConfig = text; }; });
    const configuration = await page.evaluate(() => window.workroom.connectionInfo('copy'));
    assert.equal(configuration.ok, true);
    const copiedConfig = JSON.parse(await app.evaluate(() => globalThis.copiedMcpConfig));
    assert.deepEqual(copiedConfig, configuration.value.config);
    assert.equal(copiedConfig.mcpServers.workroom.env.WORKROOM_DATA_DIR, directory);
    await page.getByRole('heading', { name: product.name, exact: true }).waitFor();
    const task = (await run('external.submit', { productId: product.id, productRevision: product.revision, goal: 'MCP reviewed addition', source: 'Codex fixture', limitations: 'Local test', testFiles: ['math.test.mjs'], allowTests: true, files: [{ path: 'math.mjs', beforeHash: createHash('sha256').update(original).digest('hex'), content: fixed }] }, true)).result;
    assert.equal(task.status, 'awaiting_review');
    assert.equal(task.outputs.check.result.status, 'passed');
    await page.locator(`[data-action="task:${task.id}"]`).first().click();
    const applied = (await run('runtime.applyChange', { id: task.id, revision: task.revision, artifactHash: task.outputs.check.result.artifactHash }, true)).result;
    assert(applied.appliedAt);
    await page.locator('.control-reviews').getByText('Reviewed fixture', { exact: true }).waitFor();
    assert.equal(fs.readFileSync(path.join(folder, 'math.mjs'), 'utf8'), fixed);
    assert.equal((await call('workroom_control_connect')).runtime.modelId, null);
    const p = (await run('core.createPortfolio', { target: 'Remote target' })).result;
    const save = await run('core.savePortfolio', { id: p.id, revision: p.revision, intro: 'MCP draft', requirements: 'Focus', entries: [] });
    assert.equal((await page.evaluate(async () => (await window.workroom.call('snapshot')).value)).portfolios[0].intro, 'MCP draft');
    await run('settings.language', { language: 'en' });
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    // Native controls and MCP must operate on the same current portfolio and dirty-input guard.
    await page.locator('[data-action="open-portfolio"]').click();
    await page.locator('[data-action="edit-portfolio"]').click();
    await page.locator('#folio-intro').fill('Unsaved in app');
    await run('core.savePortfolio', { id: p.id, revision: save.result.revision, intro: 'Updated remotely', requirements: 'Focus', entries: [] });
    await page.locator('.sync-notice').filter({ hasText: 'New records' }).waitFor();
    assert.equal(await page.locator('#folio-intro').inputValue(), 'Unsaved in app');
    await page.locator('[data-action="discard-draft"]').click();
    const operationId = save.requestId;
    await app.close(); app = null;
    assert.equal((await call('workroom_control_connect')).liveConnection, false);
    app = await _electron.launch({ executablePath: require('electron'), args: [root, '--workroom-service'], env });
    page = await app.firstWindow();
    await page.waitForFunction(() => !!window.workroom);
    assert.notEqual((await call('workroom_control_connect')).instanceId, status.instanceId);
    assert.equal((await call('workroom_control_operation', { requestId: operationId })).status, 'completed');
    await app.close(); app = null;
    const started = await call('workroom_control_connect', { start: true });
    assert.equal(started.liveConnection, true);
    ownedServicePid = JSON.parse(fs.readFileSync(path.join(directory, 'auth.control.json'), 'utf8')).pid;
    assert.equal((await call('workroom_control_operation', { requestId: operationId })).status, 'completed');
    assert.deepEqual(errors, []);
    console.log('MCP → actual Electron: same executor, product creation, portfolio editing, language sync, dirty input preservation, offline detection and durable results passed');
  } finally {
    if (app) await app.close();
    await client.close();
    if (ownedServicePid) {
      // This PID came only from this test's newly created, isolated profile.
      try {
        if (process.platform === 'win32')
          execFileSync('taskkill.exe', ['/PID', String(ownedServicePid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else process.kill(-ownedServicePid);
      } catch (error) {
        try { process.kill(ownedServicePid, 0); throw error; } catch (state) {
          if (state.code !== 'ESRCH') throw state;
        }
      }
      for (let n = 0; n < 50; n++) {
        try { process.kill(ownedServicePid, 0); } catch { break; }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
