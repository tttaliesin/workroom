const workDir=require('node:path').resolve(__dirname,'../../work');require('node:fs').mkdirSync(workDir,{recursive:true});require('node:fs').mkdirSync(require('node:path').resolve(__dirname,'../../outputs'),{recursive:true});
const { _electron: electron } = require('./lib/playwright.cjs');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');const {spawn}=require('node:child_process');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const {Workroom}=await import(pathToFileURL(path.join(root,'src/core/service.mjs')));
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
 const {StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
 const dir=fs.mkdtempSync(path.join(workDir,'task-review-'));
 const room=new Workroom(path.join(dir,'workroom.sqlite'));
 const p=await room.createProduct({name:'작업실',folder:root,goal:'개발 작업의 근거와 포트폴리오를 한 흐름으로 연결'});
 const client=new Client({name:'workroom-review',version:'1.0.0'});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/mcp/server.mjs')],env:{...process.env,WORKROOM_DATA_DIR:dir},stderr:'pipe'});
 let input;
 try{
  await client.connect(transport);
  const report=async(args)=>{const r=await client.callTool({name:'workroom_report_work',arguments:{productId:p.id,...args}});if(r.isError)throw new Error(r.content[0].text);return JSON.parse(r.content[0].text);};
  await report({title:'점검 상태 표시 수정',summary:'Git 상태를 확인하지 못해도 문제가 없는 것처럼 표시됐습니다. 미확인 항목을 따로 보관하고 확인하지 못한 이유를 표시하도록 수정했습니다.',evidence:'outputs/execution-review-v0.1.md의 실제 실행 점검 보고를 옮겼습니다. README와 스크립트 이름을 확인했고 Git 상태는 미확인으로 표시했습니다.',limitations:'저장소 스크립트는 실행하지 않았습니다. 수정본과 실행 로그의 자동 연결은 없습니다.',contribution:'사용자: 실행 검토 요청 · 에이전트: 재현, 수정, 검사',changedFiles:[{path:'src/core/inspection.mjs',summary:'미확인 항목과 사유 보존'},{path:'src/renderer/app.js',summary:'일부 미확인 상태 표시'}],checks:[{name:'실제 프로젝트 읽기 전용 점검',result:'passed',detail:'README와 start / mcp / test 스크립트 이름 확인'},{name:'Git 상태',result:'unconfirmed',detail:'Git 상태를 확인하지 못한 사유 표시'}]});
  input=await report({title:'입력 소실 수정',summary:'메뉴를 이동하면 작성 중인 내용이 사라졌습니다. 저장하지 않은 입력을 보호하고, 창 닫기를 취소한 뒤에도 저장할 수 있도록 수정했습니다.',evidence:'outputs/execution-review-v0.1.md의 기존 실행 보고를 옮겼습니다. 이번 화면 개편 후에도 scripts/checks/check-task-desktop.cjs에서 입력 보호와 저장·복원을 다시 확인했습니다.',limitations:'네이티브 닫기 확인은 ‘계속 작성’ 응답을 대체했습니다. 수정본과 실행 로그의 자동 연결, 운영 배포는 미확인입니다.',contribution:'사용자: 문제 제기·검토 · 에이전트: 재현·수정·검사',changedFiles:[{path:'src/renderer/app.js',summary:'입력 보존 · 화면 이동 보호'},{path:'src/desktop/main.mjs',summary:'닫기 취소 후 데이터베이스 유지'}],checks:[{name:'메뉴 이동 · 새로고침 뒤 제목과 본문 보존',result:'passed',detail:'Electron UI 검사에서 입력값 유지 확인'},{name:'닫기 취소 후 작성 중인 결과 저장',result:'passed',detail:'닫기 응답 대체 후 실제 SQLite 저장 확인'},{name:'대상별 초안 · HTML 내보내기 · 재시작 복원',result:'passed',detail:'실제 IPC와 파일 쓰기 사용'}]});
 }finally{await client.close();}
 const draft=room.createPortfolio({target:'기본 포트폴리오',requirements:'검토용 데이터. 실제 사용자 소개와 기업 정보는 아직 입력하지 않았습니다.'});
 room.savePortfolio({id:draft.id,revision:draft.revision,intro:'에이전트와 함께 개발 도구를 만들고 검증합니다.',requirements:draft.requirements,entries:[{taskId:input.id,title:input.title,description:input.summary,contribution:input.contribution}]});room.close();
 const env={...process.env,WORKROOM_DATA_DIR:dir,WORKROOM_HEADLESS:'0',WORKROOM_NODE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;
 const exe=require('electron');
 const app=await electron.launch({executablePath:exe,args:[root],env});
 let observations={};
 try{
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('heading',{name:'입력 소실 수정',exact:true}).waitFor();
  observations.actualWindowVisible=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible());assert.equal(observations.actualWindowVisible,true);
  await page.evaluate(()=>document.fonts.ready);
  observations.fontLoaded=await page.evaluate(()=>document.fonts.check('14px Pretendard'));
  assert.equal(observations.fontLoaded,true);
  await page.screenshot({path:path.join(root,'outputs/app-redesign-detail.png'),scale:'css'});
  await page.getByRole('button',{name:'포트폴리오 초안 보기',exact:true}).click();
  await page.getByRole('article',{name:'포트폴리오 미리보기'}).waitFor();
  await page.screenshot({path:path.join(root,'outputs/app-redesign-portfolio.png'),scale:'css'});
  await page.getByRole('button',{name:'← 입력 소실 수정',exact:true}).click();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(760,650));
  await page.waitForFunction(()=>innerWidth<=760 && innerWidth>=700);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(workDir,'task-review-narrow.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1240,860));
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(()=>matchMedia('(prefers-color-scheme: dark)').matches);
  await page.screenshot({path:path.join(workDir,'task-review-dark.png')});
  assert.deepEqual(errors,[]);observations.errors=errors;
 }finally{await app.close();}
 const child=spawn(exe,[root],{cwd:root,env,detached:true,stdio:'ignore'});child.unref();
 fs.writeFileSync(path.join(workDir,'visible-task-session.json'),JSON.stringify({pid:child.pid,dataDirectory:dir,...observations},null,2));
 console.log(JSON.stringify({pid:child.pid,dataDirectory:dir,...observations}));
})().catch(e=>{console.error(e);process.exitCode=1;});
