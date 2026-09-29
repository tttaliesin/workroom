const { createFixture } = require('./lib/fixture.cjs');
const { _electron } = require('./lib/playwright.cjs');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
(async () => {
  const directory = createFixture(path.join(root, 'work/project-management-'));
  const output = path.join(root, 'outputs/project-management');
  fs.mkdirSync(output, { recursive: true });
  const folder = path.join(directory, 'product');
  fs.mkdirSync(folder);
  const { Workroom } = await import(pathToFileURL(path.join(root, 'src/core/service.mjs')));
  const room = new Workroom(path.join(directory, 'workroom.sqlite'));
  const otherFolder = path.join(directory, 'other');
  fs.mkdirSync(otherFolder);
  const other = await room.createProduct({
    name: '팀 지식 검색',
    folder: otherFolder,
    goal: '검증한 자료를 다음 작업에서 다시 활용합니다.',
  });
  room.updateProjectStatus({
    id: other.id,
    revision: other.revision,
    lead: '서연',
    targetDate: '2026-10-15',
    phase: 'planned',
    health: 'on_track',
    summary: '검색 기준과 초기 자료 범위를 합의했습니다.',
    risks: '',
    nextStep: '팀별 예제 자료 수집',
  });
  let product = await room.createProduct({
    name: '고객 피드백 허브',
    folder,
    goal: '고객의 피드백을 제품 개선으로 연결합니다.',
  });
  product = room.updateProjectStatus({
    id: product.id,
    revision: product.revision,
    lead: '민준 · 제품팀',
    targetDate: '2026-10-09',
    phase: 'active',
    health: 'at_risk',
    summary: '피드백 수집과 분류를 마쳤습니다. 이번 주에는 담당자 배정과 알림 흐름을 정리합니다.',
    risks:
      '알림 채널에 대한 운영팀 결정이 필요합니다. 금요일까지 확정하면 일정을 유지할 수 있습니다.',
    nextStep: '운영팀과 알림 정책 합의 → 담당자 배정 화면 구현',
  });
  const report = room.reportWork(
    {
      productId: product.id,
      title: '피드백 분류 기준 정리',
      summary: '유형과 우선순위 기준을 정리했습니다.',
      evidence: '화면 검토를 위한 예제 결과입니다.',
      limitations: '실제 프로젝트 성과가 아닌 데모입니다.',
      contribution: '제품팀: 분류 기준 합의',
    },
    'mcp',
  );
  const item = {
    productId: product.id,
    assignee: '민준',
    targetDate: '2026-10-02',
    status: 'planned',
    note: '',
    taskIds: [],
  };
  room.saveMilestone({
    ...item,
    title: '피드백 수집·분류 기준 확정',
    status: 'done',
    note: '분류 기준 문서 검토 완료 · 화면 예제',
    taskIds: [report.id],
  });
  room.saveMilestone({
    ...item,
    title: '운영팀 알림 정책 합의',
    status: 'blocked',
    targetDate: '2020-09-28',
    note: '운영팀의 채널 선택 대기',
    assignee: '서연',
  });
  room.saveMilestone({
    ...item,
    title: '담당자 배정 화면 구현',
    status: 'in_progress',
    note: '화면 구성 검토 중',
  });
  room.saveMilestone({
    ...item,
    title: '팀 시연과 피드백 반영',
    targetDate: '2026-10-09',
    assignee: '제품팀',
  });
  room.requestDecision({
    productId: product.id,
    title: '알림 채널 확정',
    reason: '운영팀과 합의가 필요합니다.',
    options: [
      { label: '이메일', effect: '이메일 알림 사용' },
      { label: '앱 알림', effect: '앱 알림 사용' },
    ],
  });
  room.store.create('runtime-settings', { paused: false, modelId: null });
  room.close();
  const env = {
    ...process.env,
    WORKROOM_DATA_DIR: directory,
    WORKROOM_HEADLESS: '1',
    WORKROOM_NODE: process.execPath,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await _electron.launch({
    executablePath: require('electron'),
    args: [root],
    env,
  });
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'planning-check', version: '1.0' });
  try {
    await application.evaluate(({ clipboard }) => {
      // Capture the export boundary without touching the user's clipboard.
      clipboard.writeText = (text) => {
        globalThis.planningCopiedText = text;
      };
    });
    const page = await application.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const click = (action) => page.locator(`[data-action="${action}"]`).first().click();
    const capture = async (name) => {
      if (await page.locator('[data-action="dismiss-message"]').count())
        await click('dismiss-message');
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(output, `${name}.png`), scale: 'css' });
    };
    await page.getByRole('heading', { name: product.name, exact: true }).waitFor();
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(root, 'src/mcp/server.mjs')],
        env,
      }),
    );
    const mcp = async (name, args = {}) => {
      const response = await client.callTool({ name, arguments: args });
      assert(!response.isError, JSON.stringify(response));
      return JSON.parse(response.content[0].text);
    };
    const catalog = await mcp('workroom_control_catalog');
    assert(catalog.commands['core.saveMilestone']);
    const requestId = require('node:crypto').randomUUID();
    const command = {
      command: 'core.saveMilestone',
      args: {
        ...item,
        title: 'MCP로 등록한 검토 계획',
        status: 'cancelled',
        note: 'MCP 경로 검증 후 범위 제외',
      },
      requestId,
    };
    await mcp('workroom_control_execute', command);
    let operation;
    for (let i = 0; i < 30; i++) {
      operation = await mcp('workroom_control_operation', { requestId });
      if (operation.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(operation.status, 'completed', JSON.stringify(operation));
    const repeated = await mcp('workroom_control_execute', command);
    assert.equal(repeated.requestId, requestId);
    const milestones = await mcp('workroom_control_read', {
      kind: 'milestone',
      productId: product.id,
    });
    assert(JSON.stringify(milestones).includes(operation.result.id));
    await page.waitForFunction(
      async () => (await window.workroom.call('snapshot')).value.runtime.state !== 'starting',
      null,
      { timeout: 60000 },
    );
    await click('refresh');
    await page
      .getByRole('button', { name: '실행기 준비 중', exact: true })
      .waitFor({ state: 'hidden' });
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => document.fonts.ready);
    assert.match(await page.locator('.pm-properties .pm-progress').innerText(), /1\s*\/\s*4/);
    await capture('overview-dark');
    await click('nav:dashboard');
    assert.equal(await page.locator('.pm-project-table tbody tr').count(), 2);
    await capture('projects-dark');
    await click(`product:${product.id}`);
    await click('nav:plan');
    await page.locator('.pm-editor summary').click();
    await page.locator('#pm-summary').fill('저장 전 입력');
    await click('nav:home');
    assert.equal(await page.locator('#pm-summary').inputValue(), '저장 전 입력');
    await page
      .locator('#pm-summary')
      .fill('분류 기준을 확정했고 담당자 배정 화면을 구현 중입니다.');
    await page.locator('form[data-form="project-status"] button[type="submit"]').click();
    await page.getByText('현황을 저장했습니다.', { exact: true }).waitFor();
    await page.locator('.pm-editor summary').click();
    await page.locator('#pm-summary').fill('취소할 입력');
    await click('planning-cancel:project-status');
    await page.locator('.pm-editor summary').click();
    assert.match(await page.locator('#pm-summary').inputValue(), /분류 기준을 확정/);
    await click('planning-cancel:project-status');
    await click('milestone-new');
    await page.locator('#pm-title').fill('취소할 마일스톤');
    await click('planning-cancel:milestone');
    assert.equal(await page.locator('#pm-title').count(), 0);
    await click('milestone-new');
    await page.locator('#pm-title').fill('접근성 검토');
    await page.locator('#pm-assignee').fill('지수');
    await page.locator('#pm-status').selectOption('done');
    await page.locator(`input[name="taskIds"][value="${report.id}"]`).check();
    await page.locator('form[data-form="milestone"] button[type="submit"]').click();
    await page.getByText('완료 근거나 막힌 이유를 메모에 작성하세요.', { exact: true }).waitFor();
    assert(await page.locator(`input[name="taskIds"][value="${report.id}"]`).isChecked());
    await page
      .locator('#pm-note')
      .fill('키보드 이동과 화면 낭독 순서를 검토했습니다. 데모 근거입니다.');
    await page.locator('form[data-form="milestone"] button[type="submit"]').click();
    await page.getByText('마일스톤을 저장했습니다.', { exact: true }).waitFor();
    assert.equal(await page.locator('.pm-milestone-row').count(), 6);
    await page.locator('.main').evaluate((el) => (el.scrollTop = 0));
    await capture('plan-dark');
    await click('nav:report');
    await page.locator('.pm-report-paper').waitFor();
    const preview = await page.locator('.pm-report-paper').innerText();
    assert.match(preview, /접근성 검토/);
    await capture('report-dark');
    // Only the native save dialog and clipboard boundary are stubbed; report generation and file I/O are real.
    const filename = path.join(directory, 'report.html');
    await application.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, filename);
    await click('report-save');
    await page.getByText('보고서를 저장했습니다.', { exact: true }).waitFor();
    assert.match(fs.readFileSync(filename, 'utf8'), /접근성 검토/);
    const before = await page.evaluate(async () =>
      (await window.workroom.call('snapshot')).value.products.find(
        (p) => p.name === '고객 피드백 허브',
      ),
    );
    await page.evaluate(async (p) => {
      await window.workroom.call('updateProjectStatus', {
        id: p.id,
        revision: p.revision,
        ...Object.fromEntries(Object.entries(p.management).filter(([k]) => k !== 'updatedAt')),
        summary: 'CHANGED AFTER PREVIEW',
      });
    }, before);
    await click('report-copy');
    await page.getByText('보고서를 복사했습니다.', { exact: true }).waitFor();
    const copied = await application.evaluate(() => globalThis.planningCopiedText);
    assert.match(copied, /접근성 검토/);
    assert(!copied.includes('CHANGED AFTER PREVIEW'));
    await page.evaluate(async (p) => {
      await window.workroom.call('updateProjectStatus', {
        id: p.id,
        revision: p.revision + 1,
        ...Object.fromEntries(Object.entries(p.management).filter(([k]) => k !== 'updatedAt')),
      });
    }, before);
    await click('report-period:0');
    assert.match(await page.locator('.pm-report-paper').innerText(), /전체 기간/);
    await page.evaluate(() => window.workroom.language('en'));
    await click('refresh');
    await click('report-period:7');
    assert.match(await page.locator('.pm-report-paper').innerText(), /Status summary/);
    await capture('report-en-dark');
    await click('nav:home');
    await capture('overview-en-dark');
    await click('nav:dashboard');
    await capture('projects-en-dark');
    // Real renderer matrix; screenshots retain the actual chrome and data.
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme });
      for (const [width, height] of [
        [1440, 900],
        [1280, 800],
        [900, 700],
        [760, 600],
      ]) {
        await application.evaluate(
          ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h),
          [width, height],
        );
        for (const view of ['home', 'dashboard', 'plan', 'report']) {
          if (view === 'plan' || view === 'home') await click(`product:${product.id}`);
          await click('nav:' + view);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
          );
          for (const selector of ['.main', '.workspace-toolbar']) {
            assert.equal(
              await page.locator(selector).evaluate((el) => el.scrollWidth > el.clientWidth),
              false,
              `${view} ${selector} overflow ${width} ${colorScheme}`,
            );
          }
          await capture(`${view}-${colorScheme}-${width}`);
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        result: 'passed',
        checks: [
          'account-free status and milestone editing',
          'unsaved edit protection',
          'completion evidence required',
          'cross-project overview',
          'real stdio MCP milestone registration and duplicate request',
          'immutable preview file export and isolated clipboard boundary',
          'Korean/English and dark/light layouts',
          '1440/1280/900/760px actual renderer matrix without horizontal overflow',
        ],
        output,
      }),
    );
  } finally {
    await client.close().catch(() => {});
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
