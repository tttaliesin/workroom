// Isolated real-renderer checks for empty and long-content project layouts.
const { createFixture } = require('./lib/fixture.cjs');
const { _electron } = require('./lib/playwright.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
(async () => {
  const directory = createFixture(path.join(root, 'work/design-layout-'));
  const output = path.join(root, 'outputs/design-layout');
  fs.mkdirSync(output, { recursive: true });
  const env = {
    ...process.env,
    WORKROOM_DATA_DIR: directory,
    WORKROOM_HEADLESS: '1',
    WORKROOM_NODE: process.execPath,
    WORKROOM_SEMANTIC_SEARCH: '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require('electron'), args: [root], env });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('.appbar').waitFor();
    const click = (action) => page.locator(`[data-action="${action}"]`).first().click();
    const capture = async (name) => {
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(output, name + '.png'), scale: 'css' });
    };
    await page.waitForFunction(
      async () => (await window.workroom.call('snapshot')).value.runtime.state !== 'starting',
      null,
      { timeout: 60000 },
    );
    await click('refresh');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(760, 600),
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    await click('nav:dashboard');
    assert.equal(await page.locator('.pm-project-table').count(), 0);
    await capture('empty-dark-760');
    const names = [
      '제품 현황과 고객 피드백을 연결하는 프로젝트 관리 도구 — 긴 한국어 제목 확인',
      'A workspace for release readiness, customer feedback and evidence across distributed product teams',
      'Workroom 디자인 검토 / Design review',
    ];
    for (const [index, name] of names.entries()) {
      const folder = path.join(directory, `product-${index}`);
      fs.mkdirSync(folder);
      const result = await page.evaluate(
        async (args) => window.workroom.call('createProduct', args),
        {
          name,
          folder,
          goal: '다음 단계와 근거가 긴 제목에서도 사라지지 않는지 확인합니다. Long content remains readable without hiding the available actions.',
        },
      );
      assert(result.ok, JSON.stringify(result));
      await click('refresh');
      await click('nav:dashboard');
      assert.equal(await page.locator('.pm-project-table tbody tr').count(), index + 1);
      assert(!/0\s*\/\s*0/.test(await page.locator('.pm-directory').innerText()));
      await capture(`projects-${index + 1}-dark-760`);
    }
    const contrast = [];
    for (const language of ['ko', 'en']) {
      await page.evaluate((language) => window.workroom.language(language), language);
      await click('refresh');
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        for (const [width, height] of [
          [1440, 900],
          [1280, 800],
          [900, 700],
          [760, 600],
        ]) {
          await app.evaluate(
            ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h),
            [width, height],
          );
          await click('nav:dashboard');
          for (const selector of ['.main', '.workspace-toolbar']) {
            assert.equal(
              await page.locator(selector).evaluate((el) => el.scrollWidth > el.clientWidth),
              false,
              `${selector} ${width} ${language}`,
            );
          }
          assert.equal(await page.locator('.sidebar [aria-current="page"]').count(), 1);
          await capture(`long-${language}-${colorScheme}-${width}`);
        }
        // Text, secondary information and primary-button labels use measurable contrast.
        contrast.push(
          await page.evaluate(() => {
            const rgb = (value) =>
              value
                .match(/[\d.]+/g)
                .slice(0, 3)
                .map(Number);
            const luminance = (color) =>
              rgb(color)
                .map((v) => {
                  const s = v / 255;
                  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
                })
                .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
            const ratio = (a, b) =>
              (Math.max(luminance(a), luminance(b)) + 0.05) /
              (Math.min(luminance(a), luminance(b)) + 0.05);
            const main = getComputedStyle(document.querySelector('.main'));
            const surface = getComputedStyle(document.documentElement).backgroundColor;
            const muted = getComputedStyle(document.querySelector('.pm-project-table small'));
            const button = getComputedStyle(document.querySelector('.pm-heading .primary'));
            return {
              text: ratio(main.color, surface),
              secondary: ratio(muted.color, surface),
              button: ratio(button.color, button.backgroundColor),
            };
          }),
        );
        await page.keyboard.press('Tab');
        await page.locator('.pm-heading .primary').focus();
        assert(
          await page
            .locator('.pm-heading .primary')
            .evaluate(
              (el) =>
                el.matches(':focus-visible') && parseFloat(getComputedStyle(el).outlineWidth) >= 2,
            ),
        );
        await capture(`focus-${language}-${colorScheme}`);
      }
    }
    for (const values of contrast)
      for (const [role, value] of Object.entries(values))
        assert(value >= 4.5, `${role} contrast ${value}`);
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'review-data.json'),
      JSON.stringify({ contrast, errors }, null, 2),
    );
    console.log(
      JSON.stringify({
        result: 'passed',
        scope:
          'empty/single/multiple projects, long Korean/English titles, viewport matrix, keyboard focus, text contrast',
        output,
        contrast,
      }),
    );
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
