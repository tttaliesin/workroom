import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertLiveData } from './lib/live-data.cjs';
const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'work/live-check-session.json'),'utf8'));
assertLiveData(manifest.dataDirectory);
const db=new DatabaseSync(path.join(manifest.dataDirectory,'workroom.sqlite'),{readOnly:true});
const list=kind=>db.prepare('SELECT * FROM entities WHERE kind=?').all(kind).map(r=>({...JSON.parse(r.body),id:r.id,updated:r.updated}));
const tasks=list('task').filter(t=>t.productId===manifest.productId && t.kind==='agent');
const runs=list('agent-run').filter(r=>tasks.some(t=>t.id===r.taskId));
const evidence=list('agent-evidence').filter(e=>tasks.some(t=>t.id===e.taskId));
const records=list('record').filter(r=>r.productId===manifest.productId);
console.log(JSON.stringify({
  credentialPresent:fs.existsSync(path.join(manifest.dataDirectory,'credentials/openai.credential')),
  settings:list('runtime-settings').map(s=>({modelId:s.modelId,paused:s.paused})),
  tasks:tasks.map(t=>({id:t.id,status:t.status,stage:t.stage,modelId:t.modelId,message:t.message,resultTaskId:t.resultTaskId,knowledgeSaved:t.knowledgeSaved,outputs:Object.keys(t.outputs||{})})),
  runs:runs.map(r=>({id:r.id,role:r.role,status:r.status,modelId:r.modelId,turns:r.turns,tokens:r.tokens,toolCalls:r.toolCalls,failure:r.failure})),
  evidence:evidence.map(e=>({id:e.id,runId:e.runId,path:e.path,hash:e.hash})),
  records:records.map(r=>({id:r.id,title:r.title,runtimeTaskId:r.runtimeTaskId,sourceRunId:r.sourceRunId,scope:r.scope})),
},null,2));
db.close();
