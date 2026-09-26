const workDir=require('node:path').resolve(__dirname,'../../work');require('node:fs').mkdirSync(workDir,{recursive:true});
const {_electron}=require('./lib/playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');const root=path.resolve(__dirname,'../..');
(async()=>{
 const directory=fs.mkdtempSync(path.join(workDir,'change-ui-')),folder=path.join(directory,'product');fs.mkdirSync(folder);
 fs.writeFileSync(path.join(folder,'sum.mjs'),'export function sum(a, b) {\n  return a - b;\n}\n');
 fs.writeFileSync(path.join(folder,'sum.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {sum} from './sum.mjs';test('합계 계산',()=>assert.equal(sum(2,3),5));");
 const {Workroom}=await import(pathToFileURL(path.join(root,'src/core/service.mjs'))),{AgentEngine}=await import(pathToFileURL(path.join(root,'src/runtime/engine.mjs')));
 const room=new Workroom(path.join(directory,'workroom.sqlite')),product=await room.createProduct({name:'계산 예제',folder,goal:'합계가 올바르게 계산되어야 합니다.'});
 let engine;
 const broker={status:{state:'ready',models:[{id:'fixture-model'}]},request:async(_method,input)=>{
   if(input.role==='develop'){
     const before=await engine.tool({runId:input.runId,name:'read',args:{path:'sum.mjs'}});
     const file=await engine.tool({runId:input.runId,name:'write',args:{path:'sum.mjs',expectedHash:before.hash,content:'export function sum(a, b) {\n  return a + b;\n}\n'}});
     return {result:{summary:'두 수의 차이를 반환하던 합계 함수를 덧셈으로 수정했습니다.',evidenceIds:[file.evidenceId],limitations:'지정한 정수 합계 사례만 다룹니다.'}};
   }
   const file=await engine.tool({runId:input.runId,name:'read',args:{path:'sum.mjs'}});
   return {result:{verdict:'supported',assessment:'합계 함수가 덧셈을 사용하며, 같은 테스트가 수정 전 실패·수정 후 통과한 기록을 확인했습니다.',evidenceIds:[file.evidenceId],limitations:'예제 모델 응답입니다. Node 검사는 실제로 실행했습니다.'}};
 }};
 engine=new AgentEngine(room,broker,{agentDirectory:path.join(directory,'pi'),nodeExecutable:process.execPath});engine.configure({modelId:'fixture-model'});
 const task=engine.start({productId:product.id,goal:'합계 계산 수정',mode:'change',testFiles:['sum.test.mjs']});
 for(let i=0;i<400 && (room.store.get('task',task.id).status!=='awaiting_apply' || engine.active.size);i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(room.store.get('task',task.id).status,'awaiting_apply');engine.closed=true;room.close();
 const env={...process.env,WORKROOM_DATA_DIR:directory,WORKROOM_HEADLESS:'1',WORKROOM_NODE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:require('electron'),args:[root],env});
 try{
  const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  const click=async action=>page.locator(`[data-action="${action}"]`).first().evaluate(el=>el.click());
  await page.getByRole('heading',{name:'계산 예제',exact:true}).waitFor();await click(`task:${task.id}`);await page.getByRole('heading',{name:'합계 계산 수정',exact:true}).waitFor();
  for(let i=0;i<100;i++){const state=await page.evaluate(async()=>(await window.workroom.call('snapshot')).value.runtime.state);if(state!=='starting')break;await new Promise(r=>setTimeout(r,50));}
  await click('refresh');
  assert.match(await page.locator('.change-diff').innerText(),/return a \+ b/);assert.match(fs.readFileSync(path.join(folder,'sum.mjs'),'utf8'),/a - b/);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(root,'outputs/app-change-review.png'),scale:'css'});
  await page.getByRole('heading',{name:'앱이 실행한 검사',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));
  await page.screenshot({path:path.join(root,'outputs/app-change-checks.png'),scale:'css'});
  await page.locator('form[data-form="change-apply"] button[type="submit"]').evaluate(el=>el.click());
  await page.getByText('검토한 수정본을 반영했습니다.',{exact:false}).waitFor();assert.match(fs.readFileSync(path.join(folder,'sum.mjs'),'utf8'),/a \+ b/);
  const state=await page.evaluate(async()=>(await window.workroom.call('snapshot')).value);
  const done=state.tasks.find(t=>t.id===task.id);assert(done.appliedAt);assert(done.resultTaskId);assert.equal(state.applyJournals[0].state,'applied');
  await click('delegate');await page.locator('#request-goal').fill('합계 검증');await page.locator('[name="mode"][value="change"]').evaluate(el=>el.click());await page.locator('.request-tests summary').evaluate(el=>el.click());
  await page.locator('#request-tests').fill('sum.test.mjs');await page.locator('form[data-form="delegation"] button[type="submit"]').evaluate(el=>el.click());
  await page.getByText('지정한 테스트의 실행을 허용하거나 테스트 경로를 비워주세요.',{exact:true}).waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(900,720));await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:path.join(root,'outputs/app-change-start-dark.png'),scale:'css'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({directory,checks:['real Node verification displayed','versioned diff','actual IPC application to fixture source','journal and result persisted','test execution requires selected scope','narrow dark form'],model:'deterministic fixture',errors}));
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
