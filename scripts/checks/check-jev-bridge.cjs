const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('./lib/playwright.cjs');
(async () => {
  const root = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(root, 'work/jev-ui-'));
  const productFolder = path.join(directory, 'product');
  fs.mkdirSync(productFolder);
  const descriptor = {
    contract: 'workroom-jev/1',
    command: process.execPath,
    args: [path.join(root, 'tests/fixtures/jev-server.mjs'), path.join(directory, 'memories.json')],
    cwd: productFolder,
  };
  const descriptorFile = path.join(directory, 'jev.json');
  fs.writeFileSync(descriptorFile, JSON.stringify(descriptor));
  const { Workroom } = await import('../../src/core/service.mjs');
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  const product = await room.createProduct({ name: '연동 예제 제품', folder: productFolder });
  const task = room.reportWork({
    productId: product.id,
    title: '입력 복원 개선',
    summary: '화면을 이동해도 작성 중인 입력을 보존했습니다.',
    evidence: 'PRIVATE_EVIDENCE',
    contribution: '사용자: 요구사항 결정 · 에이전트: 구현안',
    limitations: '소개용 예제이며 실제 성과가 아닙니다.',
  });
  room.close();
  const env = {
    ...process.env,
    WORKROOM_DATA_DIR: directory,
    WORKROOM_HEADLESS: '1',
    WORKROOM_SEMANTIC_SEARCH: '0',
    WORKROOM_NODE: process.execPath,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => _electron.launch({ executablePath: require('electron'), args: [root], env });
  let app = await launch();
  const errors = [];
  try {
    let page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    const click = (action) => page.locator(`[data-action="${action}"]`).first().click();
    await click('nav:jev');
    await page.getByRole('heading', { name: 'Jev 기억 연결', exact: true }).waitFor();
    assert.equal(await page.locator('form[data-form="jev-search"]').count(), 0);
    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, descriptorFile);
    await click('jev-select');
    await page.getByText(descriptor.command, { exact: true }).waitFor();
    assert.equal(fs.existsSync(descriptor.args[1]), false);
    await click('jev-connect');
    await page.locator('form[data-form="jev-prepare"]').waitFor();
    assert.equal(fs.existsSync(descriptor.args[1]), false);
    await page.locator('form[data-form="jev-prepare"] button').click();
    await page.locator('.jev-preview').waitFor();
    assert.doesNotMatch(await page.locator('.jev-preview').innerText(), /PRIVATE_EVIDENCE/);
    await click('jev-publish');
    await page
      .getByText('검토한 결과를 Jev에 보냈습니다. 같은 버전은 중복 저장하지 않습니다.', {
        exact: true,
      })
      .waitFor();
    assert.equal(JSON.parse(fs.readFileSync(descriptor.args[1], 'utf8')).length, 1);
    await page.locator('#jev-query').fill('복원');
    await page.locator('form[data-form="jev-search"] button').click();
    await page.locator('.jev-results .record').waitFor();
    assert.match(await page.locator('.jev-results').innerText(), /화면을 이동해도/);
    await page.locator('#app-language').selectOption('en');
    await page.getByRole('heading', { name: 'Jev memory connection', exact: true }).waitFor();
    assert.match(await page.locator('.jev-results').innerText(), /입력 복원 개선/);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1100, 1000),
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'outputs/jev-connection-en.png') });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    await click('nav:jev');
    await page.getByText('Connection enabled', { exact: true }).waitFor();
    await page.locator('form[data-form="jev-prepare"] button').click();
    await page.locator('.jev-preview').waitFor();
    await page.evaluate(async (task) => {
      const response = await window.workroom.call('reportWork', {
        productId: task.productId,
        externalId: 'correction',
        title: '別の結果',
        summary: 'Another result',
        evidence: 'Private',
        contribution: 'Reported',
        limitations: 'Unverified',
      });
      if (!response.ok) throw new Error(response.error);
    }, task);
    await click('jev-publish');
    await page
      .getByText('Reviewed result sent to Jev. The same revision is not stored twice.', {
        exact: true,
      })
      .waitFor();
    assert.equal(JSON.parse(fs.readFileSync(descriptor.args[1], 'utf8')).length, 1);
    await click('jev-disable');
    await page.getByText('Connection disabled', { exact: true }).waitFor();
    assert.equal(await page.locator('form[data-form="jev-search"]').count(), 0);
    const snapshot = await page.evaluate(() => window.workroom.call('snapshot'));
    assert.equal(snapshot.value.tasks.length, 2);
    assert.equal(snapshot.value.jev.receipts.length, 1);
    await click('product:' + product.id);
    await page.getByRole('button', { name: 'Assign a task', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      'Jev UI: opt-in, descriptor preview, explicit transfer, scoped search, English, restart, replay and disconnect passed.',
    );
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
