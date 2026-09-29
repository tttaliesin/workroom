const { createFixture } = require('./checks/lib/fixture.cjs');
// Capture the real Electron renderer with isolated, illustrative data.
// No account connection, model calls, user data or renderer code changes.
/* global window, document, requestAnimationFrame, innerWidth -- Playwright renderer callbacks */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { _electron } = require('./checks/lib/playwright.cjs');
const root = path.resolve(__dirname, '..');
const language = process.argv.includes('--english') ? 'en' : 'ko';
const englishDemo = {
  '릴리스 보드': 'Release Board',
  '배포 준비와 변경 이력을 한눈에 확인합니다.': 'Track release readiness and changes at a glance.',
  문장노트: 'Sentence Notes',
  '떠오른 생각을 놓치지 않고, 언제든 이어 쓸 수 있는 글쓰기 도구를 만듭니다.':
    'Build a writing tool that captures ideas and lets you pick up where you left off.',
  '프론트엔드 개발': 'Frontend Development',
  '사용자 경험을 세심하게 다듬고, 데이터가 보존되는 흐름을 만든 경험':
    'Crafting thoughtful user experiences and reliable data preservation.',
  '화면을 떠나도 이어 쓰는 초안': 'Drafts that survive navigation',
  '화면을 이동하기 전에 작성 중인 문장을 보관하고, 돌아왔을 때 마지막 편집 위치와 함께 복원하는 흐름을 정리했습니다.':
    'Designed a flow that saves writing before navigation and restores it with the last editing position on return.',
  '중복 저장 없이 이어지는 작업 기록': 'Continuous records without duplicates',
  '같은 결과가 다시 보고되어도 하나의 기록으로 유지하고, 수정된 내용은 이전 버전과 함께 확인하도록 정리했습니다.':
    'Kept repeated reports in one record while preserving earlier versions for comparison.',
  'README 화면 소개를 위한 예제 보고입니다.': 'Illustrative report for README screenshots.',
  '실제 제품의 구현·검사 결과를 나타내지 않는 예제 데이터입니다.':
    'Example data, not actual implementation or test results.',
  '사용자: 목표와 반영 결정 · 에이전트: 조사와 수정안 정리':
    'User: goals and approval · Agent: investigation and proposed changes',
  '사용자의 다음 행동까지 생각하며 만듭니다.': 'Building with the next user action in mind.',
  '작성 중 화면을 이동하면 어떻게 할까요?': 'What should happen when leaving a draft?',
  '입력한 내용을 지키면서도 글쓰기 흐름을 방해하지 않는 방침이 필요합니다.':
    'Choose a policy that protects writing without interrupting the flow.',
  '초안을 보관하고 이동': 'Save the draft and navigate',
  '다음에 돌아오면 마지막 문장부터 이어 씁니다.': 'Continue from the last sentence when returning.',
  '이동하기 전에 확인': 'Ask before navigating',
  '저장할지, 입력을 버릴지 사용자가 직접 선택합니다.':
    'Let the user choose whether to save or discard input.',
  '초안 보관과 복원 흐름 조사': 'Investigate draft saving and restoration',
  '화면 이동 뒤에도 입력이 보존되는 조건을 확인합니다.': 'Check when input survives navigation.',
  '화면 소개용 예제': 'Illustrative example',
  '초안 보관 방침을 선택한 뒤 수정안을 작성합니다.':
    'Choose a draft preservation policy, then prepare changes.',
  '예제 조사 흐름입니다.': 'Example investigation flow.',
  '긴 글에서도 초안 복원이 이어지도록': 'Restore drafts even for long documents',
  '긴 입력의 보관과 복원 조건을 정리합니다.': 'Review saving and restoration for long input.',
  '사용자가 고친 문장을 먼저 지킨다': 'Preserve the user’s wording first',
  '자동으로 도착한 결과는 새 사례로 모읍니다. 이미 직접 고친 소개와 사례 설명은 덮어쓰지 않습니다.':
    'Collect incoming results as new examples. Preserve introductions and descriptions the user has edited.',
  '새 작업 보고가 포트폴리오 초안에 반영될 때': 'When new work reports update a portfolio draft',
  '예제 제품의 편집 방침': 'Example product editing policy',
  '실행기 준비 중': 'Starting runner',
  '포트폴리오 초안': 'Portfolio draft',
};
const demo = (text) => (language === 'en' ? englishDemo[text] || text : text);

(async () => {
  const { Workroom } = await import(pathToFileURL(path.join(root, 'src/core/service.mjs')));
  const work = path.join(root, 'work');
  const output = path.join(root, 'assets/readme', language === 'en' ? 'en' : '');
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  const directory = createFixture(path.join(work, 'readme-capture-'));
  fs.mkdirSync(path.join(directory, 'desktop'));
  fs.writeFileSync(path.join(directory, 'desktop/language.json'), JSON.stringify(language));
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  const createProduct = async (name, slug, goal) => {
    const folder = path.join(directory, slug);
    fs.mkdirSync(folder);
    fs.writeFileSync(
      path.join(folder, 'README.md'),
      `# ${name}\n화면 소개를 위한 예제 제품입니다.\n`,
    );
    return room.createProduct({ name, folder, goal });
  };
  await createProduct(
    demo('릴리스 보드'),
    'release-board',
    demo('배포 준비와 변경 이력을 한눈에 확인합니다.'),
  );
  const product = await createProduct(
    demo('문장노트'),
    'sentence-note',
    demo('떠오른 생각을 놓치지 않고, 언제든 이어 쓸 수 있는 글쓰기 도구를 만듭니다.'),
  );
  const portfolio = room.createPortfolio({
    target: demo('프론트엔드 개발'),
    requirements: demo('사용자 경험을 세심하게 다듬고, 데이터가 보존되는 흐름을 만든 경험'),
    autoProductIds: [product.id],
  });
  const reports = [
    [
      demo('화면을 떠나도 이어 쓰는 초안'),
      demo(
        '화면을 이동하기 전에 작성 중인 문장을 보관하고, 돌아왔을 때 마지막 편집 위치와 함께 복원하는 흐름을 정리했습니다.',
      ),
    ],
    [
      demo('중복 저장 없이 이어지는 작업 기록'),
      demo(
        '같은 결과가 다시 보고되어도 하나의 기록으로 유지하고, 수정된 내용은 이전 버전과 함께 확인하도록 정리했습니다.',
      ),
    ],
  ].map(([title, summary]) =>
    room.reportWork(
      {
        productId: product.id,
        title,
        summary,
        evidence: demo('README 화면 소개를 위한 예제 보고입니다.'),
        limitations: demo('실제 제품의 구현·검사 결과를 나타내지 않는 예제 데이터입니다.'),
        contribution: demo('사용자: 목표와 반영 결정 · 에이전트: 조사와 수정안 정리'),
      },
      'mcp',
    ),
  );
  const draft = room.store.get('portfolio', portfolio.id);
  if (language === 'en') {
    // English fixture reports keep their generated record text in English too.
    for (const report of reports) {
      const record = room.store.list('record').find((item) => item.sourceTaskId === report.id);
      room.store.update('record', record.id, record.revision, {
        ...record,
        content: `${report.summary}\nEvidence: ${report.evidence}\nLimitations: ${report.limitations}`,
        scope: 'Relevant work in this product',
        source: 'Work report from MCP',
      });
    }
  }
  room.savePortfolio({
    id: draft.id,
    revision: draft.revision,
    intro: demo('사용자의 다음 행동까지 생각하며 만듭니다.'),
    requirements: draft.requirements,
    autoProductIds: draft.autoProductIds,
    entries: draft.entries,
  });
  const decision = room.requestDecision({
    productId: product.id,
    title: demo('작성 중 화면을 이동하면 어떻게 할까요?'),
    reason: demo('입력한 내용을 지키면서도 글쓰기 흐름을 방해하지 않는 방침이 필요합니다.'),
    options: [
      {
        label: demo('초안을 보관하고 이동'),
        effect: demo('다음에 돌아오면 마지막 문장부터 이어 씁니다.'),
      },
      {
        label: demo('이동하기 전에 확인'),
        effect: demo('저장할지, 입력을 버릴지 사용자가 직접 선택합니다.'),
      },
    ],
  });
  const investigation = room.store.create('task', {
    kind: 'agent',
    mode: 'investigation',
    productId: product.id,
    title: demo('초안 보관과 복원 흐름 조사'),
    goal: demo('화면 이동 뒤에도 입력이 보존되는 조건을 확인합니다.'),
    status: 'accepted',
    stage: 'knowledge',
    resultTaskId: reports[0].id,
    outputs: {
      investigate: {
        runId: 'demo-investigate',
        result: {
          summary: reports[0].summary,
          findings: [],
          limitations: demo('화면 소개용 예제'),
          nextStep: demo('초안 보관 방침을 선택한 뒤 수정안을 작성합니다.'),
        },
      },
      review: {
        runId: 'demo-review',
        result: {
          verdict: 'supported',
          assessment: demo('예제 조사 흐름입니다.'),
          evidenceIds: [],
          limitations: demo('화면 소개용 예제'),
        },
      },
      knowledge: { runId: 'demo-knowledge', result: { records: [] } },
    },
  });
  const record = room.store.list('record').find((r) => r.sourceTaskId === reports[0].id);
  room.store.create('agent-context', {
    taskId: investigation.id,
    runId: 'demo-context',
    context: { records: [record] },
  });
  room.store.create('task', {
    kind: 'agent',
    mode: 'change',
    productId: product.id,
    productRevision: product.revision,
    title: demo('긴 글에서도 초안 복원이 이어지도록'),
    goal: demo('긴 입력의 보관과 복원 조건을 정리합니다.'),
    status: 'queued',
    stage: 'develop',
    outputs: {},
    testFiles: [],
  });
  room.addRecord({
    productId: product.id,
    title: demo('사용자가 고친 문장을 먼저 지킨다'),
    content: demo(
      '자동으로 도착한 결과는 새 사례로 모읍니다. 이미 직접 고친 소개와 사례 설명은 덮어쓰지 않습니다.',
    ),
    scope: demo('새 작업 보고가 포트폴리오 초안에 반영될 때'),
    source: demo('예제 제품의 편집 방침'),
  });
  room.store.create('runtime-settings', { paused: true, modelId: null });
  room.close();

  const env = {
    ...process.env,
    WORKROOM_DATA_DIR: directory,
    WORKROOM_HEADLESS: '1',
    WORKROOM_SEMANTIC_SEARCH: '0',
    WORKROOM_NODE: process.execPath,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: require('electron'), args: [root], env });
  const errors = [],
    captures = [];
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    page.on('pageerror', (e) => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 900),
    );
    await page.getByRole('heading', { name: product.name, exact: true }).waitFor();
    await page.waitForFunction(
      async () => (await window.workroom.call('snapshot')).value.runtime.state !== 'starting',
    );
    const click = (action) => page.locator(`[data-action="${action}"]`).first().click();
    await click('refresh');
    await page
      .getByRole('button', { name: demo('실행기 준비 중'), exact: true })
      .waitFor({ state: 'hidden' });
    await click('nav:home');
    await page.evaluate(() => document.fonts.ready);
    const capture = async (name) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.mouse.move(0, 0);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({ path: path.join(output, `${name}.png`), scale: 'css' });
      captures.push(name);
    };
    await capture('overview-dark');
    await click(`task:${decision.id}`);
    await page.locator('form[data-form="decision"]').waitFor();
    await capture('decision');
    await click('nav:records');
    await page.locator('.record').first().waitFor();
    await capture('records');
    await click('nav:home');
    await click(`target:${portfolio.id}`);
    await page.getByRole('heading', { name: demo('포트폴리오 초안'), exact: true }).waitFor();
    await capture('portfolio-ai');
    await click('portfolio-section:design');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 1080),
    );
    await page.locator('.template-picker').evaluate((picker) => {
      const main = picker.closest('.main');
      main.scrollTop += picker.getBoundingClientRect().top - main.getBoundingClientRect().top - 24;
    });
    await capture('portfolio');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(work, `readme-capture-${language}.json`),
      JSON.stringify(
        {
          captures,
          viewport: '1280×900; portfolio 1280×1080',
          colorScheme: 'dark',
          language,
          source: 'Actual Electron renderer; illustrative data only; no UI modification.',
          errors,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ directory, output, captures, errors }, null, 2));
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
