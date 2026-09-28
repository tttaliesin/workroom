// Unsaved-input protection on a screen with several forms (product settings):
// - a failed save keeps the input protected, and when navigation is refused the discard
//   control is shown next to that form and focused, so the user is never stuck;
// - saving one form neither resets nor unprotects what is being typed in another.
const { createFixture } = require('./lib/fixture.cjs');
const { _electron } = require('./lib/playwright.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const directory = createFixture(path.join(root, 'work/form-protection-'));
  const folder = path.join(directory, 'product');
  fs.mkdirSync(folder);
  const { Workroom } = await import('../../src/core/service.mjs');
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  await room.createProduct({ name: '입력 보호 확인', folder, goal: '저장된 목표' });
  room.close();
  const env = { ...process.env, WORKROOM_DATA_DIR: directory, WORKROOM_HEADLESS: '1', WORKROOM_SEMANTIC_SEARCH: '0', WORKROOM_NODE: process.execPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require('electron'), args: [root], env });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const tab = (name) => page.locator(`nav.product-tabs [data-action="nav:${name}"]`).click();
    const heading = () => page.locator('main h1').first().innerText();
    const inView = (locator) =>
      locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight;
      });
    await page.locator('[data-action^="product:"]').first().click();
    await tab('scope');
    const settings = await heading();

    // 1. A failed save at the bottom of the page must not trap the user.
    const profile = page.locator('form[data-form="verification-profile"]');
    await profile.locator('input[type="checkbox"]').first().check();
    await profile.locator('button[type="submit"]').click();
    await page.locator('.notice.error').first().waitFor();
    await tab('home');
    assert.equal(await heading(), settings, 'navigation is refused while the input is unsaved');
    const notice = page.locator('form[data-form="verification-profile"]').locator('xpath=preceding-sibling::*[1]');
    assert.match(await notice.innerText(), /저장하지 않은 입력/);
    const discard = notice.getByRole('button');
    assert.ok(await inView(discard), 'the discard control is on screen');
    assert.ok(await discard.evaluate((el) => el === document.activeElement), 'and receives focus');
    assert.equal(await page.locator('form[data-form="goal"]').locator('xpath=preceding-sibling::*[1]').innerText().then((t) => /저장하지 않은/.test(t)), false, 'no notice above an untouched form');
    await discard.click();
    await tab('home');
    assert.notEqual(await heading(), settings, 'navigation works after discarding');

    // 2. Saving one form keeps the edits in another form and keeps them protected.
    await tab('scope');
    const goal = page.getByLabel('이 제품에서 이루고 싶은 것');
    await goal.fill('아직 저장하지 않은 목표');
    const policy = page.locator('form[data-form="operation-policy"]');
    await policy.locator('button[type="submit"]').click();
    await page.getByText('운영 범위를 저장했습니다', { exact: false }).first().waitFor();
    assert.equal(await goal.inputValue(), '아직 저장하지 않은 목표', 'the other form keeps its typed value');
    await tab('home');
    assert.equal(await heading(), settings, 'the other form is still protected');
    await page.locator('form[data-form="goal"]').locator('button[type="submit"]').click();
    await page.getByText('현재 목표를 저장했습니다', { exact: false }).first().waitFor();
    await tab('home');
    assert.notEqual(await heading(), settings, 'navigation works once every form is saved');

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ directory, checks: ['failed save shows and focuses discard beside its form', 'discard releases navigation', 'saving one form keeps another form typed value and protection'], errors }));
  } catch (error) {
    // Report the failed check before closing, which may raise its own errors.
    console.error(error);
    process.exitCode = 1;
  } finally {
    // A failed assertion can leave input unsaved; answer the close prompt so the app exits.
    await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
