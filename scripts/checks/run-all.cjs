// Runs every example-data Electron check in sequence and reports pass/fail.
// check-live-operations needs a real account session and is excluded.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const checks = fs
  .readdirSync(__dirname)
  .filter((f) => /^check-.*\.cjs$/.test(f) && f !== 'check-live-operations.cjs')
  .sort();
const failed = [];
for (const file of checks) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    timeout: 300000,
  });
  const ok = result.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${file} ${Math.round((Date.now() - started) / 1000)}s`);
  if (!ok) {
    failed.push(file);
    console.log(`${result.stderr || ''}${result.stdout || ''}`.trim().split('\n').slice(-8).join('\n'));
  }
}
if (failed.length) {
  console.log(`${failed.length}/${checks.length} failed: ${failed.join(', ')}`);
  process.exitCode = 1;
} else console.log(`All ${checks.length} checks passed.`);
