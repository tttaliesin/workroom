// Resolve Playwright for the Electron checks: WORKROOM_PLAYWRIGHT, then the project's
// playwright-core, then the Playwright bundled with the Codex desktop runtime.
const path = require('node:path');
const candidates = [
  process.env.WORKROOM_PLAYWRIGHT,
  'playwright-core',
  'playwright',
  process.env.USERPROFILE &&
    path.join(
      process.env.USERPROFILE,
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
].filter(Boolean);
let loaded;
for (const candidate of candidates) {
  try {
    loaded = require(candidate);
    break;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
}
if (!loaded)
  throw new Error(
    'Playwright를 찾지 못했습니다. pnpm install로 playwright-core를 설치하거나 WORKROOM_PLAYWRIGHT에 경로를 지정하세요.',
  );
module.exports = loaded;
