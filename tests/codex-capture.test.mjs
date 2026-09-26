import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Workroom } from '../src/core/service.mjs';
import { projectRoot } from '../src/core/paths.mjs';
import { captureCodexEvent } from '../src/integrations/codex-capture.mjs';
import { prepareCodexSetup, installCodexSetup } from '../src/integrations/codex-setup.mjs';

async function fixture(t) {
  const dir = mkdtempSync(path.join(projectRoot, 'work/capture-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const folder = path.join(dir, '한글 프로젝트');
  mkdirSync(folder);
  const database = path.join(dir, 'workroom.sqlite');
  const room = new Workroom(database);
  const product = await room.createProduct({ name: '수집 검증', folder });
  const runtime = {
    database,
    node: process.execPath,
    script: path.join(projectRoot, 'src/integrations/codex-hook.mjs'),
  };
  const base = { session_id: 'test-session', turn_id: 'turn-1', cwd: folder };
  return { dir, folder, room, product, runtime, base };
}
const patchEvent = (base) => ({
  ...base,
  hook_event_name: 'PostToolUse',
  tool_name: 'apply_patch',
  tool_use_id: 'patch-1',
  tool_input: {
    command: '*** Begin Patch\n*** Add File: src/입력.js\n+// test fixture\n*** End Patch',
  },
  tool_response: {},
});
const stopEvent = (base) => ({
  ...base,
  hook_event_name: 'Stop',
  last_assistant_message: '입력 보존을 구현했습니다.\n이것은 수집기 검증용 응답입니다.',
});

test('capture requires opt-in and scoped activity; chat, outside cwd, and interrupted turns do not become work', async (t) => {
  const { room, product, base, dir } = await fixture(t);
  try {
    assert.equal(captureCodexEvent(room, product.id, patchEvent(base)).status, 'disabled');
    room.setCodexCapture({ productId: product.id, enabled: true });
    assert.equal(captureCodexEvent(room, product.id, stopEvent(base)).status, 'ignored');
    assert.equal(
      captureCodexEvent(room, product.id, patchEvent({ ...base, cwd: dir })).status,
      'outside-product',
    );
    assert.equal(
      captureCodexEvent(room, product.id, {
        ...patchEvent(base),
        tool_name: 'Bash',
        tool_input: { command: 'echo node --test' },
      }).status,
      'ignored',
    );
    captureCodexEvent(room, product.id, patchEvent(base));
    captureCodexEvent(room, product.id, { ...base, hook_event_name: 'Interrupt' });
    assert.equal(captureCodexEvent(room, product.id, stopEvent(base)).status, 'ignored');
    assert.equal(room.snapshot().tasks.length, 0);
  } finally {
    room.close();
  }
});

test('collected turns retain evidence, deduplicate replay, update versions, and reach subscribed drafts', async (t) => {
  const { room, product, base } = await fixture(t);
  try {
    room.setCodexCapture({ productId: product.id, enabled: true });
    room.createPortfolio({ target: '초안', autoProductIds: [product.id] });
    captureCodexEvent(room, product.id, patchEvent(base));
    captureCodexEvent(room, product.id, {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'test-1',
      tool_input: { command: 'node --test tests/*.test.mjs' },
      tool_response: { exit_code: 0, output: 'PRIVATE_TOOL_OUTPUT' },
    });
    captureCodexEvent(room, product.id, {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'test-2',
      tool_input: { command: 'pnpm test' },
      tool_response: { output: 'running' },
    });
    const result = captureCodexEvent(room, product.id, {
      ...stopEvent(base),
      transcript_path: 'UNREAD_TRANSCRIPT',
      prompt: 'UNREAD_USER_PROMPT',
    });
    assert.equal(result.status, 'collected');
    const before = room.snapshot();
    assert.equal(before.tasks.length, 1);
    assert.equal(before.portfolios[0].entries.length, 1);
    assert.equal(before.tasks[0].actor, 'codex-hook');
    assert.equal(before.tasks[0].verification, 'reported');
    assert.equal(before.tasks[0].checks[0].result, 'passed');
    assert.equal(before.tasks[0].checks[1].result, 'unconfirmed');
    assert.equal(before.tasks[0].changedFiles[0].path, 'src/입력.js');
    assert.ok(!JSON.stringify(room.store.list('capture')).includes('PRIVATE_TOOL_OUTPUT'));
    assert.ok(!JSON.stringify(before).includes('UNREAD_USER_PROMPT'));
    assert.ok(!JSON.stringify(before).includes('UNREAD_TRANSCRIPT'));
    assert.equal(captureCodexEvent(room, product.id, stopEvent(base)).status, 'duplicate');
    assert.deepEqual(room.snapshot(), before);
    const updated = captureCodexEvent(room, product.id, {
      ...stopEvent(base),
      last_assistant_message: '검사를 보완했습니다.',
    });
    assert.equal(updated.taskId, result.taskId);
    assert.equal(room.snapshot().tasks[0].sourceVersion, 2);
    room.setCodexCapture({ productId: product.id, enabled: false });
    assert.equal(
      captureCodexEvent(room, product.id, patchEvent({ ...base, turn_id: 'new' })).status,
      'disabled',
    );
  } finally {
    room.close();
  }
});

test('setup preserves unrelated hooks, backs up the original, detects changes, and never edits global config', async (t) => {
  const { room, product, folder, runtime } = await fixture(t);
  try {
    const codex = path.join(folder, '.codex');
    mkdirSync(codex);
    const filename = path.join(codex, 'hooks.json');
    const original = {
      description: '기존 설정',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo original' }] }] },
    };
    writeFileSync(filename, JSON.stringify(original));
    const plan = await prepareCodexSetup(room, product.id, runtime);
    assert.equal(plan.config.hooks.Stop[0].hooks[0].command, 'echo original');
    assert.ok(!plan.config.hooks.PermissionRequest);
    assert.ok(!plan.config.hooks.PreToolUse);
    writeFileSync(filename, JSON.stringify({ ...original, description: 'concurrent change' }));
    await assert.rejects(installCodexSetup(room, product.id, plan.revision, runtime), /바꿨습니다/);
    const latest = await prepareCodexSetup(room, product.id, runtime);
    const installed = await installCodexSetup(room, product.id, latest.revision, runtime);
    assert.ok(existsSync(installed.backup));
    assert.equal(installed.state, 'awaiting-trust');
    assert.equal(
      JSON.parse(readFileSync(installed.backup, 'utf8')).description,
      'concurrent change',
    );
    const again = await prepareCodexSetup(room, product.id, runtime);
    assert.equal(again.config.hooks.Stop.length, 2);
    assert.equal(again.config.hooks.PostToolUse.length, 1);
    assert.equal(room.store.get('product', product.id).codexCaptureEnabled, true);
    writeFileSync(filename, '{broken');
    await assert.rejects(prepareCodexSetup(room, product.id, runtime), /덮어쓰지/);
    assert.equal(readFileSync(filename, 'utf8'), '{broken');
  } finally {
    room.close();
  }
});

test(
  'generated Windows command accepts UTF-8 hook JSON through stdin and works without the desktop app',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { room, product, runtime, base } = await fixture(t);
    try {
      const plan = await prepareCodexSetup(room, product.id, runtime);
      await installCodexSetup(room, product.id, plan.revision, runtime);
      const handler = plan.config.hooks.Stop[0].hooks[0];
      const encoded = handler.commandWindows.split(' ').at(-1);
      const run = (event) =>
        JSON.parse(
          execFileSync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
            { input: JSON.stringify(event), encoding: 'utf8', windowsHide: true, timeout: 15000 },
          ),
        );
      assert.deepEqual(run(patchEvent(base)), {});
      assert.deepEqual(run(stopEvent(base)), {});
      assert.equal(room.snapshot().tasks.length, 1);
      assert.match(room.snapshot().tasks[0].evidence, /입력 보존/);
      assert.deepEqual(run(stopEvent(base)), {});
      assert.equal(room.snapshot().tasks.length, 1);
      const invalid = run({ ...stopEvent(base), turn_id: '' });
      assert.ok(invalid.systemMessage);
      assert.ok(!invalid.decision);
      assert.ok(!invalid.continue);
    } finally {
      room.close();
    }
  },
);
