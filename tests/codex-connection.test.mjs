import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { CodexConnection } from '../src/integrations/codex-connection.mjs';
import { prepareCodexSetup, installCodexSetup } from '../src/integrations/codex-setup.mjs';
import { Workroom } from '../src/core/service.mjs';
import { projectRoot } from '../src/core/paths.mjs';

test('Codex connection uses official versioned writes, preserves other settings, and verifies the real MCP server', async (t) => {
  const base = path.join(projectRoot, 'work/tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'codex-connection-'));
  const home = path.join(directory, 'codex-home'),
    folder = path.join(directory, '제품 폴더');
  await mkdir(home);
  await mkdir(folder);
  await mkdir(path.join(folder, '.git'));
  let room;
  t.after(async () => {
    room?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const original =
    '# Preserve this comment\nmodel = "test-model"\n[mcp_servers.other]\ncommand = "other-server"\nenabled = false\n' +
    `[projects.${JSON.stringify(folder)}]\ntrust_level = "trusted"\n`;
  const filename = path.join(home, 'config.toml');
  await writeFile(filename, original);
  const connection = new CodexConnection({
    root: projectRoot,
    directory,
    env: {
      ...process.env,
      CODEX_HOME: home,
      WORKROOM_NODE: process.execPath,
      WORKROOM_SEMANTIC_SEARCH: '0',
    },
  });
  const runtime = await connection.detect();
  if (!runtime.codex) {
    t.skip('Installed Codex is needed for the real protocol integration check');
    return;
  }
  room = new Workroom(path.join(directory, 'workroom.sqlite'));
  const product = await room.createProduct({ name: '연결 검증', folder });
  const before = await connection.status(product);
  assert.equal(before.configured, false);
  await assert.rejects(connection.probe(product), /설정/);
  const stale = await connection.prepare(folder);
  await writeFile(filename, original.replace('test-model', 'changed-model'));
  await assert.rejects(connection.install(stale.id), /변경/);
  assert.ok(!(await readFile(filename, 'utf8')).includes('mcp_servers.workroom'));
  const plan = await connection.prepare(folder);
  await assert.rejects(connection.install('wrong-id'), /다시 확인/);
  const installed = await connection.install(plan.id);
  assert.equal(
    await readFile(installed.backup, 'utf8'),
    original.replace('test-model', 'changed-model'),
  );
  const written = await readFile(filename, 'utf8');
  assert.match(written, /Preserve this comment/);
  assert.match(written, /changed-model/);
  assert.match(written, /\[mcp_servers.other\]/);
  assert.match(written, /\[mcp_servers.workroom\]/);
  const checked = await connection.probe(product);
  assert.equal(checked.configured, true);
  assert.ok(checked.probe.toolCount >= 18);
  assert.deepEqual(checked.hooks, []);
  const hookRuntime = {
    database: path.join(directory, 'workroom.sqlite'),
    node: process.execPath,
    script: path.join(projectRoot, 'src/integrations/codex-hook.mjs'),
  };
  const hookPlan = await prepareCodexSetup(room, product.id, hookRuntime);
  await installCodexSetup(room, product.id, hookPlan.revision, hookRuntime);
  const after = await connection.status(product);
  assert.equal(after.hooks.length, 3);
  assert.ok(
    after.hooks.every((h) => h.trust !== 'trusted'),
    'Installing must never silently trust hooks',
  );
  // The official PTY API is used for the in-app Codex screen; no shell or model calls.
  let output = '';
  let exited;
  const exit = new Promise((resolve) => {
    exited = resolve;
  });
  const rpc = await connection.connect(folder, (message) => {
    if (message.method === 'process/outputDelta')
      output += Buffer.from(message.params.deltaBase64, 'base64').toString();
    if (message.method === 'process/exited') exited(message.params.exitCode);
  });
  try {
    await rpc.request('process/spawn', {
      command: [process.execPath, '-e', 'console.log("WORKROOM-PTY-OK")'],
      processHandle: 'check',
      cwd: folder,
      tty: true,
      size: { rows: 24, cols: 100 },
      timeoutMs: 3000,
    });
    assert.equal(await exit, 0);
    assert.match(output, /WORKROOM-PTY-OK/);
  } finally {
    rpc.close();
  }
});
