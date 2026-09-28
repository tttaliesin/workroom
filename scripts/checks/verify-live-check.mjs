import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { assertLiveData } from './lib/live-data.cjs';

const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'work/live-check-session.json'),'utf8'));
assertLiveData(manifest.dataDirectory);
const db=new DatabaseSync(path.join(manifest.dataDirectory,'workroom.sqlite'),{readOnly:true});
const list=kind=>db.prepare('SELECT * FROM entities WHERE kind=?').all(kind).map(r=>({...JSON.parse(r.body),id:r.id,updated:r.updated}));
try {
  const tasks=list('task');
  const task=tasks.find(t=>t.productId===manifest.productId && t.kind==='agent' && t.goal===manifest.goal);
  assert(task,'Expected the request submitted in the actual app');
  assert.equal(task.status,'accepted','The complete live investigation must be accepted');
  assert.equal(task.mode,'investigation');
  assert.equal(task.knowledgeSaved,true);
  assert.equal(task.outputs.review.result.verdict,'supported');
  assert.equal(task.outputs.knowledge.result.records.length,1);
  const roles=['investigate','review','knowledge'];
  const runs=list('agent-run').filter(r=>r.taskId===task.id);
  assert.deepEqual(runs.map(r=>r.role).sort(),[...roles].sort());
  for(const run of runs) {assert.equal(run.status,'completed');assert.equal(run.failure,null);assert(run.tokens>0);}
  const evidence=list('agent-evidence').filter(e=>e.taskId===task.id);
  for(const role of ['investigate','review']) {
    const owned=evidence.filter(e=>e.runId===task.outputs[role].runId);
    assert(owned.length>0,`${role} must independently read an actual file`);
    assert(owned.some(e=>e.path==='label.mjs'));
  }
  for(const item of evidence) {
    assert(['README.md','label.mjs'].includes(item.path));
    const actual=createHash('sha256').update(fs.readFileSync(path.join(manifest.directory,item.path))).digest('hex');
    assert.equal(item.hash,actual,'Cited file hash must match the current source');
  }
  assert.equal(fs.readFileSync(path.join(manifest.directory,'label.mjs'),'utf8'),"export function normalizeLabel(value) {\n  if (typeof value !== 'string') return '이름 없음';\n  return value.trim() || '이름 없음';\n}\n");
  assert(tasks.some(t=>t.id===task.resultTaskId && t.kind==='work'));
  const records=list('record').filter(r=>r.productId===manifest.productId);
  assert(records.some(r=>r.sourceRunId===task.outputs.knowledge.runId && r.runtimeTaskId===task.id));
  const report={checkedAt:new Date().toISOString(),modelId:task.modelId,productId:manifest.productId,taskId:task.id,status:task.status,resultTaskId:task.resultTaskId,knowledgeRecords:records.filter(r=>r.sourceRunId===task.outputs.knowledge.runId).map(r=>({id:r.id,title:r.title,scope:r.scope})),runs:runs.map(r=>({id:r.id,role:r.role,status:r.status,turns:r.turns,tokens:r.tokens,toolCalls:r.toolCalls})),evidenceCount:evidence.length,checks:['live OAuth model response observed in app','three separate live role executions','independent file reads and exact source hashes','linked work report and one conditional knowledge record','fixture source unchanged'],limits:'Read-only investigation on a small synthetic product; no production change, functional test, or deployment was performed.'};
  fs.mkdirSync(path.join(root,'outputs'),{recursive:true});
  fs.writeFileSync(path.join(root,'outputs/live-model-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {db.close();}
