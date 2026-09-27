import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(root, 'work');
const helper = path.join(root, 'scripts/checks/lib/fixture.cjs');

function run(t, code, keep = '0') {
  const child = spawnSync(
    process.execPath,
    ['-e', `const { createFixture } = require(${JSON.stringify(helper)}); ${code}`],
    { cwd: root, encoding: 'utf8', env: { ...process.env, WORKROOM_KEEP_FIXTURES: keep } },
  );
  const directory = child.stdout.trim();
  if (directory) {
    assert.equal(path.dirname(directory), work);
    assert.match(path.basename(directory), /^fixture-test-[a-zA-Z0-9]{6}$/);
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  }
  return { child, directory };
}

const create = `const directory = createFixture(${JSON.stringify(path.join(work, 'fixture-test-'))}); console.log(directory);`;

test('successful checks remove their own profile, while failure and explicit retention preserve it', (t) => {
  for (const [exit, keep, exists] of [
    [0, '0', false],
    [1, '0', true],
    [0, '1', true],
  ]) {
    const { child, directory } = run(t, `${create} process.exitCode = ${exit};`, keep);
    assert.equal(child.status, exit, child.stderr);
    assert.equal(fs.existsSync(directory), exists);
  }
});

test('fixture creation rejects paths outside the direct work directory', (t) => {
  for (const prefix of [path.join(root, 'user-profile-'), path.join(work, 'nested/test-')]) {
    const { child } = run(t, `createFixture(${JSON.stringify(prefix)});`);
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /directly inside/);
    assert.equal(fs.existsSync(prefix), false);
  }
});

test('cleanup unlinks a nested junction without deleting its external target', (t) => {
  fs.mkdirSync(work, { recursive: true });
  const target = fs.mkdtempSync(path.join(work, 'fixture-target-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.writeFileSync(path.join(target, 'keep.txt'), 'keep');
  const { child, directory } = run(
    t,
    `${create}
    require('node:fs').symlinkSync(${JSON.stringify(target)}, require('node:path').join(directory, 'link'), 'junction');`,
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(fs.existsSync(directory), false);
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep');
});
