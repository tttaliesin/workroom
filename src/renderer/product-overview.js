import { operationOverview, operationIssues } from './operations-ui.js';
import { date, e } from './html.js';
const button = (label, action, extra = '') =>
  `<button type="button" data-action="${action}" ${extra}>${label}</button>`;
const progressStates = ['running', 'queued', 'stopping', 'applying'];
const attentionStates = [
  'needs_decision',
  'awaiting_apply',
  'check_failed',
  'changes_requested',
  'apply_partial',
  'apply_conflict',
  'needs_review',
  'failed',
  'interrupted',
  'waiting_quota',
];
const stages = {
  coordinate: '운영 판단',
  curate: '대상별 편집',
  curate_review: '주장 검토',
  investigate: '소스 조사',
  review: '근거 확인',
  develop: '수정안 작성',
  check: '수정본 검사',
  change_review: '변경 검토',
  knowledge: '기록 정리',
};
const actions = {
  needs_decision: '방침 선택',
  awaiting_apply: '변경 검토',
  check_failed: '실패한 검사 확인',
  changes_requested: '보완 의견 확인',
  apply_partial: '반영 상태 확인',
  apply_conflict: '원본 변경 확인',
  needs_review: '근거 재확인',
  failed: '중단 원인 확인',
  interrupted: '재개 검토',
  waiting_quota: '사용 한도 확인',
};
export function productOverviewData(product, data) {
  const resultIds = new Set(
    data.tasks.filter((t) => t.kind === 'agent').map((t) => t.resultTaskId),
  );
  const tasks = data.tasks
    .filter((t) => t.productId === product.id && !t.parentTaskId && !resultIds.has(t.id))
    .sort((a, b) => (b.updated || b.created).localeCompare(a.updated || a.created));
  return {
    tasks,
    attention: tasks.filter((t) => attentionStates.includes(t.status)),
    progress: tasks.filter((t) => progressStates.includes(t.status)),
    connection: tasks.filter((t) => t.status === 'waiting_auth'),
    results: tasks.filter((t) =>
      ['reported', 'completed', 'partial', 'accepted', 'decided'].includes(t.status),
    ),
    records: data.records.filter((r) => r.productId === product.id),
    portfolios: data.portfolios.filter(
      (p) =>
        p.autoProductIds?.includes(product.id) ||
        p.entries.some((x) =>
          data.tasks.some((t) => t.id === x.taskId && t.productId === product.id),
        ),
    ),
  };
}
export function taskConnections(task, data) {
  const sourceId = task.resultTaskId || task.id;
  return {
    records: data.records.filter((r) => r.sourceTaskId === sourceId || r.runtimeTaskId === task.id),
    portfolios: data.portfolios.filter((p) => p.entries.some((x) => x.taskId === sourceId)),
  };
}
function outcome(task) {
  return task.mode === 'operation'
    ? '다음 작업 판단'
    : task.mode === 'portfolio'
      ? '대상별 편집'
      : task.mode === 'change'
        ? task.appliedAt
          ? '수정 반영됨'
          : '수정안 작성'
        : task.kind === 'agent'
          ? '조사 결과'
          : task.kind === 'inspection'
            ? '폴더 점검'
            : task.kind === 'decision'
              ? '결정 기록'
              : '작업 보고';
}
function resultLinks(task, data) {
  const { records, portfolios } = taskConnections(task, data);
  return (
    [
      records.length ? `기록 ${records.length}건 연결` : null,
      portfolios.length ? `초안 ${portfolios.length}곳에 포함` : null,
    ]
      .filter(Boolean)
      .join(' · ') || '결과와 근거 저장됨'
  );
}
export function productHome(product, data, draft, otherDrafts = []) {
  if (!product)
    return `<div class="welcome-home"><p class="eyebrow">첫 제품 시작</p><h1>어떤 제품을 함께 관리할까요?</h1><p class="gap muted">개발 폴더와 목표를 연결하면 작업의 진행, 필요한 판단, 쌓인 결과를 한곳에서 확인할 수 있습니다.</p><div class="actions">${button('제품 폴더 연결', 'nav:new-product', 'class="primary"')}</div><ol class="onboarding-steps"><li><strong>폴더와 목표 연결</strong><span>관리할 제품을 정합니다.</span></li><li><strong>첫 작업 맡기기</strong><span>조사하거나 바꿀 동작을 적습니다.</span></li><li><strong>결과 확인과 축적</strong><span>검토한 결과를 기록과 소개에 연결합니다.</span></li></ol></div>`;
  const p = productOverviewData(product, data),
    runtime = data.runtime || {};
  const activeCount = p.progress.filter((t) => ['running', 'applying'].includes(t.status)).length;
  const connectionReady = runtime.modelId && ['connected', 'ready'].includes(runtime.state);
  const taskRow = (t, type) =>
    `<button type="button" class="overview-task ${type} ${t.status === 'queued' ? 'queued' : ''}" data-action="task:${t.id}"><span class="task-state-dot" aria-hidden="true"></span><span class="overview-task-copy"><strong>${e(t.title)}</strong><small>${e(type === 'attention' ? t.message || t.reason || '다음 단계에 사용자 확인이 필요합니다.' : type === 'connection' ? '계정 연결을 확인한 뒤 작업을 재개할 수 있습니다.' : type === 'progress' ? `${stages[t.stage] || '실행'} · ${t.status === 'queued' ? (runtime.paused ? '새 실행이 일시 정지되어 있습니다.' : '실행 차례를 기다립니다.') : t.status === 'stopping' ? '종료를 확인하고 있습니다.' : '앱에 마지막 저장된 진행 상태입니다.'}` : resultLinks(t, data))}</small></span><span class="overview-task-end">${e(type === 'attention' ? actions[t.status] : type === 'connection' ? '연결 대기' : type === 'progress' ? (t.status === 'queued' ? '실행 대기' : stages[t.stage] || '실행 중') : outcome(t))}<small>${e(date(t.updated || t.created))}</small></span><span aria-hidden="true">›</span></button>`;
  return `<header class="product-heading"><h1>${e(product.name)}</h1></header>
    <details class="product-goal"><summary><span class="goal-label">목표</span><span class="goal-preview">${e(product.goal || '이 제품의 목표를 정해 주세요.')}</span><span class="goal-disclosure" aria-hidden="true"></span></summary><div><p>${e(product.goal || '아직 목표를 정하지 않았습니다.')}</p>${button('목표 수정', 'nav:scope', 'class="link goal-edit"')}</div></details>
    <div class="operation-line"><span><span class="inline-dot ${activeCount ? 'active' : ''}"></span>${activeCount ? `${activeCount}개 작업 실행 중` : p.progress.length ? `${p.progress.length}개 작업 대기` : '진행 중인 작업 없음'}${runtime.paused ? ' · 새 실행 일시 정지' : ''}</span><span>${p.attention.length ? `확인할 일 ${p.attention.length}개` : '확인이 필요한 일 없음'}</span></div>
    ${!connectionReady ? `<section class="connection-strip"><div><strong>${p.connection.length ? `${p.connection.length}개 작업이 계정 연결을 기다립니다.` : runtime.failure ? '실행 연결 확인 필요' : '작업을 실행하려면 계정을 연결하세요.'}</strong><p>${e(runtime.failure?.message || '연결 전에도 요청을 작성하고 보관할 수 있습니다.')}</p></div>${button(runtime.failure ? '연결 확인' : '계정 연결', 'nav:account')}</section>` : p.connection.length ? `<p class="small muted gap">${p.connection.length}개 작업이 연결 상태 재확인을 기다립니다. ${button('계정 상태 확인', 'nav:account', 'class="link"')}</p>` : ''}
    <div class="overview-columns"><div class="overview-work">
      ${p.attention.length ? `<section class="overview-section attention-section"><div class="section-title"><h2>확인할 일 <span>${p.attention.length}</span></h2></div>${p.attention.map((t) => taskRow(t, 'attention')).join('')}</section>` : ''}
      ${p.progress.length || p.connection.length ? `<section class="overview-section progress-section"><div class="section-title"><h2>진행 중·대기 <span>${p.progress.length + p.connection.length}</span></h2></div>${p.progress.map((t) => taskRow(t, 'progress')).join('')}${p.connection.map((t) => taskRow(t, 'connection')).join('')}</section>` : ''}
      ${operationIssues(product, data)}
      <section class="overview-section results-section"><div class="section-title"><h2>최근 결과</h2>${button('전체 작업', 'nav:ops', 'class="link"')}</div>${
        p.results.length
          ? p.results
              .slice(0, 5)
              .map((t) => taskRow(t, 'result'))
              .join('')
          : `<p class="quiet-state">${p.tasks.length ? '작업이 완료되면 결과가 여기에 모입니다.' : '아직 맡긴 작업이 없습니다. 오른쪽 위에서 첫 일을 맡겨 보세요.'}</p>`
      }</section>
    </div><aside class="overview-output" aria-label="축적된 결과">
      <section class="overview-section"><div class="section-title"><h2>쌓인 기록 <span>${p.records.length}</span></h2>${button('전체', 'nav:records', 'class="link"')}</div>${
        p.records.length
          ? p.records
              .slice(0, 3)
              .map((r) => {
                const provided = (data.agentContexts || []).filter((c) =>
                  c.context.records.some((x) => x.id === r.id),
                ).length;
                return `<button class="output-item" data-action="record-detail:${r.id}"><strong>${e(r.title)}</strong><small>${r.validity === 'needs_review' ? '근거 재확인 필요' : !r.active ? '자동 참조에서 제외' : provided ? `${provided}회 실행에 제공 · 활용 여부는 별도` : '아직 내장 실행에 제공되지 않음'}</small></button>`;
              })
              .join('')
          : '<p class="quiet-state">작업의 근거와 적용 조건이 함께 쌓입니다.</p>'
      }</section>
      <section class="overview-section"><div class="section-title"><h2>포트폴리오</h2><span class="small muted">로컬 초안</span></div>${p.portfolios.length ? p.portfolios.map((f) => `<button class="output-item" data-action="target:${f.id}"><strong>${e(f.target)}</strong><small>이 제품 사례 ${f.entries.filter((x) => data.tasks.some((t) => t.id === x.taskId && t.productId === product.id)).length}개 · ${f.autoProductIds?.includes(product.id) ? '새 결과 자동 반영' : '직접 구성'}</small></button>`).join('') : `<p class="quiet-state">연결된 초안이 없습니다.</p>${button('대상 추가', 'nav:new-target', 'class="link"')}`}</section>
      ${operationOverview(product, data)}
    ${draft?.goal?.trim() ? `<div class="saved-request"><span><strong>작성하던 요청</strong><span>${e(draft.goal.slice(0, 110))}</span></span>${button('이어쓰기', 'delegate')}</div>` : ''}
    ${otherDrafts.length ? `<details class="saved-requests"><summary>보관한 다른 요청 · ${otherDrafts.length}개</summary>${otherDrafts.map(([key, request]) => `<div class="saved-request"><span>${e(request.goal)}</span>${button('이어쓰기', `request-restore:${key}`)}</div>`).join('')}</details>` : ''}
    </aside></div>`;
}

export function delegationPage(product, runtime = {}, draft = {}) {
  if (!product) return productHome(null, {}, null);
  const change = draft.mode === 'change',
    ready = runtime.modelId && ['connected', 'ready'].includes(runtime.state);
  return `<header class="request-heading"><div><h1 id="request-title">일 맡기기</h1><p>${e(product.name)}</p></div>${button('×', 'request-close', 'class="plain request-close" aria-label="초안을 보관하고 닫기" title="초안을 보관하고 닫기 (Esc)"')}</header>
    <form data-form="delegation" data-id="${product.id}" class="form delegation-form"><div class="request-fields"><div class="request-notice" role="status" aria-live="polite"></div><div><label for="request-goal">원하는 결과와 완료 기준</label><textarea id="request-goal" name="goal" required maxlength="2000" placeholder="예: 입력 중 다른 화면으로 이동해도 작성하던 내용이 유지되게 해줘.">${e(draft.goal || '')}</textarea><details class="request-product-goal"><summary>제품 목표 참고</summary><p class="small muted gap">${e(product.goal || '아직 제품의 전체 목표를 정하지 않았습니다.')}</p></details></div>
    ${draft.sourceTaskId ? `<div class="request-origin">이전 조사에서 제안한 내용을 가져왔습니다. 실행 전에 목표를 수정할 수 있습니다. ${button('조사 결과 보기', `task:${draft.sourceTaskId}`, 'class="link"')}</div>` : ''}
    <fieldset class="request-modes"><legend>작업 범위</legend><label class="request-mode ${!change ? 'selected' : ''}"><input id="request-investigation" type="radio" name="mode" value="investigation" ${!change ? 'checked' : ''}><span><strong>먼저 조사</strong><small>소스를 읽고 문제와 다음 작업을 제안합니다.</small></span></label><label class="request-mode ${change ? 'selected' : ''}"><input id="request-change" type="radio" name="mode" value="change" ${change ? 'checked' : ''}><span><strong>수정안까지 작성</strong><small>별도 복사본에서 수정·검사합니다. 원본 반영은 검토 후 결정합니다.</small></span></label></fieldset>
    <div class="request-route" aria-label="작업 진행 순서">${(change ? ['수정안 작성', '앱의 검사', '별도 검토', '내가 반영 결정'] : ['소스 조사', '별도 근거 확인', '기록 정리']).map((label, i) => `<span><b>${i + 1}</b>${label}</span>`).join('<i aria-hidden="true">→</i>')}</div>
    ${change ? `<details class="request-tests" ${draft.testFiles ? 'open' : ''}><summary>실행할 테스트 지정 <span class="muted">선택 사항</span></summary><div class="gap"><label for="request-tests">제품 폴더 기준 Node 테스트 경로 · 한 줄에 하나</label><textarea id="request-tests" name="testFiles" maxlength="8192" placeholder="tests/input.test.mjs">${e(draft.testFiles || '')}</textarea><label class="check-option"><input type="checkbox" name="allowTests" ${draft.allowTests ? 'checked' : ''}>지정한 테스트에서 제품 코드를 실행하도록 허용</label><p class="small muted">수정 전후에 같은 테스트를 실행하며 에이전트가 해당 테스트 파일을 바꾸지 못합니다. Node.js 24 이상이 필요하고 의존성은 설치하지 않습니다. 파일·프로세스를 제한하지만 완전한 OS·네트워크 격리는 아닙니다.</p></div></details><p class="small muted">테스트를 지정하지 않으면 JavaScript·JSON 구문 검사와 소스 검토를 진행하고, 기능 테스트는 미확인으로 남깁니다.</p>` : ''}
    </div><div class="request-footer"><div class="request-connection" id="request-connection"><span class="inline-dot ${ready ? 'active' : ''}"></span><div><strong>${ready ? `실행 연결 준비됨 · ${e(runtime.modelId)}` : '계정과 모델 연결이 필요합니다.'}</strong><p>${ready ? (runtime.paused ? '새 실행이 일시 정지되어 있어 대기열에 보관합니다.' : '선택한 모델에 요청·관련 기록·읽은 소스가 전달됩니다.') : '연결 설정을 마친 뒤 이 요청으로 돌아옵니다. 초안은 보관됩니다.'}</p></div>${!ready ? button('연결 설정', 'nav:account') : ''}</div>
    <div class="request-submit"><span class="small muted request-save-state">${draft.goal?.trim() ? '보관한 초안 · 이 기기에 자동 저장' : '입력한 내용은 이 기기에 자동 저장'}</span>${button('닫기', 'request-close', 'class="plain"')}<button type="submit" class="primary" ${!ready ? 'disabled aria-describedby="request-connection"' : ''}>일 맡기기</button></div></div></form>`;
}

export function taskJourney(task) {
  const change = task.mode === 'change';
  const steps = change
    ? [
        ['develop', '수정안'],
        ['check', '검사'],
        ['change_review', '별도 검토'],
        ['apply', '반영'],
        ['knowledge', '기록'],
      ]
    : [
        ['investigate', '조사'],
        ['review', '근거 확인'],
        ['knowledge', '기록'],
      ];
  return `<ol class="task-journey" aria-label="작업 진행 단계">${steps
    .map(([key, label]) => {
      const done =
        key === 'apply'
          ? !!task.appliedAt
          : !!task.outputs?.[key] &&
            (key !== 'check' || task.outputs[key].result.status !== 'failed') &&
            (!['review', 'change_review'].includes(key) ||
              task.outputs[key].result.verdict === 'supported');
      const current =
        (key === task.stage && !done) ||
        (key === 'apply' &&
          ['awaiting_apply', 'apply_partial', 'apply_conflict', 'applying'].includes(task.status));
      return `<li class="${done ? 'done' : current ? 'current' : ''}" ${current ? 'aria-current="step"' : ''}><span aria-hidden="true">${done ? '✓' : '•'}</span>${label}<span class="sr-only">${done ? '완료' : current ? '현재 단계' : '대기'}</span></li>`;
    })
    .join('')}</ol>`;
}
export function connectedOutcome(task, data) {
  if (!task.resultTaskId) return '';
  const c = taskConnections(task, data);
  return `<section class="connected-outcome"><h2>이 결과가 이어진 곳</h2><div>${button(`작업 결과 · ${c.records.length}개 기록 연결`, `task:${task.resultTaskId}`, 'class="plain"')}${c.portfolios.map((p) => button(e(p.target) + ' 초안', `target:${p.id}`, 'class="plain"')).join('') || button('포트폴리오에 활용', `task-portfolio:${task.resultTaskId}`, 'class="plain"')}</div><p class="small muted">기록 제공과 초안 반영은 실제 활용 효과·웹 공개와 구분합니다.</p></section>`;
}
