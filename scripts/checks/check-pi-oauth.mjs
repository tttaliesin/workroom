import { fork } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { RuntimeBroker } from '../../src/runtime/broker.mjs';
const events=[];
const broker=new RuntimeBroker({
  fork:()=>{const child=fork(path.resolve('src/runtime/pi-worker.mjs'),[],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true,env:Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))});child.postMessage=message=>child.send(message);return child;},
  vault:{read:()=>null,write:()=>{throw new Error('No credentials should be written in a cancelled login test');}},openBrowser:async url=>events.push(new URL(url)),onChange:()=>{}
});
async function wait(predicate){for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,30));}throw new Error('OAuth state timeout');}
try{
  await broker.start();await wait(()=>broker.status.state==='disconnected');
  assert(broker.status.models.length>0);
  await broker.request('login',{mode:'browser'});await wait(()=>events.length===1 && broker.status.manual);
  assert.equal(events[0].hostname,'auth.openai.com');assert.equal(events[0].searchParams.get('code_challenge_method'),'S256');
  await broker.request('cancelLogin');assert.equal(broker.status.state,'disconnected');assert.equal(broker.status.manual,false);
  await broker.request('login',{mode:'browser'});await wait(()=>events.length===2 && broker.status.manual);
  assert.notEqual(events[0].searchParams.get('state'),events[1].searchParams.get('state'));
  await broker.request('cancelLogin');assert.equal(broker.status.state,'disconnected');
  console.log(JSON.stringify({checks:['real Pi OAuth URL and PKCE','cancel pending callback and manual input','repeat login uses a fresh state'],liveLogin:false}));
}finally{broker.close();}
