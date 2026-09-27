const { createFixture } = require('./lib/fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('./lib/playwright.cjs');
(async () => {
  const root = path.resolve(__dirname, '../..');
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
  const directory = createFixture(path.join(root, 'work/language-ui-'));
  const folder = path.join(directory, 'product');
  fs.mkdirSync(folder);
  const { Workroom } = await import('../../src/core/service.mjs');
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  const product = await room.createProduct({ name: '기록', folder, goal: '한국어로 작성한 목표' });
  // A previous installation may retain enabled bridge settings. Opening the app
  // must preserve them as inert data without exposing the removed interface.
  const legacy = [
    [
      'jev-connection',
      {
        productId: product.id,
        enabled: true,
        descriptor: {
          command: path.join(directory, 'removed-provider.exe'),
          args: [],
          cwd: folder,
        },
      },
    ],
    ['jev-origin', {}],
    ['jev-receipt', { productId: product.id, memoryId: 'old-memory', reportRevision: 1 }],
  ].map(([kind, body]) => ({ kind, value: room.store.create(kind, body) }));
  room.addRecord({
    productId: product.id,
    title: '계정 연결',
    content: '보존해야 할 한국어 내용',
    scope: '사용자가 쓴 조건',
    source: '사용자 출처',
  });
  room.createPortfolio({
    target: '사용자 대상',
    requirements: '한국어 강조점',
    autoProductIds: [],
  });
  const decision = room.requestDecision({
    productId: product.id,
    title: '사용자 판단 제목',
    reason: '사용자 판단 이유',
    options: [
      { label: '선택 하나', effect: '첫 효과' },
      { label: '선택 둘', effect: '둘째 효과' },
    ],
  });
  room.close();
  const env = {
    ...process.env,
    WORKROOM_DATA_DIR: directory,
    WORKROOM_HEADLESS: '1',
    WORKROOM_SEMANTIC_SEARCH: '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => _electron.launch({ executablePath: require('electron'), args: [root], env });
  let app = await launch();
  const errors = [];
  try {
    let page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(e.message));
    const click = (action) => page.locator(`[data-action="${action}"]`).first().click();
    const language = async (value) => {
      await page.locator('#app-language').selectOption(value);
      await page.waitForFunction((v) => document.documentElement.lang === v, value);
    };
    await page.getByRole('heading', { name: '기록', exact: true }).waitFor();
    const checkIndependent = async () => {
      assert.equal(await page.locator('[data-action="nav:jev"]').count(), 0);
      assert.equal(await page.evaluate(() => typeof window.workroom.jev), 'undefined');
      const snapshot = await page.evaluate(() => window.workroom.call('snapshot'));
      assert.equal(snapshot.ok, true);
      assert.equal('jev' in snapshot.value, false);
    };
    await checkIndependent();
    await language('en');
    const duplicate = await page.evaluate(
      (folder) => window.workroom.call('createProduct', { name: '중복', folder }),
      folder,
    );
    assert.equal(duplicate.ok, false);
    assert.match(duplicate.error, /already registered/);
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async (_window, options) => {
        global.languageDialogTitle = options.title;
        return { canceled: true, filePaths: [] };
      };
    });
    await page.evaluate(() => window.workroom.chooseFolder());
    assert.equal(await app.evaluate(() => global.languageDialogTitle), 'Product folder to manage');
    await page.getByRole('button', { name: 'Assign a task', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '기록', exact: true }).count(), 1);
    await click('nav:records');
    await page.getByRole('heading', { name: 'Records', exact: true }).waitFor();
    assert.match(await page.locator('.record').innerText(), /계정 연결/);
    assert.match(await page.locator('.record').innerText(), /보존해야 할 한국어 내용/);
    await click('nav:new-record');
    await page.locator('#title').fill('계정 연결');
    await page.locator('#content').fill('입력 중인 내용 & <b>그대로</b>');
    await language('ko');
    assert.equal(await page.locator('#content').inputValue(), '입력 중인 내용 & <b>그대로</b>');
    await language('en');
    assert.equal(await page.locator('#title').inputValue(), '계정 연결');
    await click('discard-form');
    for (const [route, heading] of [
      ['scope', 'Product settings'],
      ['product', 'Folder and collection'],
      ['account', 'Built-in agent connection'],
      ['connection', 'Codex connection'],
    ]) {
      await click('nav:' + route);
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    }
    await page.getByText('Other MCP clients · Recent record changes', { exact: true }).click();
    await language('ko');
    await language('en');
    assert.equal(
      await page
        .getByText('Other MCP clients · Recent record changes', { exact: true })
        .evaluate((el) => el.parentElement.open),
      true,
    );
    await click('product:' + product.id);
    await click('task:' + decision.id);
    await page.getByRole('button', { name: 'Save decision', exact: true }).waitFor();
    assert.match(await page.locator('.main').innerText(), /선택 하나/);
    await click('open-portfolio');
    await page.getByRole('heading', { name: 'Portfolio draft', exact: true }).waitFor();
    await page.emulateMedia({ colorScheme: 'dark' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700));
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await click('product:' + product.id);
    fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'outputs/language-en.png') });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.getByRole('button', { name: 'Assign a task', exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await checkIndependent();
    const reopened = new Workroom(path.join(directory, 'workroom.sqlite'));
    try {
      for (const { kind, value } of legacy)
        assert.deepEqual(reopened.store.get(kind, value.id), value);
    } finally {
      reopened.close();
    }
    assert.equal((await page.evaluate(() => window.workroom.language('invalid'))).ok, false);
    await language('ko');
    await page.getByRole('button', { name: '일 맡기기', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      'Language switch, content preservation, dirty forms, expanded sections and restart passed.',
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
