const workDir=require('node:path').resolve(__dirname,'../../work');require('node:fs').mkdirSync(workDir,{recursive:true});
// Visual review with isolated example data; never opens the user's desktop profile.
const { _electron } = require('%USERPROFILE%/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname,'../..');

async function main() {
  const directory = fs.mkdtempSync(path.join(workDir, 'brand-review-'));
  const output = path.resolve(root, process.argv[2] || 'outputs/brand-colors');
  fs.mkdirSync(output, { recursive: true });
  const { Workroom } = await import(pathToFileURL(path.join(root, 'src/core/service.mjs')));
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  const product = await room.createProduct({ name: '입력 도구', folder: directory, goal: '작성 중인 내용을 잃지 않고 입력 흐름을 끝낼 수 있게 합니다.' });
  room.createPortfolio({ target: '개발 도구 팀', requirements: '사용자의 작업 흐름과 데이터 보존을 개선한 경험', autoProductIds: [product.id] });
  room.reportWork({ productId: product.id, title: '초안 복원 경로 정리', summary: '입력 내용의 보관 조건과 화면 전환 후 복원 경로를 정리했습니다.', evidence: '시각 검토를 위한 예제 내용입니다.', limitations: '실제 제품의 성과가 아닌 화면 검토용 자료입니다.', contribution: '사용자: 목표와 반영 결정 · 에이전트: 예제 조사' }, 'mcp');
  const decision = room.requestDecision({ productId: product.id, title: '입력 중 화면 이동을 어떻게 처리할까요?', reason: '입력 유실을 막으면서 사용자의 화면 이동을 방해하지 않는 방침이 필요합니다.', options: [{ label: '초안을 보관하고 이동', effect: '다음에 돌아오면 이어 씁니다.' }, { label: '이동 전에 확인', effect: '사용자에게 현재 입력 처리 여부를 묻습니다.' }] });
  room.close();
  const env = { ...process.env, WORKROOM_DATA_DIR: directory, WORKROOM_HEADLESS: '1', WORKROOM_NODE: process.execPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root], env });
  const errors = [], review = { directory, screenshots: [], colors: {}, errors };
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: product.name, exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 840));
    const click = action => page.locator(`[data-action="${action}"]`).first().evaluate(el => el.click());
    const capture = async name => {
      await page.screenshot({ path: path.join(output, `${name}.png`), scale: 'css' });
      review.screenshots.push(name);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) errors.push(`${name}: horizontal overflow`);
    };
    const inspect = async () => page.evaluate(() => {
      const luminance = color => {
        const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
      };
      const ratio = (a, b) => { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return Number(((values[0] + .05) / (values[1] + .05)).toFixed(2)); };
      const base = getComputedStyle(document.documentElement);
      const sample = selector => {
        const element = document.querySelector(selector), style = getComputedStyle(element);
        let background = style.backgroundColor;
        if (background === 'rgba(0, 0, 0, 0)') background = base.backgroundColor;
        return { foreground: style.color, background, contrast: ratio(style.color, background) };
      };
      const mark = document.querySelector('.app-mark');
      return { brand: base.getPropertyValue('--brand').trim(), primary: sample('button.primary'), selectedProduct: sample('.product-button[aria-current]'), muted: sample('.product-goal .goal-label'), selectedTab: sample('.product-tabs [aria-current]'), markLoaded: mark.complete && mark.naturalWidth > 0 };
    });
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await click('nav:home');
      await page.mouse.move(0, 0);
      review.colors[theme] = await inspect();
      await capture(`overview-${theme}`);
      await page.locator('.delegate-primary').hover();
      review.colors[theme].primaryHover = await page.locator('.delegate-primary').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, foreground: getComputedStyle(el).color }));
      await click('delegate');
      await page.locator('#request-goal').focus();
      review.colors[theme].placeholder = await page.locator('#request-goal').evaluate(el => getComputedStyle(el, '::placeholder').color);
      await capture(`request-${theme}`);
      await click('nav:home');
      await click(`task:${decision.id}`);
      await capture(`task-${theme}`);
    }
    await click('nav:home');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700));
    await capture('overview-dark-narrow');
    await click('delegate');
    await page.locator('#request-goal').focus();
    await capture('request-dark-narrow');
    for (const [theme, colors] of Object.entries(review.colors)) {
      if (!colors.markLoaded) errors.push(`${theme}: app icon failed to load`);
      for (const key of ['primary', 'selectedProduct', 'muted', 'selectedTab']) if (colors[key].contrast < 4.5) errors.push(`${theme}/${key}: insufficient text contrast`);
    }
    fs.writeFileSync(path.join(output, 'review.json'), JSON.stringify(review, null, 2));
    console.log(JSON.stringify(review, null, 2));
    if (errors.length) process.exitCode = 1;
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
