const { createFixture } = require('./lib/fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('./lib/playwright.cjs');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const directory = createFixture(path.join(root, 'work/codex-ui-'));
  const home = path.join(directory, 'codex-home');
  const folder = path.join(directory, 'product');
  fs.mkdirSync(home);
  fs.mkdirSync(folder);
  fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
  const { Workroom } = await import('../../src/core/service.mjs');
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  const product = await room.createProduct({ name: '연결 테스트 제품', folder });
  room.close();
  const env = {
    ...process.env,
    WORKROOM_DATA_DIR: directory,
    CODEX_HOME: home,
    WORKROOM_HEADLESS: '1',
    WORKROOM_NODE: process.execPath,
    WORKROOM_SEMANTIC_SEARCH: '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require('electron'), args: [root], env });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const click = (action) => page.locator(`[data-action="${action}"]`).first().click();
    await click('nav:connection');
    await page.getByRole('heading', { name: 'Codex 연결', exact: true }).waitFor();
    await click('connection-status');
    await page.getByText(/codex-cli/).waitFor({ timeout: 20000 });
    await click('connection-prepare');
    await page.getByRole('heading', { name: '저장할 연결 설정' }).waitFor();
    await click('connection-install');
    await page.getByText('현재 제품에 작업실 MCP 설정이 적용되어 있습니다.').waitFor();
    await click('connection-probe');
    await page.getByText(/서버 응답 · 도구 10개/).waitFor({ timeout: 25000 });
    await click(`codex-prepare:${product.id}`);
    await click(`codex-install:${product.id}`);
    await page.getByText(/수집 설정을 저장했습니다/).waitFor();
    assert(fs.existsSync(path.join(folder, '.codex/hooks.json')));
    await page.locator('.main').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: path.join(root, 'outputs/codex-connection.png') });
    await page.locator('#app-language').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    const newWindow = app.waitForEvent('window');
    await click('connection-terminal');
    const terminal = await newWindow;
    terminal.setDefaultTimeout(20000);
    terminal.on('pageerror', (e) => errors.push(e.message));
    await terminal.locator('#hooks:not([disabled])').waitFor({ timeout: 25000 });
    assert.equal(await terminal.locator('#hooks').innerText(), 'Hook approval (/hooks)');
    assert.match(await terminal.locator('#status').innerText(), /Product folder:/);
    // An isolated, unauthenticated Codex must show onboarding, without any model invocation.
    await terminal.waitForTimeout(2500);
    await terminal.screenshot({ path: path.join(root, 'outputs/codex-terminal.png') });
    await terminal.waitForFunction(() => document.querySelectorAll('.xterm-rows > div').length > 0);
    assert.doesNotMatch(await terminal.locator('.xterm-screen').innerText(), /TERM is set to/);
    await terminal.screenshot({ path: path.join(root, 'outputs/codex-terminal.png') });
    await terminal.locator('#close').click();
    await page.locator('#app-language').selectOption('ko');
    await page.waitForFunction(() => document.documentElement.lang === 'ko');
    await click('connection-status');
    await page.getByText(/작업실 훅 승인 확인 필요/).waitFor();
    assert.deepEqual(errors, []);
    console.log('Codex setup, real MCP probe, hook install and embedded terminal passed.');
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
