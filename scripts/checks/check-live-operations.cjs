const workDir=require('node:path').resolve(__dirname,'../../work');require('node:fs').mkdirSync(workDir,{recursive:true});
const {_electron}=require('./lib/playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..'),previous=JSON.parse(fs.readFileSync(path.join(workDir,'visible-runtime-session.json'),'utf8'));
(async()=>{
 const {Workroom}=await import(pathToFileURL(path.join(root,'src/core/service.mjs'))),room=new Workroom(path.join(previous.dataDirectory,'workroom.sqlite'));
 assert(!room.store.list('task').some(t=>['running','queued','stopping','applying'].includes(t.status)),'existing app work must be idle');
 const manifest=JSON.parse(fs.readFileSync(path.join(workDir,'live-operations-session.json'),'utf8'));
 const {folder,modelId}=manifest,product=room.store.get('product',manifest.productId);
 let portfolio=room.store.get('portfolio',manifest.portfolioId);
 if(!manifest.repairTarget){portfolio=room.createPortfolio({target:'개발 도구 팀 · 근거 편집 검증',requirements:portfolio.requirements,autoProductIds:[product.id]});manifest.previousPortfolioId=manifest.portfolioId;manifest.portfolioId=portfolio.id;manifest.repairTarget=true;fs.writeFileSync(path.join(workDir,'live-operations-session.json'),JSON.stringify(manifest,null,2));}room.close();
 const env={...process.env,WORKROOM_DATA_DIR:previous.dataDirectory,WORKROOM_NODE:process.execPath};delete env.WORKROOM_HEADLESS;delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:require('electron'),args:[root],env});let page,configured=false;
 try{
  page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const call=async(method,args)=>{const r=await page.evaluate(async({method,args})=>window.workroom.runtime(method,args),{method,args});if(!r.ok)throw Error(r.error);return r.value;};
  const snap=()=>page.evaluate(async()=>(await window.workroom.call('snapshot')).value);
  for(let n=0;n<200;n++){if(['connected','ready'].includes((await snap()).runtime.state))break;await new Promise(r=>setTimeout(r,200));}
  const initial=await snap();console.log(JSON.stringify({accountState:initial.runtime.state,failure:initial.runtime.failure,modelId:initial.runtime.modelId}));assert(['ready','connected'].includes(initial.runtime.state),'saved account is not ready');assert.equal(initial.runtime.modelId,modelId);
  if(initial.runtime.paused)await call('configure',{paused:false});
  await page.locator(`[data-action="product:${product.id}"]`).first().evaluate(el=>el.click());
  configured=true;
  const p=(await snap()).portfolios.find(p=>p.id===portfolio.id);await call('configurePortfolioEditor',{id:p.id,revision:p.revision,enabled:true});
  console.log(JSON.stringify({phase:'live target edit started; completed operation and investigation reused',modelId}));
  let last='',final;
  for(let i=0;i<240;i++){
   const s=await snap(),tasks=s.tasks.filter(t=>t.productId===product.id && t.kind==='agent' && (t.mode!=='portfolio' || t.portfolioId===portfolio.id));
   const state=tasks.map(t=>`${t.mode}:${t.stage}:${t.status}`).sort().join('|');if(state!==last){console.log(state);last=state;}
   const bad=tasks.find(t=>['failed','needs_review','waiting_auth','waiting_quota','interrupted','stopped'].includes(t.status));if(bad)throw Error(`${bad.mode}: ${bad.status}: ${bad.message}`);
   const edit=s.portfolioEdits.find(e=>e.portfolioId===portfolio.id);
   if(edit?.status==='applied' && tasks.some(t=>t.mode==='investigation' && t.status==='accepted') && !s.runtime.active){final=s;break;}
   await new Promise(r=>setTimeout(r,3000));
  }
  assert(final,'live pipeline did not finish in 12 minutes');assert.equal(fs.readFileSync(path.join(folder,'sum.mjs'),'utf8'),'export const sum=(a,b)=>a-b;\n');
  const tasks=final.tasks.filter(t=>t.productId===product.id && t.kind==='agent' && (t.mode!=='portfolio' || t.portfolioId===portfolio.id)),runs=final.agentRuns.filter(r=>tasks.some(t=>t.id===r.taskId));assert.deepEqual(new Set(runs.map(r=>r.role)),new Set(['coordinate','investigate','review','knowledge','curate','curate_review']));
  await page.locator('[data-action="refresh"]').click();await page.locator('[data-action="nav:home"]').first().click();await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(root,'outputs/app-live-operations-complete.png'),scale:'css'});
  await page.locator(`[data-action="target:${portfolio.id}"]`).first().evaluate(el=>el.click());await page.locator('.portfolio-agent-result summary').click();await page.screenshot({path:path.join(root,'outputs/app-live-portfolio-curation.png'),scale:'css'});
  const result={...manifest,verifiedAt:new Date().toISOString(),tasks:tasks.map(({id,mode,status,stage})=>({id,mode,status,stage})),roles:runs.map(({role,status,turns,tokens})=>({role,status,turns,tokens})),issueCount:final.operationIssues.filter(i=>i.productId===product.id).length,editStatus:final.portfolioEdits.find(e=>e.portfolioId===portfolio.id).status,originalUnchanged:true,errors};
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'outputs/live-operations-verification.json'),JSON.stringify(result,null,2));console.log('LIVE OPERATION AND PORTFOLIO VERIFIED');
 }finally{
  if(page && configured){
   const s=(await page.evaluate(async()=>window.workroom.call('snapshot'))).value,p=s.operationPolicies.find(p=>p.productId===product.id),folio=s.portfolios.find(p=>p.id===portfolio.id);
   await page.evaluate(async({p,folio})=>{await window.workroom.runtime('configureOperations',{productId:p.productId,version:p.version,enabled:false,intervalMinutes:p.intervalMinutes,maxDailyStarts:p.maxDailyStarts,allowChanges:false,testFiles:[],maxRepairs:0});await window.workroom.runtime('configurePortfolioEditor',{id:folio.id,revision:folio.revision,enabled:false});},{p,folio});
   await page.locator('[data-action="nav:home"]').first().evaluate(el=>el.click()).catch(()=>{});
  }
  await app.evaluate(({app})=>app.quit()).catch(()=>{});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
