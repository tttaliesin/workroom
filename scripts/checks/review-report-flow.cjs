const workDir=require('node:path').resolve(__dirname,'../../work');require('node:fs').mkdirSync(workDir,{recursive:true});require('node:fs').mkdirSync(require('node:path').resolve(__dirname,'../../outputs'),{recursive:true});
const { _electron: electron } = require('./lib/playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), { spawn } = require('node:child_process');
const root = path.resolve(__dirname,'../..');
(async () => {
 const { Workroom } = await import(pathToFileURL(path.join(root, 'src/core/service.mjs')));
 const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
 const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
 const dir = fs.mkdtempSync(path.join(workDir, 'report-review-'));
 const room = new Workroom(path.join(dir, 'workroom.sqlite'));
 const product = await room.createProduct({ name: '작업실', folder: root, goal: '개발 작업의 결과를 기록과 포트폴리오에 연결' });
 const portfolio = room.createPortfolio({ target: '기본 포트폴리오', autoProductIds: [product.id], requirements: '동작 검토용 초안. 사용자의 실제 소개와 지원 기업은 아직 확정하지 않았습니다.' });
 room.savePortfolio({ id: portfolio.id, revision: portfolio.revision, intro: '개발 과정의 반복 작업을 줄이는 도구를 만듭니다.', requirements: portfolio.requirements, entries: [] });
 const env = { ...process.env, WORKROOM_DATA_DIR: dir, WORKROOM_HEADLESS: '0', WORKROOM_NODE: process.execPath }; delete env.ELECTRON_RUN_AS_NODE;
 const client = new Client({ name: 'workroom-review', version: '1.0.0' });
 const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src/mcp/server.mjs')], env, stderr: 'pipe' });
 try {
  await client.connect(transport);
  const result = await client.callTool({ name: 'workroom_report_work', arguments: {
   productId: product.id, externalId: 'workroom/report-to-draft', sourceVersion: 1,
   title: '작업 보고의 초안 자동 반영',
   summary: '에이전트의 보고가 들어오면 관련 기록과 지정한 포트폴리오 초안에 함께 저장됩니다. 같은 보고의 재전송은 중복 생성하지 않으며, 직접 고친 문장과 제외한 사례는 유지합니다.',
   evidence: 'tests/*.test.mjs 12개 통과. scripts/checks/check-live-report.cjs에서 별도 MCP 프로세스가 실제 Electron과 같은 SQLite로 보고를 전달하는 흐름을 검사했습니다. scripts/checks/check-task-desktop.cjs의 기존 저장·내보내기 검사도 통과했습니다.',
   limitations: '개발 도구의 세션 종료 자동 감지는 미연결입니다. MCP 보고를 수신한 뒤부터 반영합니다. 검사에는 격리된 제품과 검증용 데이터를 사용했습니다. 웹 배포와 무인 디버깅은 미구현입니다.',
   contribution: '사용자: 제품 방향·검토 · 에이전트: 구현·자동 검사',
   changedFiles: [{ path: 'src/core/service.mjs', summary: '보고 식별·수정 버전·원자적 저장' }, { path: 'src/core/portfolio-sync.mjs', summary: '초안 자동 반영과 수동 편집·제외 보존' }, { path: 'src/renderer/merge-draft.js', summary: '편집 중 도착한 보고의 병합과 충돌 구분' }, { path: 'src/renderer/app.js', summary: '자동 갱신·대상별 설정·충돌 비교' }],
   checks: [{ name: '저장·MCP·보고 처리 검사 12개', result: 'passed', detail: 'node --test tests/*.test.mjs' }, { name: '실제 MCP → Electron 자동 반영', result: 'passed', detail: '중복 방지, 편집 병합, 충돌 비교, 제외 보존과 반영 중단 확인' }, { name: '기존 저장·내보내기와 입력 보호', result: 'passed', detail: 'scripts/checks/check-task-desktop.cjs 통과' }, { name: '세션 종료 자동 수집·웹 배포', result: 'unconfirmed', detail: '현재 구현 범위에 포함되지 않음' }]
  } });
  assert.ok(!result.isError, result.content[0].text);
  assert.equal(room.snapshot().portfolios[0].entries.length, 1);
 } finally { await client.close(); room.close(); }
 const exe = require('electron');
 const app = await electron.launch({ executablePath: exe, args: [root], env });
 try {
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '작업 보고의 초안 자동 반영', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(root, 'outputs/app-report-detail.png'), scale: 'css' });
  await page.getByRole('button', { name: '포트폴리오 초안 보기', exact: true }).click();
  await page.locator('.paper h3').filter({ hasText: '작업 보고의 초안 자동 반영' }).waitFor();
  await page.screenshot({ path: path.join(root, 'outputs/app-report-portfolio.png'), scale: 'css' });
  await page.getByRole('button', { name: '초안 편집', exact: true }).click(); await page.locator('.subscriptions summary').click();
  assert.equal(await page.locator('.subscriptions input').isChecked(), true);
  await page.screenshot({ path: path.join(root, 'outputs/app-report-settings.png'), scale: 'css' });
  assert.deepEqual(errors, []);
 } finally { await app.close(); }
 const child = spawn(exe, [root], { cwd: root, env, detached: true, stdio: 'ignore' }); child.unref();
 fs.writeFileSync(path.join(workDir, 'visible-report-session.json'), JSON.stringify({ pid: child.pid, dataDirectory: dir }, null, 2));
 console.log(JSON.stringify({ pid: child.pid, dataDirectory: dir, automaticDraft: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
