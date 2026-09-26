import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Workroom} from '../src/core/service.mjs';
import {AgentEngine} from '../src/runtime/engine.mjs';

async function until(fn){for(let n=0;n<700;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('operation wait timed out');}
async function fixture(t,{changes=false,empty=false,maxDailyStarts=4,maxRepairs=0,hold=false,broken=false,multiple=false}={}) {
 const dir=await mkdtemp(path.join(os.tmpdir(),'workroom-ops-')),folder=path.join(dir,'product');await mkdir(folder);
 await writeFile(path.join(folder,'math.mjs'),'export const add=(a,b)=>a-b;\n');
 await writeFile(path.join(folder,'math.test.mjs'),"import {test} from 'node:test';import assert from 'node:assert/strict';import {add} from './math.mjs';test('sum',()=>assert.equal(add(2,3),5));\n");
 const room=new Workroom(path.join(dir,'db.sqlite')),product=await room.createProduct({name:'sum',folder,goal:'Correct addition'});
 let now=Date.now(),engine;const calls=[];
 const broker={status:{state:'ready',models:[{id:'fixture'}]},request:async(method,input)=>{
  if(method==='abort')return {};
  calls.push(input.role);if(hold && input.role==='coordinate')await new Promise(r=>broker.release=r);
  if(input.role==='knowledge')return {result:{records:[]}};
  const file=await engine.tool({runId:input.runId,name:'read',args:{path:'math.mjs'}});
  if(input.role==='coordinate')return {result:{summary:'Addition issue.',issues:empty?[]:[...(multiple?[{key:'low-priority',title:'낮은 우선순위',priority:'low',reason:'follow-up',goal:'A lower priority investigation.',action:'investigate',evidenceIds:[file.evidenceId]}]:[]),{key:'addition-result',title:'합계 계산 수정',priority:'high',reason:'addition uses subtraction',goal:'Fix add to return the sum.',action:'prepare_change',evidenceIds:[file.evidenceId]}],limitations:'Source only'}};
  if(input.role==='investigate')return {result:{summary:'add subtracts its operands',findings:[{title:'Subtracts',detail:'a-b',evidenceIds:[file.evidenceId]}],limitations:'Source only',nextStep:'Change subtraction to addition.'}};
  if(input.role==='develop'){const write=await engine.tool({runId:input.runId,name:'write',args:{path:'math.mjs',expectedHash:file.hash,content:broken?'export const add=(a,b)=>a-b+0;\n':'export const add=(a,b)=>a+b;\n'}});return {result:{summary:'Adds correctly.',evidenceIds:[write.evidenceId],limitations:'fixture'}};}
  return {result:{verdict:'supported',assessment:'Read the source independently.',evidenceIds:[file.evidenceId],limitations:'fixture'}};
 }};
 engine=new AgentEngine(room,broker,{agentDirectory:path.join(dir,'runtime'),nodeExecutable:process.execPath,now:()=>now});engine.configure({modelId:'fixture'});
 const configure=patch=>engine.operations.configure({productId:product.id,version:engine.operations.policy(product.id).version,enabled:true,intervalMinutes:15,maxDailyStarts,allowChanges:changes,testFiles:changes?['math.test.mjs']:[],allowTests:changes,maxRepairs,...patch});
 await configure({});
 t.after(async()=>{engine.closed=true;broker.release?.();await until(()=>!engine.active.size && !engine.operations.busy);room.close();await rm(dir,{recursive:true,force:true});});
 return {dir,folder,room,product,get engine(){return engine;},broker,calls,configure,advance:ms=>now+=ms,restart(){engine.closed=true;engine=new AgentEngine(room,broker,{agentDirectory:path.join(dir,'runtime'),nodeExecutable:process.execPath,now:()=>now});}};
}
test('unchanged source skips model calls and missed schedules coalesce after restart',async t=>{
 const f=await fixture(t,{empty:true});await f.engine.operations.tick();await until(()=>f.calls.length===1 && !f.engine.active.size && !f.engine.operations.busy);
 f.restart();f.advance(5*86400000);await f.engine.operations.tick();assert.equal(f.calls.length,1);assert.equal(f.room.store.list('operation-observation')[0].status,'unchanged');
 await writeFile(path.join(f.folder,'math.mjs'),'export const add=(a,b)=>a+b;\n');f.advance(16*60000);await f.engine.operations.tick();await until(()=>f.calls.length===2 && !f.engine.active.size && !f.engine.operations.busy);
 assert.equal(f.room.store.list('task').filter(t=>t.mode==='operation').length,2);
});
test('reviewed findings automatically reach an isolated checked change; original still waits for user',async t=>{
 const f=await fixture(t,{changes:true});await f.engine.operations.tick();
 await until(()=>f.room.store.list('task').some(t=>t.mode==='change' && t.status==='awaiting_apply') && !f.engine.active.size && !f.engine.operations.busy);
 const issue=f.room.store.list('operation-issue')[0],change=f.room.store.get('task',issue.changeTaskId);
 assert.equal(change.sourceTaskId,issue.investigationId);assert.equal(change.outputs.check.result.status,'passed');assert.equal(issue.status,'awaiting_apply');
 assert.match(await readFile(path.join(f.folder,'math.mjs'),'utf8'),/a-b/);
 await f.engine.operations.reconcile();assert.equal(f.room.store.list('task').filter(t=>t.mode==='change').length,1);
 assert.deepEqual(f.calls,['coordinate','investigate','review','knowledge','develop','change_review']);
});
test('read-only policy stops after investigation and daily cap prevents follow-up starts',async t=>{
 const f=await fixture(t);await f.engine.operations.tick();await until(()=>f.room.store.list('operation-issue')[0]?.status==='awaiting_scope' && !f.engine.operations.busy);
 assert(!f.calls.includes('develop'));
 await f.configure({maxDailyStarts:1});await assert.rejects(()=>f.engine.operations.observe({productId:f.product.id,manual:true}),/한도/);
});
test('policy revocation invalidates in-flight file access and prevents follow-up tasks',async t=>{
 const f=await fixture(t,{hold:true});await f.engine.operations.tick();await until(()=>!!f.broker.release);
 await f.configure({enabled:false});f.broker.release();await until(()=>!f.engine.active.size && !f.engine.operations.busy);
 assert.equal(f.room.store.list('operation-issue').length,0);assert.equal(f.room.store.list('task').length,1);
 assert.equal(f.room.store.list('task')[0].status,'stopped');
});

test('new change permission releases a completed read-only investigation without duplicating it',async t=>{
 const f=await fixture(t);await f.engine.operations.tick();await until(()=>f.room.store.list('operation-issue')[0]?.status==='awaiting_scope' && !f.engine.operations.busy);
 await f.configure({allowChanges:true,testFiles:['math.test.mjs'],allowTests:true});await f.engine.operations.tick();
 await until(()=>f.room.store.list('task').some(t=>t.mode==='change' && t.status==='awaiting_apply') && !f.engine.active.size && !f.engine.operations.busy);
 assert.equal(f.calls.filter(x=>x==='investigate').length,1);
});
test('priority controls bounded starts and deferral prevents automatic redispatch',async t=>{
 const f=await fixture(t,{multiple:true,maxDailyStarts:2});await f.engine.operations.tick();await until(()=>f.room.store.list('operation-issue').some(i=>i.status==='awaiting_scope') && !f.engine.operations.busy);
 const issues=f.room.store.list('operation-issue');assert(issues.find(i=>i.key==='addition-result').investigationId);assert(!issues.find(i=>i.key==='low-priority').investigationId);
 const low=issues.find(i=>i.key==='low-priority');await f.engine.operations.act({id:low.id,action:'defer'});f.advance(86400000);await f.engine.operations.reconcile();assert.equal(f.room.store.get('operation-issue',low.id).status,'deferred');
});
test('automatic repair stops after the configured single attempt even when tests still fail',async t=>{
 const f=await fixture(t,{changes:true,broken:true,maxRepairs:1,maxDailyStarts:3});await f.engine.operations.tick();
 await until(()=>f.calls.filter(x=>x==='develop').length===2 && f.room.store.list('task').some(t=>t.mode==='change' && t.status==='check_failed') && !f.engine.active.size && !f.engine.operations.busy);
 await f.engine.operations.reconcile();assert.equal(f.calls.filter(x=>x==='develop').length,2);
 const change=f.room.store.list('task').find(t=>t.mode==='change');assert.equal(change.automation.repairs,1);assert(change.previousOutputs.check);assert.match(await readFile(path.join(f.folder,'math.mjs'),'utf8'),/a-b;/);
});
