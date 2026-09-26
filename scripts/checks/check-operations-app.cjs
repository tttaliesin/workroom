const workDir=require('node:path').resolve(__dirname,'../../work');require('node:fs').mkdirSync(workDir,{recursive:true});
const {_electron}=require('%USERPROFILE%/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),root=path.resolve(__dirname,'../..');
const wait=async fn=>{for(let i=0;i<800;i++){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('timeout');};
(async()=>{
 const directory=fs.mkdtempSync(path.join(workDir,'operation-ui-')),folder=path.join(directory,'product');fs.mkdirSync(folder);
 fs.writeFileSync(path.join(folder,'sum.mjs'),'export const sum=(a,b)=>a-b;\n');fs.writeFileSync(path.join(folder,'sum.test.mjs'),"import {test} from 'node:test';import assert from 'node:assert/strict';import {sum} from './sum.mjs';test('sum',()=>assert.equal(sum(2,3),5));");
 const {Workroom}=await import(pathToFileURL(path.join(root,'src/core/service.mjs'))),{AgentEngine}=await import(pathToFileURL(path.join(root,'src/runtime/engine.mjs')));
 const room=new Workroom(path.join(directory,'workroom.sqlite')),product=await room.createProduct({name:'운영 흐름 검증',folder,goal:'합계 계산의 잘못된 동작을 찾고 근거를 확인한 뒤 수정안까지 준비합니다.'});
 const portfolio=room.createPortfolio({target:'개발 도구 팀',requirements:'작은 문제를 재현하고 검증 가능한 수정으로 이어가는 경험',autoProductIds:[product.id]});
 let engine;const broker={status:{state:'ready',models:[{id:'fixture'}]},request:async(method,input)=>{
  if(method==='abort')return {};
  if(input.role==='knowledge')return {result:{records:[]}};
  if(input.mode==='portfolio'){
   const s=input.handoff.portfolio.sources[0];
   if(input.role==='curate')return {result:{intro:'소스의 문제를 근거로 확인하고 다음 작업으로 연결합니다.',introCitations:[{taskId:s.id,revision:s.revision,quote:s.summary}],entries:[{taskId:s.id,title:'합계 오류의 원인 조사',description:'합계 함수에서 뺄셈을 사용하는 경로를 소스에서 확인했습니다. 수정 반영과 서비스 검증은 별도입니다.',contribution:s.contribution,reason:'대상에서 강조한 재현·근거 중심의 문제 해결과 연결되는 소스 조사 경험입니다.',citations:[{taskId:s.id,revision:s.revision,quote:s.summary}]}],limitations:'결정적 예제 모델입니다. 수정·배포 성과를 주장하지 않습니다.'}};
   return {result:{verdict:'supported',assessment:'원본 보고의 소스 조사 범위를 지키고 수정 완료를 주장하지 않았습니다.',sourceTaskIds:[s.id],limitations:'예제 검토 결과입니다.'}};
  }
  const f=await engine.tool({runId:input.runId,name:'read',args:{path:'sum.mjs'}});
  if(input.role==='coordinate')return {result:{summary:'목표와 직접 관련된 합계 계산의 오류를 발견했습니다.',issues:[{key:'sum-subtracts',title:'합계가 두 값의 차이로 계산됨',priority:'high',reason:'sum 함수가 a-b를 반환하므로 기본 합계가 잘못됩니다.',goal:'sum이 두 값의 합을 반환하게 수정하고 고정 테스트로 확인합니다.',action:'prepare_change',evidenceIds:[f.evidenceId]}],limitations:'작은 로컬 검증 예제입니다.'}};
  if(input.role==='investigate')return {result:{summary:'합계 함수가 두 인수를 더하지 않고 빼는 것을 소스에서 확인했습니다.',findings:[{title:'잘못된 연산자',detail:'a-b가 사용됩니다.',evidenceIds:[f.evidenceId]}],limitations:'소스 조사입니다.',nextStep:'덧셈으로 수정하고 지정된 Node 테스트를 실행합니다.'}};
  if(input.role==='develop'){const w=await engine.tool({runId:input.runId,name:'write',args:{path:'sum.mjs',expectedHash:f.hash,content:'export const sum=(a,b)=>a+b;\n'}});return {result:{summary:'합계를 덧셈으로 수정한 복사본을 준비했습니다.',evidenceIds:[w.evidenceId],limitations:'검증용 예제입니다.'}};}
  return {result:{verdict:'supported',assessment:'현재 소스와 제출 결과를 별도로 확인했습니다.',evidenceIds:[f.evidenceId],limitations:'소스와 지정 검사 범위만 확인했습니다.'}};
 }};
 engine=new AgentEngine(room,broker,{agentDirectory:path.join(directory,'runtime'),nodeExecutable:process.execPath});engine.configure({modelId:'fixture'});
 await engine.operations.configure({productId:product.id,version:0,enabled:true,intervalMinutes:60,maxDailyStarts:4,allowChanges:true,testFiles:['sum.test.mjs'],allowTests:true,maxRepairs:1});await engine.operations.tick();
 await wait(()=>room.store.list('task').some(t=>t.mode==='change' && t.status==='awaiting_apply') && !engine.active.size && !engine.operations.busy);
 const editTask=engine.editor.request({portfolioId:portfolio.id});await wait(()=>room.store.list('portfolio-edit')[0]?.status==='proposed' && !engine.active.size && !engine.operations.busy);
 engine.configure({paused:true});engine.closed=true;const issue=room.store.list('operation-issue')[0],edit=room.store.list('portfolio-edit')[0];room.close();
 const env={...process.env,WORKROOM_DATA_DIR:directory,WORKROOM_HEADLESS:'1',WORKROOM_NODE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[root],env});
 try{
  const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  const click=async a=>page.locator(`[data-action="${a}"]`).first().evaluate(el=>el.click());
  const snap=()=>page.evaluate(async()=>(await window.workroom.call('snapshot')).value);
  await page.getByRole('heading',{name:product.name,exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,840));await page.emulateMedia({colorScheme:'light'});
  assert.match(await page.locator('.operation-issue').innerText(),/원본 반영 검토/);assert.match(await page.locator('.operation-line').innerText(),/지속 운영 켜짐/);
  await page.screenshot({path:path.join(root,'outputs/app-operations-overview.png'),scale:'css'});
  await click(`task:${issue.changeTaskId}`);assert.match(await page.locator('.operation-origin').innerText(),/운영에서 이어진 작업/);await click(`task:${issue.operationTaskId}`);assert.match(await page.locator('.main').innerText(),/다음 작업 판단/);
  await click('nav:scope');const form=page.locator('[data-form="operation-policy"]');await form.locator('[name="allowTests"]').uncheck();await form.locator('button[type="submit"]').click();await page.getByText('자동 수정안의 지정 테스트 실행을 허용하세요.',{exact:true}).waitFor();
  await form.locator('[name="allowTests"]').check();await form.locator('[name="enabled"]').uncheck();await form.locator('button[type="submit"]').click();await page.getByText('운영 범위를 저장했습니다.',{exact:false}).waitFor();
  assert.equal((await snap()).operationPolicies[0].enabled,false);await page.getByRole('heading',{name:'지속 운영',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(root,'outputs/app-operations-settings.png'),scale:'css'});
  await click('nav:home');await click(`target:${portfolio.id}`);await page.locator('.portfolio-agent-panel').waitFor();await page.locator('.portfolio-agent-result summary').click();assert.match(await page.locator('.portfolio-agent-result').innerText(),/대상에서 강조한/);await page.screenshot({path:path.join(root,'outputs/app-portfolio-curation.png'),scale:'css'});
  await click(`portfolio-apply:${edit.id}`);assert.equal((await snap()).portfolioEdits[0].status,'applied');assert.match(await page.locator('#folio-preview').innerText(),/합계 오류의 원인 조사/);
  await click(`portfolio-auto:${portfolio.id}`);assert.equal((await snap()).portfolios[0].autoEdit,true);
  await click(`product:${product.id}`);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(900,700));await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:path.join(root,'outputs/app-operations-dark-narrow.png'),scale:'css'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'outputs/operations-ui-verification.json'),JSON.stringify({directory,checks:['operation chain and origin','scope test consent','disable persisted','target proposal and quote display','apply reviewed proposal','auto-edit opt-in','900px dark overflow'],errors},null,2));console.log('Operation UI integration passed');
 }finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
