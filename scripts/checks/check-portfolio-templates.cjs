const { createFixture } = require('./lib/fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { _electron } = require('./lib/playwright.cjs');
(async () => {
  const root = path.resolve(__dirname, '../..');
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
  const directory = createFixture(path.join(root, 'work/templates-ui-'));
  const output = path.join(root, 'outputs/portfolio-templates');
  fs.mkdirSync(output, { recursive: true });
  const { Workroom } = await import('../../src/core/service.mjs');
  const { portfolioHTML } = await import('../../src/core/export.mjs');
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  const product = await room.createProduct({ name: '예제 제품', folder: directory });
  let portfolio = room.createPortfolio({
    target: '프론트엔드 개발',
    requirements: 'PRIVATE_TARGET_REQUIREMENTS',
    autoProductIds: [product.id],
  });
  for (const [title, summary] of [
    [
      '화면을 떠나도 이어 쓰는 초안',
      '화면을 이동하기 전에 작성 중인 문장을 보관하고, 돌아왔을 때 마지막 편집 위치와 함께 복원하는 흐름을 정리했습니다.',
    ],
    [
      '중복 저장 없이 이어지는 작업 기록',
      '같은 결과가 다시 보고되어도 하나의 기록으로 유지하고, 수정된 내용은 이전 버전과 함께 확인하도록 정리했습니다.',
    ],
  ])
    room.reportWork({
      productId: product.id,
      title,
      summary,
      contribution: '사용자: 목표와 반영 결정 · 에이전트: 조사와 수정안 정리',
      evidence: 'PRIVATE_EVIDENCE',
      limitations: 'Illustrative example',
    });
  portfolio = room.snapshot().portfolios[0];
  portfolio = room.savePortfolio({
    id: portfolio.id,
    revision: portfolio.revision,
    intro: '사용자의 다음 행동까지 생각하며 만듭니다.',
    requirements: portfolio.requirements,
    entries: portfolio.entries,
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
    await click('open-portfolio');
    await page.locator('.folio-studio').waitFor();
    await page.locator('#template-editorial').check();
    await page.locator('.folio-editorial').waitFor();
    assert.match(await page.locator('#save-state').innerText(), /저장하지 않은/);
    await click('discard-draft');
    await page.locator('.folio-studio').waitFor();
    await click('edit-portfolio');
    await page.locator('#folio-intro').fill('작성 중인 소개 <b>원문</b>');
    await page.locator('#template-resume').check();
    assert.equal(await page.locator('#folio-intro').inputValue(), '작성 중인 소개 <b>원문</b>');
    assert.match(await page.locator('#folio-preview').innerText(), /작성 중인 소개 <b>원문<\/b>/);
    await page.locator('#folio-intro').fill(portfolio.intro);
    await click('save-portfolio');
    await page.locator('#save-state').filter({ hasText: '로컬 초안 저장됨' }).waitFor();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    await click('open-portfolio');
    await page.locator('.folio-resume').waitFor();
    assert.equal(await page.locator('#template-resume').isChecked(), true);
    await page.locator('#template-studio').check();
    await page.evaluate(async () => {
      const p = (await window.workroom.call('snapshot')).value.portfolios[0];
      const result = await window.workroom.call('savePortfolio', {
        id: p.id,
        revision: p.revision,
        intro: p.intro,
        requirements: p.requirements,
        entries: p.entries,
        templateId: 'editorial',
      });
      if (!result.ok) throw new Error(result.error);
    });
    await click('save-portfolio');
    await page.locator('.conflict-review').waitFor();
    assert.equal(await page.locator('#template-studio').isChecked(), true);
    await click('save-portfolio-overwrite');
    await page.locator('#save-state').filter({ hasText: '로컬 초안 저장됨' }).waitFor();
    await click('nav:settings');
    await page.locator('#app-language').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await click('open-portfolio');
    await page.getByText('Portfolio template', { exact: true }).waitFor();
    const snapshots = {};
    for (const template of ['studio', 'editorial', 'resume']) {
      await page.locator('#template-' + template).check();
      if (await page.locator('[data-action="save-portfolio"]').count())
        await click('save-portfolio');
      await page.locator('#save-state').filter({ hasText: 'Local draft saved' }).waitFor();
      const filename = path.join(output, template + '.html');
      await app.evaluate(({ dialog }, filename) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
      }, filename);
      await click('review-export');
      await page.locator('.dialog .folio-' + template).waitFor();
      await click('export');
      await page.locator('.template-picker').waitFor();
      const exported = fs.readFileSync(filename, 'utf8');
      assert.ok(exported.includes('folio-' + template));
      assert.ok(exported.includes('lang="en"'));
      assert.ok(!exported.includes('PRIVATE_'));
      assert.ok(!exported.includes(directory));
      snapshots[template] = { ...portfolio, templateId: template };
    }
    // Inspect the actual self-contained exports, including narrow and print layouts.
    const requests = [];
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setMinimumSize(0, 0);
      w.setContentSize(1100, 1000);
    });
    for (const template of ['studio', 'editorial', 'resume']) {
      const filename = path.join(output, template + '.html');
      fs.writeFileSync(filename, portfolioHTML(snapshots[template]));
      await page.goto(pathToFileURL(filename).href);
      await page.locator('.folio-' + template).waitFor();
      await page.screenshot({ path: path.join(output, template + '.png'), fullPage: true });
      const long = {
        ...snapshots[template],
        intro: '긴 소개 LongIntroduction'.repeat(100),
        entries: snapshots[template].entries.map((entry) => ({
          ...entry,
          description: 'https://example.test/' + 'a'.repeat(500),
        })),
      };
      fs.writeFileSync(path.join(directory, 'long.html'), portfolioHTML(long));
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(360, 800),
      );
      await page.goto(pathToFileURL(path.join(directory, 'long.html')).href);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        template + ' narrow overflow',
      );
      await page.emulateMedia({ media: 'print' });
      assert.equal(
        await page
          .locator('.folio-document')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        'rgb(255, 255, 255)',
      );
      await page.emulateMedia({ media: 'screen' });
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(1100, 1000),
      );
    }
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    console.log(
      'Three templates: dirty edits, discard, save, restart, bilingual export, private-data exclusion, 360px long content and print passed. Screenshots: ' +
        output,
    );
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
