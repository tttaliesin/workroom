import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readProductFile, listProductFiles, digest,relativeFile } from './files.mjs';
import { parseResult, evidenceRefs, roles } from './contracts.mjs';
import { redact } from './errors.mjs';
import { ChangeWorkflow } from './change-workflow.mjs';
import { Operations } from './operations.mjs';
import { PortfolioEditor } from './portfolio-editor.mjs';

const waitingStates = ['queued','waiting_auth'];
const resumable = ['stopped','interrupted','failed','waiting_auth','waiting_quota','needs_review','check_failed','changes_requested'];
export class AgentEngine {
  constructor(room, broker, { agentDirectory, maxConcurrent=2,nodeExecutable='node',now=Date.now } = {}) {
    this.room=room; this.store=room.store; this.broker=broker; this.agentDirectory=agentDirectory;
    this.maxConcurrent=maxConcurrent; this.owner=randomUUID(); this.active=new Map(); this.closed=false;
    this.changes=new ChangeWorkflow(this,{node:nodeExecutable});
    this.operations=new Operations(this,{now});this.editor=new PortfolioEditor(this);
    this.settings=this.store.list('runtime-settings')[0] || this.store.create('runtime-settings',{paused:false,modelId:null});
    // Startup occurs only after the Electron instance lock has been acquired.
    this.store.transaction(()=>{
      for (const run of this.store.list('agent-run').filter(r=>['running','stopping'].includes(r.status))) this.store.update('agent-run',run.id,run.revision,{...run,status:'interrupted',endedAt:new Date().toISOString()});
      for (const task of this.store.list('task').filter(t=>t.kind==='agent' && ['running','stopping'].includes(t.status))) this.store.update('task',task.id,task.revision,{...task,status:'interrupted',activeRunId:null,message:'앱 실행이 끝나 진행 상태를 복원했습니다. 완료한 결과를 보존했으며 중단한 단계부터 재개할 수 있습니다.'});
      for (const task of this.store.list('task').filter(t=>t.kind==='agent' && t.status==='applying')) this.store.update('task',task.id,task.revision,{...task,status:'apply_partial',message:'반영 도중 앱이 끝났습니다. 파일별 현재 버전을 확인한 뒤 남은 변경만 적용할 수 있습니다.'});
      this.store.log('내장 실행기 시작',this.owner);
    });
    for (const task of this.store.list('task').filter(t=>t.kind==='agent' && t.outputs?.review?.result.verdict==='supported')) {
      try { this.materialize(task.id); } catch { /* Stable report IDs allow a later retry without duplicating results. */ }
    }
    for(const task of this.store.list('task').filter(t=>t.mode==='change' && t.appliedAt)){try{this.changes.materialize(task.id);}catch{}}
  }
  info() { return { ...this.broker.status, paused:this.settings.paused, modelId:this.settings.modelId, active:this.active.size, maxConcurrent:this.maxConcurrent }; }
  configure(input) {
    const value=z.object({paused:z.boolean().optional(),modelId:z.string().max(100).optional()}).strict().parse(input);
    if (value.modelId && !this.broker.status.models?.some(m=>m.id===value.modelId)) throw new Error('현재 Pi 모델 목록에서 선택하세요.');
    this.settings=this.store.update('runtime-settings',this.settings.id,this.settings.revision,{...this.settings,...value});
    this.store.log('내장 실행 설정 변경',this.settings.id);
    this.pump(); return this.info();
  }
  startManaged(input) {
    const product=this.store.get('product',input.productId);
    if(!this.settings.modelId)throw new Error('작업 모델을 먼저 저장하세요.');
    const task=this.store.create('task',{...input,kind:'agent',status:'queued',productRevision:product.revision,modelId:this.settings.modelId,outputs:{},activeRunId:null,verification:'none',deployment:'none'});
    this.store.log('역할 실행 예약',task.id,input.title);queueMicrotask(()=>this.pump());return task;
  }
  start(input,internal={}) {
    const {productId,goal,mode='investigation',testFiles=[],sourceTaskId}=z.object({productId:z.string().uuid(),goal:z.string().trim().min(1).max(2000),mode:z.enum(['investigation','change']).optional(),testFiles:z.array(z.string().max(1024)).max(8).optional(),sourceTaskId:z.string().uuid().optional()}).strict().parse(input);
    for(const file of testFiles){relativeFile(file);if(/[*?\[\]{}]/.test(file) || !/\.(?:test|spec)\.(?:mjs|cjs|js)$/.test(file))throw new Error('와일드카드 없이 실제 Node 테스트 파일(.test.js/.test.mjs/.spec.js 등)을 지정하세요.');}
    if(mode!=='change' && testFiles.length)throw new Error('읽기 전용 조사에서는 테스트를 실행하지 않습니다.');
    if (!this.settings.modelId) throw new Error('계정 연결에서 사용할 모델을 먼저 선택하세요.');
    const selectedTests=[...new Set(testFiles.map(relativeFile))];
    const product=this.store.get('product',productId);
    if(sourceTaskId){const source=this.store.get('task',sourceTaskId);if(source.productId!==productId || source.kind!=='agent' || source.mode==='change' || source.outputs?.review?.result.verdict!=='supported')throw new Error('같은 제품에서 근거 확인을 마친 조사만 다음 작업에 연결할 수 있습니다.');}
    const task=this.store.transaction(()=>{
      const duplicate=this.store.list('task').find(t=>t.kind==='agent' && t.productId===productId && t.goal===goal && t.sourceTaskId===sourceTaskId && (t.mode || 'investigation')===mode && JSON.stringify(t.testFiles || [])===JSON.stringify(selectedTests) && [...waitingStates,'running','stopping'].includes(t.status));
      if (duplicate) return duplicate;
      const created=this.store.create('task',{kind:'agent',mode,testFiles:selectedTests,productId,title:goal.slice(0,100),goal,status:'queued',stage:mode==='change'?'develop':'investigate',productRevision:product.revision,modelId:this.settings.modelId,outputs:{},activeRunId:null,reason:mode==='change'?'사용자가 맡긴 분리된 수정안 작성과 검증':'사용자가 맡긴 읽기 전용 제품 조사',limits:{minutesPerStage:4,turnsPerStage:12,tokensPerStage:60000,toolsPerStage:40},verification:'none',deployment:'none',...internal});
      const linked=sourceTaskId?this.store.update('task',created.id,created.revision,{...created,sourceTaskId}):created;
      this.store.log(mode==='change'?'수정안 요청':'제품 조사 요청',created.id,product.name); return linked;
    });
    queueMicrotask(()=>this.pump()); return task;
  }
  updateTask(task,patch,action='실행 상태 변경') {
    const next=this.store.update('task',task.id,task.revision,{...task,...patch}); this.store.log(action,task.id); return next;
  }
  resume(input) {
    const {id,revision}=z.object({id:z.string().uuid(),revision:z.number().int()}).strict().parse(input);
    const task=this.store.get('task',id);
    if(['operation','portfolio'].includes(task.mode))throw new Error('제품의 지금 확인 또는 대상에 맞게 정리에서 새 기준으로 요청하세요.');
    if (task.revision!==revision || task.kind!=='agent' || !resumable.includes(task.status) || this.active.has(id)) throw new Error('현재 상태에서는 재개할 수 없습니다. 최신 상태를 확인하세요.');
    const product=this.store.get('product',task.productId);
    const restart=!task.appliedAt && (product.revision!==task.productRevision || ['needs_review','check_failed','changes_requested'].includes(task.status) || task.mode==='change' && task.stage==='develop');
    const next=this.updateTask(task,{status:'queued',activeRunId:null,message:null,authFailedAt:null,modelId:this.settings.modelId,productRevision:product.revision,...(restart?{stage:task.mode==='change'?'develop':'investigate',previousOutputs:task.outputs,outputs:{},changeSetId:null,resultTaskId:null,knowledgeSaved:false}: {})},'실행 재개 요청');
    queueMicrotask(()=>this.pump()); return next;
  }
  async stop({id}) {
    const task=this.store.get('task',z.string().uuid().parse(id));
    if (task.kind!=='agent') throw new Error('내장 실행 작업이 아닙니다.');
    const live=this.active.get(id);
    if (!live) {
      if (waitingStates.includes(task.status)) this.updateTask(task,{status:'stopped',message:'대기 작업을 중지했습니다.'},'조사 중지');
      return;
    }
    this.updateTask(task,{status:'stopping',message:'취소를 요청했습니다. 실행 종료 확인을 기다립니다.'},'조사 중지 요청');
    const run=this.store.get('agent-run',live.runId);
    this.store.update('agent-run',run.id,run.revision,{...run,status:'stopping'});
    if(live.controller)live.controller.abort();else void this.broker.request('abort',{runId:live.runId}).catch(()=>{});
    // Only the settled run response or process exit clears ownership.
  }
  async stopAll() { await Promise.allSettled([...this.active.keys()].map(id=>this.stop({id}))); }
  activeHasProduct(productId) {return [...this.active.keys()].some(id=>this.store.get('task',id).productId===productId);}
  pump() {
    if (this.closed || this.settings.paused) return;
    const ready=['connected','ready'].includes(this.broker.status.state);
    const tasks=this.store.list('task').filter(t=>t.kind==='agent' && waitingStates.includes(t.status)).reverse().sort((a,b)=>Number(!!(a.automation || a.automatic))-Number(!!(b.automation || b.automatic)));
    for (let task of tasks) {
      if (this.active.size>=this.maxConcurrent) break;
      if (task.authFailedAt && (!this.broker.status.authenticatedAt || this.broker.status.authenticatedAt<=task.authFailedAt)) continue;
      if (!ready && task.stage!=='check') { if (task.status==='queued') this.updateTask(task,{status:'waiting_auth',message:'계정 연결이 준비되면 자동으로 시작합니다.'}); continue; }
      if (this.active.has(task.id)) continue;
      if(this.changes.applying.size || task.mode==='change' && [...this.active.keys()].some(id=>{const other=this.store.get('task',id);return other.productId===task.productId && other.mode==='change';}))continue;
      try{this.operations.assertTask(task);if(task.mode==='portfolio')this.editor.assertTask(task);}catch(error){this.updateTask(task,{status:'needs_review',message:error.message});continue;}
      const product=this.store.get('product',task.productId);
      if (product.revision!==task.productRevision) { this.updateTask(task,{status:'needs_review',message:'제품 목표나 설정이 바뀌었습니다. 최신 조건으로 다시 조사하세요.'}); continue; }
      const run=this.store.transaction(()=>{
        const current=this.store.get('task',task.id);
        if (!waitingStates.includes(current.status)) return null;
        const created=this.store.create('agent-run',{taskId:task.id,productId:task.productId,role:task.stage,owner:this.owner,status:'running',modelId:task.modelId,productRevision:task.productRevision,startedAt:new Date().toISOString(),lastSeen:new Date().toISOString(),leaseUntil:new Date(Date.now()+60000).toISOString(),turns:0,tokens:0,toolCalls:0});
        task=this.updateTask(current,{status:'running',activeRunId:created.id,message:null},`${roles[task.stage]} 시작`); return created;
      });
      if (!run) continue;
      this.active.set(task.id,{runId:run.id,...(task.stage==='check'?{controller:new AbortController()}: {})});
      void this.execute(task,run).catch(error=>{
        if (!this.closed) {
          const current=this.store.get('task',task.id),currentRun=this.store.get('agent-run',run.id);
          if (current.activeRunId===run.id) this.store.transaction(()=>{
            this.store.update('agent-run',run.id,currentRun.revision,{...currentRun,status:current.status==='stopping'?'stopped':'failed',endedAt:new Date().toISOString()});
            this.updateTask(current,{status:current.status==='stopping'?'stopped':'failed',activeRunId:null,message:current.status==='stopping'?'모델 요청 전에 실행을 중지했습니다.':`이 단계를 마치지 못했습니다. ${redact(error.message || '').slice(0,500)}`});
          });
        }
      }).finally(()=>{this.active.delete(task.id);if(!this.closed)this.store.log('실행 종료 확인',task.id);this.pump();void this.operations.tick().catch(error=>{if(!this.closed)this.store.log('운영 진행 확인 필요','runtime',redact(error.message));});});
    }
  }
  owned(runId) {
    if (this.closed) throw new Error('실행기가 종료되었습니다.');
    const run=this.store.get('agent-run',runId), task=this.store.get('task',run.taskId);
    if (run.owner!==this.owner || run.status!=='running' || task.activeRunId!==run.id || task.status!=='running') throw new Error('더 이상 이 작업을 실행할 권한이 없습니다.');
    this.operations.assertTask(task);if(task.mode==='portfolio')this.editor.assertTask(task);
    const product=this.store.get('product',task.productId);
    if (product.revision!==run.productRevision) throw new Error('제품의 현재 범위가 변경되었습니다.');
    return {run,task,product};
  }
  async tool({runId,name,args}) {
    const {run,product,task}=this.owned(runId);
    if(task.mode==='portfolio')throw new Error('포트폴리오 역할에는 소스 파일 도구를 제공하지 않습니다.');
    if (run.toolCalls>=40) throw new Error('이 단계의 도구 호출 한도에 도달했습니다.');
    if(name==='write'){this.store.update('agent-run',run.id,run.revision,{...run,toolCalls:run.toolCalls+1});return this.changes.write(runId,args);}
    const input=z.object({path:z.string().max(1024)}).strict().parse(args);
    this.store.update('agent-run',run.id,run.revision,{...run,toolCalls:run.toolCalls+1,lastSeen:new Date().toISOString()});
    if(name==='read_base') {
      if(task.mode!=='change' || !['develop','change_review'].includes(run.role))throw new Error('수정안 작성·검토 역할에서만 기준 복사본을 읽습니다.');
      const file=await readProductFile(this.changes.get(task).baseline,input.path,{maxChars:48000});this.owned(runId);
      this.store.log('수정 전 파일 확인',task.id,file.path);return {...file,snapshot:'baseline'};
    }
    const root=task.mode==='change'?this.changes.get(task).candidate:product.folder;
    if (name==='list') { const value=await listProductFiles(root,input.path); this.owned(runId); return value; }
    if (name!=='read') throw new Error('허용하지 않은 도구입니다.');
    const file=await readProductFile(root,input.path,task.mode==='change'?{maxChars:48000}:{}); this.owned(runId);
    const evidence=this.store.create('agent-evidence',{runId,taskId:run.taskId,productId:run.productId,...file,...(task.mode==='change'?{changeSetId:task.changeSetId}:{})});
    this.store.log('제품 파일 근거 저장',run.taskId,file.path);
    return {evidenceId:evidence.id,...file};
  }
  progress({runId,turns,tokens}) {
    try {
      const {run}=this.owned(runId);
      this.store.update('agent-run',run.id,run.revision,{...run,turns:Number(turns)||0,tokens:Number(tokens)||0,lastSeen:new Date().toISOString(),leaseUntil:new Date(Date.now()+60000).toISOString()});
      this.store.log('실행 진행',run.taskId,roles[run.role]);
    } catch { /* Late progress from a cancelled or retired owner cannot change work. */ }
  }
  async validateEvidence(task,run,result) {
    if(task.mode==='portfolio')return this.editor.validate(task,run,result);
    if(task.mode==='operation' && new Set(result.issues.map(i=>i.key)).size!==result.issues.length)throw new Error('중복된 문제 키입니다.');
    if(task.mode==='change')return this.changes.validate(task,run,result);
    const refs=evidenceRefs(run.role,result);
    const all=this.store.list('agent-evidence').filter(e=>e.taskId===task.id);
    const allowedRunIds=new Set([run.id,...Object.values(task.outputs).map(o=>o.runId)]);
    for (const id of new Set(refs)) {
      const evidence=all.find(e=>e.id===id && allowedRunIds.has(e.runId));
      if (!evidence) throw new Error('현재 인계에 포함되지 않은 근거를 인용했습니다.');
      const file=await readProductFile(this.store.get('product',task.productId).folder,evidence.path);
      if (file.hash!==evidence.hash) throw new Error('조사한 뒤 원본 파일이 바뀌었습니다. 최신 파일로 다시 조사하세요.');
      this.owned(run.id);
    }
    if (run.role!=='knowledge' && !all.some(e=>e.runId===run.id)) throw new Error('실제로 읽은 파일 근거가 없어 결과를 수용하지 않았습니다.');
    // A review must cover every investigation citation, even when omitted from its prose.
    if (run.role==='review') for (const id of evidenceRefs('investigate',task.outputs.investigate.result)) {
      const evidence=all.find(e=>e.id===id);
      const file=await readProductFile(this.store.get('product',task.productId).folder,evidence.path);
      if (file.hash!==evidence.hash) throw new Error('조사 원본이 바뀌었습니다. 검증을 새 기준에서 시작하세요.');
    }
  }
  async execute(task,run) {
    const product=this.store.get('product',task.productId);
    let change;
    if(task.mode==='change'){change=await this.changes.prepare(task,run);task=this.store.get('task',task.id);}
    const context=task.mode==='portfolio'?{product:{name:product.name,goal:product.goal},records:[]}:await this.prepareContext(task);
    this.owned(run.id);
    this.store.create('agent-context',{runId:run.id,taskId:task.id,context,reason:'같은 제품에서 조사 목표와 검색어가 일치한 유효 기록. 제공 사실이며 활용 확인은 아님.'});
    const handoff={outputs:task.outputs,previousAttempt:task.previousOutputs,change:change?{id:change.id,artifactHash:change.artifactHash,changes:change.changes.map(({path,beforeHash,afterHash})=>({path,beforeHash,afterHash})),omitted:change.omitted,testFiles:change.testFiles}:undefined,evidence:this.store.list('agent-evidence').filter(e=>Object.values(task.outputs).some(o=>o.runId===e.runId)).slice(0,40).map(({id,runId,path,hash,content,truncated})=>({id,runId,path,hash,content:content.slice(0,1200),truncated:truncated || content.length>1200}))};
    if(task.mode==='operation')handoff.operations=this.operations.handoff(task);
    if(task.mode==='portfolio')handoff.portfolio=this.editor.handoff(task);
    if(task.sourceTaskId){const source=this.store.get('task',task.sourceTaskId);handoff.origin={taskId:source.id,title:source.title,summary:source.outputs.investigate.result.summary,nextStep:source.outputs.investigate.result.nextStep,notice:'이전 조사 참고 자료입니다. 현재 파일은 이번 실행에서 다시 확인해야 합니다.'};}
    let response;
    try { response=run.role==='check'?await this.changes.checks(task,this.active.get(task.id).controller.signal):await this.broker.request('run',{runId:run.id,role:run.role,mode:task.mode,modelId:task.modelId,goal:task.goal,productName:product.name,agentDirectory:this.agentDirectory,handoff,context}); }
    catch(error) { response={failure:run.role==='check'?{code:'evidence',message:`수정본 검사를 마치지 못했습니다. ${redact(error.message || '').slice(0,300)}`}:{code:'interrupted',message:'Pi 실행 프로세스와 연결이 끊겼습니다. 이 단계의 근거는 보존했습니다.'}}; }
    if (this.closed) return;
    let current=this.store.get('task',task.id), currentRun=this.store.get('agent-run',run.id);
    if (current.activeRunId!==run.id) { this.store.update('agent-run',run.id,currentRun.revision,{...currentRun,status:'discarded',endedAt:new Date().toISOString()}); return; }
    if (current.status==='stopping') response={failure:{code:'cancelled',message:'실행 종료를 확인했습니다. 이 단계의 근거는 보존했습니다.'}};
    let result;
    if (!response.failure) {
      try { this.owned(run.id); result=parseResult(run.role,response.result); await this.validateEvidence(current,run,result); this.owned(run.id); }
      catch(error) { response={failure:{code:'evidence',message:`현재 제품 범위·파일 버전과 제출된 근거가 일치하지 않습니다. ${redact(error.message || '').slice(0,400)}`}}; }
    }
    current=this.store.get('task',task.id); currentRun=this.store.get('agent-run',run.id);
    if (current.status==='stopping') {result=null;response={failure:{code:'cancelled',message:'실행 종료를 확인했습니다. 이 단계의 근거는 보존했습니다.'}};}
    const statusFor={cancelled:'stopped',interrupted:'interrupted',auth:'waiting_auth',quota:'waiting_quota',evidence:'needs_review'};
    this.store.transaction(()=>{
      this.store.update('agent-run',run.id,currentRun.revision,{...currentRun,status:response.failure?'failed':'completed',result:result || null,resultHash:result?digest(JSON.stringify(result)):null,failure:response.failure || null,turns:response.turns || currentRun.turns,tokens:response.tokens || currentRun.tokens,endedAt:new Date().toISOString()});
      if (response.failure) { this.updateTask(current,{status:statusFor[response.failure.code] || 'failed',activeRunId:null,message:response.failure.message,authFailedAt:response.failure.code==='auth'?Math.max(Date.now(),this.broker.status.authenticatedAt || 0):null}); return; }
      const outputs={...current.outputs,[run.role]:{runId:run.id,result,hash:digest(JSON.stringify(result))}};
      if(current.mode==='operation'){this.updateTask(current,{outputs,activeRunId:null,status:'accepted',message:result.summary},'운영 판단 완료');return;}
      if(current.mode==='portfolio'){this.updateTask(current,{outputs,activeRunId:null,...this.editor.transition(current,run.role,result)},'대상별 편집 진행');return;}
      if(current.mode==='change'){this.updateTask(current,{outputs,activeRunId:null,...this.changes.transition(current,run.role,result)},`${roles[run.role]} 결과 저장`);return;}
      const next={investigate:'review',review:'knowledge'}[run.role];
      const rejected=run.role==='review' && result.verdict==='needs_work';
      this.updateTask(current,{outputs,activeRunId:null,stage:rejected?'investigate':next || run.role,status:rejected?'needs_review':next?'queued':'accepted',message:rejected?'근거 확인에서 보완할 점을 찾았습니다. 조사 내용과 확인 의견을 함께 보존했습니다.':null,verification:run.role==='review'&&!rejected?'source_reviewed':current.verification},`${roles[run.role]} 결과 저장`);
    });
    if(task.mode==='operation'){if(!response.failure)this.operations.materialize(this.store.get('task',task.id));return;}
    if(task.mode==='portfolio'){if(!response.failure)this.editor.materialize(this.store.get('task',task.id));return;}
    if(task.mode==='change'){if(!response.failure && run.role==='knowledge')this.changes.materialize(task.id);}
    else if (!response.failure && (run.role==='review' && result.verdict==='supported' || run.role==='knowledge')) this.materialize(task.id);
  }
  materialize(taskId) {
    let task=this.store.get('task',taskId);
    if (!task.outputs.review || task.outputs.review.result.verdict!=='supported') return;
    const investigation=task.outputs.investigate.result, review=task.outputs.review.result;
    if (!task.resultTaskId) {
      const source=this.room.reportWork({productId:task.productId,externalId:`pi:${task.id}:${task.outputs.review.hash}`,title:task.title,summary:investigation.summary,evidence:`${review.assessment}\n`+this.store.list('agent-evidence').filter(e=>e.runId===task.outputs.investigate.runId || e.runId===task.outputs.review.runId).map(e=>`${e.path} · SHA256 ${e.hash}`).join('\n').slice(0,2200),limitations:`소스 파일 조사와 별도 세션의 근거 검토 결과입니다. 코드 수정·테스트 실행·배포를 수행하지 않았습니다.\n${investigation.limitations}\n${review.limitations}`.slice(0,4000),contribution:'사용자가 목표와 읽기 범위를 지정했고, 내장 Pi 세션들이 조사·근거 검토를 수행했습니다.',checks:[{name:'인용 파일 버전 일치',result:'passed',detail:'결과 수용 시 인용한 파일의 SHA256을 앱이 다시 계산했습니다. 기능·테스트 통과를 뜻하지 않습니다.'},{name:'모델의 소스 검토',result:'unconfirmed',detail:review.assessment.slice(0,2000)}]},'pi');
      task=this.updateTask(task,{resultTaskId:source.id},'조사 결과 연결');
      const record=this.store.list('record').find(r=>r.sourceTaskId===source.id);
      if (record && !record.edited) this.store.update('record',record.id,record.revision,{...record,runtimeTaskId:task.id,evidenceIds:[...new Set(evidenceRefs('investigate',investigation).concat(review.evidenceIds))]});
    }
    if (task.outputs.knowledge && !task.knowledgeSaved) {
      this.store.transaction(()=>{
        task=this.store.get('task',task.id);
        for (const record of task.outputs.knowledge.result.records) this.store.create('record',{productId:task.productId,...record,source:'내장 Pi · 별도 근거 확인 후 정리',sourceTaskId:task.resultTaskId,runtimeTaskId:task.id,sourceRunId:task.outputs.knowledge.runId,sourceHash:task.outputs.review.hash,provenance:'reported',active:true,validity:'current'});
        this.updateTask(task,{knowledgeSaved:true},'조건부 기록 저장');
      });
    }
  }
  async prepareContext(task) {
    const product=this.store.get('product',task.productId);
    const terms=task.goal.toLowerCase().split(/[\s,。.?!]+/).filter(x=>x.length>1);
    const candidates=this.store.list('record').filter(r=>r.productId===task.productId && r.active && r.validity!=='needs_review' && terms.some(term=>`${r.title} ${r.content} ${r.scope}`.toLowerCase().includes(term))).slice(0,8);
    const records=[];
    for (const record of candidates) {
      let valid=true;
      for (const evidenceId of record.evidenceIds || []) {
        try {const evidence=this.store.get('agent-evidence',evidenceId); const file=await readProductFile(product.folder,evidence.path);if(file.hash!==evidence.hash)valid=false;}
        catch {valid=false;}
      }
      const current=this.store.get('record',record.id);
      if (current.revision!==record.revision || !current.active || current.validity==='needs_review') continue;
      if (!valid) {this.store.update('record',record.id,record.revision,{...record,validity:'needs_review',validityReason:'인용한 소스 파일이 변경되어 자동 제공을 보류했습니다.'});this.store.log('지식 근거 변경',record.id);continue;}
      records.push({id:record.id,revision:record.revision,title:record.title,content:record.content,scope:record.scope,source:record.source});
    }
    return {product:{name:product.name,goal:product.goal},records};
  }
  async shutdown() { this.closed=true; await this.stopAll(); }
}
