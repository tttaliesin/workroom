const { createFixture } = require('./lib/fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('./lib/playwright.cjs');
(async () => {
  const root = path.resolve(__dirname, '../..');
  const directory = createFixture(path.join(root, 'work/quality-ui-'));
  const folder = path.join(directory, 'product');
  fs.mkdirSync(folder);
  const { Workroom } = await import('../../src/core/service.mjs');
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  const product = await room.createProduct({
    name: 'Quality fixture',
    folder,
    goal: 'Verify workflow',
  });
  const stopped = room.store.create('task', {
    productId: product.id,
    productRevision: product.revision,
    title: 'Stopped investigation',
    goal: 'Review after decision',
    kind: 'agent',
    mode: 'investigation',
    status: 'stopped',
    stage: 'investigate',
    outputs: {},
    activeRunId: null,
  });
  const source = room.reportWork({
    productId: product.id,
    title: 'Public case',
    summary: 'Public summary',
    evidence: 'PRIVATE note',
    limitations: 'PRIVATE note',
    contribution: 'Public contribution',
  });
  let p = room.createPortfolio({ target: 'Fixture team' });
  p = room.savePortfolio({
    id: p.id,
    revision: p.revision,
    intro: 'Public intro',
    requirements: '',
    entries: [
      {
        taskId: source.id,
        title: source.title,
        description: source.summary,
        contribution: source.contribution,
      },
    ],
  });
  room.close();
  const env = {
    ...process.env,
    WORKROOM_DATA_DIR: directory,
    WORKROOM_HEADLESS: '1',
    WORKROOM_NODE: process.execPath,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require('electron'), args: [root], env });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.getByRole('heading', { name: product.name, exact: true }).waitFor();
    const click = (action) =>
      page
        .locator(`[data-action="${action}"]`)
        .first()
        .evaluate((el) => el.click());
    await click('nav:ops');
    await click('nav:new-decision');
    const decisionForm = page.locator('form[data-form="new-decision"]');
    await decisionForm.locator('[name="targetTaskId"]').selectOption(stopped.id);
    for (const [name, value] of Object.entries({
      title: 'Direction',
      reason: 'Pick a scope',
      label1: 'Proceed',
      label2: 'Alternative',
      effect1: 'Read source',
      effect2: 'Read another source',
    }))
      await decisionForm.locator(`[name="${name}"]`).fill(value);
    await decisionForm.locator('button[type="submit"]').click();
    await page.locator('form[data-form="decision"] input[value="0"]').check();
    await page.locator('form[data-form="decision"] button[type="submit"]').click();
    await page
      .getByText('답변을 저장하고 연결된 작업의 재개를 예약했습니다.', { exact: true })
      .first()
      .waitFor();
    const target = await page.evaluate(
      async (id) => (await window.workroom.call('snapshot')).value.tasks.find((t) => t.id === id),
      stopped.id,
    );
    assert.equal(target.decisionAnswer.label, 'Proceed');
    assert(['queued', 'waiting_auth'].includes(target.status));
    await click('nav:scope');
    const profile = page.locator('form[data-form="verification-profile"]');
    await profile.locator('[name="enabled"]').check();
    await profile.locator('[name="scripts"]').fill('test\nbuild');
    await profile.locator('[name="allowExecution"]').check();
    await profile.locator('button[type="submit"]').click();
    await page.waitForFunction(
      async () =>
        (await window.workroom.call('snapshot')).value.verificationProfiles[0]?.version === 1,
    );
    assert.equal(await page.locator('form[data-form="background-mode"]').count(), 0);
    await click('nav:settings');
    const background = page.locator('form[data-form="background-mode"]');
    await background.locator('[name="background"]').check();
    await background.locator('button').click();
    await page.waitForFunction(
      async () => (await window.workroom.call('snapshot')).value.runtime.background,
    );
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1,
    );
    await page.evaluate(() => window.workroom.runtime('configure', { background: false }));
    await click('open-portfolio');
    await page.getByRole('heading', { name: '포트폴리오 초안', exact: true }).waitFor();
    await click('portfolio-section:sources');
    const job = page.locator('form[data-form="job-source"]');
    await job.locator('[name="url"]').fill('https://example.com/jobs');
    await job.locator('[name="description"]').fill('Developer tooling experience');
    await job.locator('button').click();
    await page.waitForFunction(
      async () => (await window.workroom.call('snapshot')).value.jobSources.length === 1,
    );
    await click('portfolio-section:publish');
    const destination = page.locator('form[data-form="publication-destination"]');
    await destination.locator('[name="project"]').fill('workroom-fixture');
    await destination.locator('button').click();
    await page.waitForFunction(
      async () =>
        (await window.workroom.call('snapshot')).value.publicationDestinations.length === 1,
    );
    await click(`publication-prepare:${p.id}`);
    await page.getByText('공개 전 검토', { exact: true }).waitFor();
    assert(!(await page.getByText('PRIVATE note', { exact: true }).count()));
    await click('nav:settings');
    await page.locator('#app-language').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await click('open-portfolio');
    await click('portfolio-section:publish');
    await page.getByText('Review before publishing', { exact: true }).waitFor();
    // The Vercel token is app-wide and lives under Settings → Publishing account.
    await click('nav:publish-account');
    assert.equal(
      await page.locator('form[data-form="publication-credentials"] input').getAttribute('type'),
      'password',
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'outputs/quality-publication-dark.png') });
    await click(`product:${product.id}`);
    await click('nav:scope');
    await page.getByRole('heading', { name: 'Project verification environment' }).waitFor();
    assert.equal(
      await page
        .locator('form[data-form="verification-profile"]')
        .evaluate((el) => /[가-힣]/.test(el.innerText)),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      'quality UI: profiles, tray close, job versions, publication review and English passed',
    );
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
