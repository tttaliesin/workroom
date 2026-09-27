import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { verifyProfile, VerificationProfiles } from '../src/runtime/verification-profile.mjs';
import { Store } from '../src/core/store.mjs';
import { runNode } from '../src/runtime/change-checks.mjs';

test('cancellation stops a verification process and its script child', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workroom-process-tree-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    path.join(dir, 'child.mjs'),
    `import {writeFileSync} from 'node:fs';
    writeFileSync('ready.txt', String(process.pid)); setInterval(()=>{},1000);`,
  );
  await writeFile(
    path.join(dir, 'parent.mjs'),
    `import {spawn} from 'node:child_process';
    spawn(process.execPath, ['child.mjs'], {stdio:'inherit'}); setInterval(()=>{},1000);`,
  );
  const controller = new AbortController();
  const result = runNode(process.execPath, ['parent.mjs'], dir, controller.signal);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      await access(path.join(dir, 'ready.txt'));
      ready = true;
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 20));
  }
  assert(ready);
  const childPid = Number(await readFile(path.join(dir, 'ready.txt'), 'utf8'));
  assert(childPid > 0);
  process.kill(childPid, 0);
  controller.abort();
  assert.equal((await result).result, 'cancelled');
  assert.throws(() => process.kill(childPid, 0), /ESRCH/);
});

test('versioned npm profile installs locked dependencies and checks both copies with actual processes', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workroom-profile-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const target of ['baseline', 'candidate']) {
    const root = path.join(dir, target);
    await mkdir(root);
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { test: 'node test.mjs' } }),
    );
    await writeFile(
      path.join(root, 'package-lock.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: { '': { name: 'fixture', version: '1.0.0' } },
      }),
    );
    await writeFile(path.join(root, 'test.mjs'), `process.exit(${target === 'baseline' ? 1 : 0})`);
  }
  const checks = await verifyProfile({
    change: {
      directory: dir,
      baseline: path.join(dir, 'baseline'),
      candidate: path.join(dir, 'candidate'),
      verificationProfile: { enabled: true, version: 2, scripts: ['test'], timeoutSeconds: 30 },
    },
    node: process.execPath,
  });
  assert.equal(checks.length, 4, JSON.stringify(checks));
  assert.equal(
    checks.find((c) => c.target === 'baseline' && c.name.includes('run')).result,
    'failed',
  );
  assert.equal(
    checks.find((c) => c.target === 'candidate' && c.name.includes('run')).result,
    'passed',
  );
});
test('verification consent and changed profile versions invalidate old executions', () => {
  const store = new Store(':memory:');
  try {
    const p = store.create('product', {}),
      profiles = new VerificationProfiles(store);
    const value = {
      productId: p.id,
      version: 0,
      enabled: true,
      scripts: ['test'],
      timeoutSeconds: 30,
      allowExecution: false,
    };
    assert.throws(() => profiles.save(value));
    const saved = profiles.save({ ...value, allowExecution: true });
    profiles.save({ ...value, version: 1, enabled: false });
    assert.throws(() => profiles.assert({ productId: p.id, verificationProfile: saved }));
  } finally {
    store.close();
  }
});
