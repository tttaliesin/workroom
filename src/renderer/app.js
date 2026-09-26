import { operationSettings, portfolioAgentPanel } from './operations-ui.js';
import { mergeDraft } from './merge-draft.js';
import { projectWork, workReports } from '../core/work-projection.mjs';
import { accountLabel, accountPage, agentDetail, agentLabels } from './runtime-ui.js';
import { productHome, delegationPage } from './product-overview.js';
const app = document.getElementById('app');
const e = (x) =>
  String(x ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const ui = {
  view: 'home',
  productId: null,
  taskId: null,
  portfolioId: null,
  draft: null,
  dirty: false,
  formDirty: false,
  resetForm: false,
  message: '',
  error: false,
  busy: false,
  query: '',
  connection: null,
  review: false,
  editing: false,
  fromTaskId: null,
  relatedOpen: false,
  source: null,
  taskQuery: '',
  listOpen: false,
  sourceScroll: 0,
  restoreScroll: null,
};
Object.assign(ui, {
  history: [],
  locations: {},
  lastTasks: {},
  lastQueries: {},
  recordId: null,
  linkTaskId: null,
  linkParent: '',
  linkBase: null,
  requestOpen: false,
  requestOrigin: null,
  requestFocus: null,
});
let data = { products: [], tasks: [], records: [], portfolios: [], audit: [] };
try {
  const saved = JSON.parse(localStorage.getItem('workroom-navigation') || 'null');
  if (saved && ['home', 'ops', 'portfolio', 'scope', 'product', 'records'].includes(saved.view)) {
    for (const key of ['productId', 'taskId', 'portfolioId', 'taskQuery'])
      if (typeof saved[key] === 'string') ui[key] = saved[key];
    for (const key of ['lastTasks', 'lastQueries'])
      if (saved[key] && typeof saved[key] === 'object') ui[key] = saved[key];
  }
} catch {
  /* A missing or unreadable local preference never blocks stored work. */
}

try {
  ui.requests = JSON.parse(localStorage.getItem('workroom-requests') || '{}');
  if (!ui.requests || typeof ui.requests !== 'object') ui.requests = {};
} catch {
  ui.requests = {};
}
try {
  ui.accountReturn = JSON.parse(sessionStorage.getItem('workroom-account-return') || 'null');
} catch {}
try {
  ui.requestOrigin = JSON.parse(sessionStorage.getItem('workroom-request-origin') || 'null');
} catch {}
function requestDraft() {
  return (
    ui.requests[ui.productId] || {
      mode: 'investigation',
      goal: '',
      testFiles: '',
      allowTests: false,
    }
  );
}
function persistRequests() {
  try {
    localStorage.setItem('workroom-requests', JSON.stringify(ui.requests));
    ui.requestSaveFailed = false;
  } catch {
    ui.requestSaveFailed = true;
    ui.formDirty = true;
  }
}
function rememberRequest(form) {
  const values = Object.fromEntries(new FormData(form)),
    previous = requestDraft();
  ui.requests[form.dataset.id] = {
    ...previous,
    goal: values.goal || '',
    mode: values.mode || previous.mode,
    testFiles: values.testFiles ?? previous.testFiles ?? '',
    allowTests: values.mode === 'change' ? !!values.allowTests : !!previous.allowTests,
  };
  persistRequests();
  if (!ui.requestSaveFailed) ui.formDirty = false;
  const status = form.querySelector('.request-save-state');
  if (status) {
    status.textContent = ui.requestSaveFailed
      ? '초안 저장 실패 · 이 창에서 다시 시도하세요.'
      : '초안 자동 저장됨';
    status.classList.toggle('inline-error', !!ui.requestSaveFailed);
  }
}
function startRequest(mode, source) {
  if (!canLeave()) return;
  const p = product();
  if (!p) {
    go('new-product');
    return;
  }
  rememberLocation();
  ui.requestOrigin = {
    view: ui.view,
    productId: ui.productId,
    taskId: ui.taskId,
    recordId: ui.recordId,
    source: ui.source,
    listOpen: ui.listOpen,
  };
  ui.requestFocus = document.activeElement?.dataset.action || 'delegate';
  sessionStorage.setItem('workroom-request-origin', JSON.stringify(ui.requestOrigin));
  if (source) {
    const previous = requestDraft();
    if (previous.goal?.trim()) ui.requests[`${p.id}@${crypto.randomUUID()}`] = { ...previous };
    const result = source.outputs?.investigate?.result;
    ui.requests[p.id] = {
      mode: 'change',
      goal: (result?.nextStep || source.goal || source.title).slice(0, 2000),
      testFiles: '',
      allowTests: false,
      sourceTaskId: source.id,
    };
  } else if (mode) ui.requests[p.id] = { ...requestDraft(), mode };
  ui.productId = p.id;
  persistRequests();
  ui.requestOpen = true;
  ui.requestJustOpened = true;
  ui.message = '';
}
function closeRequest() {
  if (ui.busy) return;
  const form = app.querySelector('form[data-form="delegation"]');
  if (form) rememberRequest(form);
  if (ui.requestSaveFailed) {
    flash('요청 초안을 보관하지 못했습니다. 입력을 유지하고 다시 시도해 주세요.', true);
    render();
    return;
  }
  ui.requestOpen = false;
  ui.formDirty = false;
  ui.message = '';
  render();
  [...app.querySelectorAll('[data-action]')]
    .find((b) => b.dataset.action === ui.requestFocus)
    ?.focus({ preventScroll: true });
}
function returnToRequest() {
  const productId = ui.accountReturn || ui.productId;
  if (ui.requestOrigin?.productId === productId && data.products.some((p) => p.id === productId))
    Object.assign(ui, ui.requestOrigin);
  else {
    ui.productId = productId;
    ui.view = 'home';
  }
  ui.accountReturn = null;
  sessionStorage.removeItem('workroom-account-return');
  ui.formDirty = false;
  ui.requestOpen = true;
  ui.requestJustOpened = true;
}
function accountReturnNotice() {
  const pending = ui.accountReturn && data.products.find((p) => p.id === ui.accountReturn),
    draft = pending && ui.requests[pending.id];
  if (!pending || !draft) return '';
  return `<section class="connection-return"><p class="eyebrow">작성하던 요청으로 이어집니다</p><strong>${e(draft.goal.slice(0, 150) || pending.name)}</strong><p class="small muted gap">계정 연결과 모델 저장을 마치면 이 요청으로 돌아갑니다. 실행은 요청 화면에서 결정합니다.</p><div class="setup-progress"><span class="${data.runtime?.connected ? 'done' : ''}">${data.runtime?.connected ? '✓' : '1'} 계정 연결</span><span class="${data.runtime?.modelId ? 'done' : ''}">${data.runtime?.modelId ? '✓' : '2'} 모델 저장</span></div>${button('요청으로 돌아가기', 'delegate-return', 'class="plain"')}</section>`;
}
function restoreRequestAfterSetup() {
  if (
    ui.view === 'account' &&
    ui.accountReturn &&
    data.runtime?.modelId &&
    ['connected', 'ready'].includes(data.runtime.state) &&
    data.products.some((p) => p.id === ui.accountReturn)
  ) {
    returnToRequest();
    flash('연결을 준비했습니다. 보관한 요청을 확인한 뒤 맡겨주세요.');
  }
}
const hasTaskPane = () => data.products.length > 0 && (ui.view === 'ops' || portfolioArea());
function workspaceNavigation() {
  if (['account', 'connection', 'new-product'].includes(ui.view))
    return `<span class="view-label">${{ account: '계정과 실행', connection: '외부 도구 연결', 'new-product': '제품 연결' }[ui.view]}</span>`;
  if (portfolioArea()) return '<span class="view-label">포트폴리오 · 대상별 소개</span>';
  const routes = {
    home: ['home'],
    ops: ['ops', 'new-work', 'new-decision', 'work-link'],
    records: ['records', 'record-detail', 'new-record'],
    scope: ['scope', 'product'],
  };
  return `<nav class="product-tabs" aria-label="제품 화면">${[
    ['home', '개요'],
    ['ops', '작업'],
    ['records', '기록'],
    ['scope', '설정'],
  ]
    .map(([route, label]) =>
      button(
        label,
        `nav:${route}`,
        `class="plain" ${routes[route].includes(ui.view) ? 'aria-current="page"' : ''}`,
      ),
    )
    .join('')}</nav>`;
}
function workspaceToolbar() {
  const canDelegate =
    product() && ['home', 'ops', 'records', 'record-detail', 'scope', 'product'].includes(ui.view);
  return `<div class="workspace-toolbar">${workspaceNavigation()}<div class="toolbar-actions">${ui.history.length ? button('←', 'return-location', 'class="plain history-back" aria-label="이전 화면으로 돌아가기" title="이전 화면으로 돌아가기"') : ''}${hasTaskPane() ? button(`${icon('list')}<span>${ui.listOpen ? '상세 보기' : portfolioArea() ? '대상 목록' : '작업 목록'}</span>`, 'toggle-list', `class="plain list-toggle" aria-expanded="${!!ui.listOpen}"`) : ''}${canDelegate ? button('일 맡기기', 'delegate', 'class="primary toolbar-delegate delegate-primary"') : ''}</div></div>`;
}

const labels = {
  needs_decision: '판단 필요',
  deferred: '보류',
  decided: '결정 기록됨',
  completed: '점검 완료',
  partial: '점검 완료 · 일부 미확인',
  reported: '결과 보고 · 독립 검증 없음',
};
Object.assign(labels, agentLabels);
const actorLabel = (actor) =>
  ({ mcp: 'MCP 에이전트', 'codex-hook': 'Codex 자동 수집', pi: '내장 Pi', user: '사용자' })[
    actor
  ] || '보고자';
const provenance = { observed: '앱이 관찰', reported: '보고된 내용', user: '사용자 기록' };
const date = (value) =>
  new Date(value).toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const button = (label, action, options = '') =>
  `<button type="button" data-action="${action}" ${options}>${label}</button>`;
const productName = (id) => data.products.find((p) => p.id === id)?.name || '제품';
const product = () => data.products.find((p) => p.id === ui.productId) || data.products[0];
const header = (title, subtitle, action = '') =>
  `<header class="heading row between"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div>${action}</header>`;
const field = (id, label, value = '', type = 'input', extra = '') =>
  `<div><label for="${id}">${label}</label>${type === 'textarea' ? `<textarea id="${id}" name="${id}" ${extra}>${e(value)}</textarea>` : `<input id="${id}" name="${id}" value="${e(value)}" ${extra}>`}</div>`;
const empty = (heading, content) =>
  `<div class="empty"><h2>${heading}</h2><p class="muted gap">${content}</p></div>`;
async function call(method, args = {}) {
  const response = await window.workroom.call(method, args);
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
function flash(message, error = false) {
  ui.message = message;
  ui.error = error;
}
function pendingMessage() {
  return ui.review
    ? '새 기록이 도착했습니다. 검토 중인 내용은 유지하며, 검토를 닫으면 반영합니다.'
    : '새 기록이 도착했습니다. 입력은 저장 후 함께 반영됩니다.';
}
const rootTasks = () => {
  const results = new Set(data.tasks.filter((t) => t.kind === 'agent').map((t) => t.resultTaskId));
  return data.tasks.filter((t) => !t.parentTaskId && !results.has(t.id));
};
async function runtimeCall(method, args = {}) {
  const response = await window.workroom.runtime(method, args);
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
const portfolioArea = () => ['portfolio', 'new-target'].includes(ui.view);
function rememberLocation() {
  if (ui.productId && ui.taskId && !portfolioArea()) {
    ui.lastTasks[ui.productId] = ui.taskId;
    ui.lastQueries[ui.productId] = ui.taskQuery;
  }
  const key = app.querySelector('.main')?.dataset.location || locationKey();
  ui.locations[key] = {
    scroll: app.querySelector('.main')?.scrollTop || 0,
    list: app.querySelector('.tasknav')?.scrollTop || 0,
    expanded: [...app.querySelectorAll('details[open]')].map(
      (d) => d.querySelector('summary')?.textContent,
    ),
  };
}
const locationKey = () =>
  `${ui.view}:${ui.productId}:${ui.taskId}:${ui.portfolioId}:${ui.recordId}:${ui.source}:${ui.editing}`;
function pushLocation() {
  rememberLocation();
  ui.history.push({
    view: ui.view,
    productId: ui.productId,
    taskId: ui.taskId,
    portfolioId: ui.portfolioId,
    source: ui.source,
    fromTaskId: ui.fromTaskId,
    recordId: ui.recordId,
    taskQuery: ui.taskQuery,
    editing: ui.editing,
    relatedOpen: ui.relatedOpen,
  });
}
function returnLocation() {
  if (!canLeave()) return;
  const previous = ui.history.pop();
  if (!previous) return;
  rememberLocation();
  Object.assign(ui, previous);
  if (ui.view === 'portfolio') loadDraft(ui.portfolioId);
  ui.review = false;
  ui.listOpen = false;
}
function applySnapshot(next) {
  data = next;
  ui.externalPending = false;
  if (!data.products.some((p) => p.id === ui.productId)) ui.productId = data.products[0]?.id;
  if (!data.tasks.some((t) => t.id === ui.taskId && t.productId === ui.productId))
    ui.taskId =
      rootTasks().find((t) => t.productId === ui.productId && t.status === 'needs_decision')?.id ||
      rootTasks().find((t) => t.productId === ui.productId)?.id;
}
async function refresh() {
  applySnapshot(await call('snapshot'));
  restoreRequestAfterSetup();
}
function canLeave() {
  if (!ui.dirty && !ui.formDirty) return true;
  flash('작성 중인 내용이 있습니다. 먼저 저장하거나 수정 취소를 선택하세요.', true);
  return false;
}
function go(view) {
  if (!canLeave()) return false;
  rememberLocation();
  ui.requestOpen = false;
  ui.view = view;
  ui.review = false;
  ui.source = null;
  ui.message = '';
  return true;
}
const icons = {
  product: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16M10 10v10"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 14h8M8 17h5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  failed: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
  pending: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  page: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 13h5M7 16h9"/>',
  connection: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',
};
const icon = (name) =>
  `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.pending}</svg>`;
const shortStatus = {
  reported: '보고됨',
  completed: '점검 완료',
  partial: '일부 미확인',
  needs_decision: '판단 필요',
  deferred: '보류',
  decided: '결정됨',
};
Object.assign(shortStatus, agentLabels);
function taskNav(p) {
  return button(
    `${icon('product')}<span>${e(p.name)}</span>`,
    `product:${p.id}`,
    `class="product-button" ${ui.productId === p.id && !portfolioArea() ? 'aria-current="page"' : ''}`,
  );
}
function waitingDecisions() {
  return rootTasks().filter((t) => t.productId === ui.productId && t.status === 'needs_decision');
}
function observation(p) {
  const connection = (data.captureConnections || []).find((c) => c.productId === p.id);
  const received = data.tasks
    .filter((t) => t.productId === p.id && ['work', 'inspection'].includes(t.kind))
    .sort((a, b) => b.created.localeCompare(a.created))[0];
  if (connection?.lastReceivedAt && (!received || connection.lastReceivedAt >= received.created))
    return `마지막 자동 수집 · ${date(connection.lastReceivedAt)}`;
  if (received)
    return `${received.kind === 'work' ? '최근 보고 등록' : '마지막 폴더 점검'} · ${date(received.created)}`;
  return p.codexCaptureEnabled ? '설정됨 · 첫 수집 미확인' : '아직 받은 작업 보고 없음';
}
function taskRows() {
  const tasks = rootTasks().filter(
    (t) =>
      t.productId === ui.productId && t.title.toLowerCase().includes(ui.taskQuery.toLowerCase()),
  );
  const row = (t) =>
    button(
      `<span class="task-line">${icon(t.status === 'needs_decision' || (t.kind === 'agent' && t.status !== 'accepted') ? 'pending' : t.kind === 'work' ? 'file' : 'check')}<span class="task-name">${e(t.title)}</span></span><span class="task-meta"><span>${e(t.mode === 'change' && t.status === 'accepted' ? '반영·기록 완료' : shortStatus[t.status] || t.status)}</span><time>${e(date(t.updated || t.created))}</time></span>`,
      `task:${t.id}`,
      ui.taskId === t.id && ui.view === 'ops' ? 'aria-current="page"' : '',
    );
  if (!tasks.length)
    return `<p class="navempty">${ui.taskQuery ? '일치하는 작업이 없습니다.' : '아직 작업이 없습니다.'}</p>`;
  return [
    ['진행 중', (t) => ['running', 'queued', 'stopping', 'applying'].includes(t.status)],
    [
      '판단·복구 대기',
      (t) =>
        [
          'needs_decision',
          'waiting_auth',
          'waiting_quota',
          'interrupted',
          'failed',
          'needs_review',
          'check_failed',
          'changes_requested',
          'awaiting_apply',
          'apply_conflict',
          'apply_partial',
        ].includes(t.status),
    ],
    ['보류한 판단', (t) => t.status === 'deferred'],
    [
      '작업과 결과',
      (t) =>
        ![
          'running',
          'queued',
          'stopping',
          'applying',
          'needs_decision',
          'waiting_auth',
          'waiting_quota',
          'interrupted',
          'failed',
          'needs_review',
          'check_failed',
          'changes_requested',
          'awaiting_apply',
          'apply_conflict',
          'apply_partial',
          'deferred',
        ].includes(t.status),
    ],
  ]
    .map(([label, matches]) => {
      const group = tasks.filter(matches);
      return group.length
        ? `<div class="task-group"><h3>${label}<span>${group.length}</span></h3>${group.map(row).join('')}</div>`
        : '';
    })
    .join('');
}
function attentionLink(className = '') {
  const waiting = waitingDecisions();
  return waiting.length
    ? button(
        `판단 대기 ${waiting.length}건 →`,
        `task:${waiting[0].id}`,
        `class="plain attention-link ${className}"`,
      )
    : '';
}
function taskPane() {
  if (portfolioArea())
    return `<section class="taskpane" aria-label="대상 탐색"><div class="pane-heading"><h2>지원 대상</h2>${button('상세로 돌아가기', 'toggle-list', 'class="plain list-toggle"')}</div><nav class="tasknav" aria-label="포트폴리오 대상">${data.portfolios.map((p) => button(`<span class="task-name">${e(p.target)}</span><span class="task-meta">${p.entries.length}개 사례 · 로컬 초안</span>`, `target:${p.id}`, ui.portfolioId === p.id ? 'aria-current="page"' : '')).join('') || '<p class="navempty">아직 대상이 없습니다.</p>'}</nav><div class="pane-footer">${button('대상 추가', 'nav:new-target', 'class="plain"')}</div></section>`;
  return `<section class="taskpane" aria-label="작업 탐색"><div class="pane-heading"><h2>모든 작업</h2></div><div class="task-search"><input id="task-query" aria-label="작업 검색" placeholder="작업 검색…" value="${e(ui.taskQuery)}"></div><nav class="tasknav" aria-label="작업 목록">${taskRows()}</nav><div class="pane-footer"><p class="observation small muted">${product() ? e(observation(product())) : ''}</p></div></section>`;
}
function crumb() {
  return '';
}
function artifact(t) {
  const targets = data.portfolios.filter((p) => p.entries.some((x) => x.taskId === t.id));
  return `<section class="artifact-section"><h2>포트폴리오</h2><div class="artifact-row">${icon('page')}<div><strong>${e(targets.map((p) => p.target).join(', ') || '이 작업을 사례로 활용')}</strong><p>${targets.length ? '로컬 초안에 포함됨 · 웹 미공개' : '저장한 작업에서 대상별 소개를 작성합니다.'}</p></div>${button('초안 열기 →', `task-portfolio:${t.id}`, 'class="plain artifact-open" aria-label="포트폴리오 초안 보기"')}</div></section>`;
}
function relatedRecords(t) {
  const records = data.records.filter((r) => r.sourceTaskId === t.id);
  return `<details class="related" data-related ${ui.relatedOpen ? 'open' : ''}><summary>관련 기록${records.length ? ` · ${records.length}` : ''}</summary>${records.length ? records.map((r) => `<article class="record"><h3>${e(r.title)}</h3><p class="small muted gap">적용: ${e(r.scope)} · ${e(provenance[r.provenance])}</p><p class="gap">${e(r.content)}</p><div class="row gap">${button(r.active ? '자동 참조에서 제외' : '다시 포함', `record-toggle:${r.id}`)}<span class="small muted">${r.active ? 'MCP 조회에 포함' : 'MCP 조회에서 제외'}</span></div></article>`).join('') : '<p class="muted gap">이 작업에 연결된 기록이 없습니다.</p>'}</details>`;
}
function productSelect(name = 'productId') {
  return `<div><label for="${name}">제품</label><select name="${name}" id="${name}">${data.products.map((p) => `<option value="${p.id}" ${p.id === ui.productId ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select></div>`;
}
function render() {
  ui.rendering = true;
  const oldMain = app.querySelector('.main');
  const oldLocation = oldMain?.dataset.location;
  const scrollTop = oldMain?.scrollTop || 0;
  const taskScroll = app.querySelector('.tasknav')?.scrollTop || 0;
  const expanded = [...app.querySelectorAll('details[open]')].map(
    (d) => d.querySelector('summary')?.textContent,
  );
  const oldRequestScroll = app.querySelector('.request-fields')?.scrollTop || 0;
  const formSnapshots = [
    ...app.querySelectorAll('form[data-form]:not([data-form="delegation"])'),
  ].map((form) => ({
    name: form.dataset.form,
    id: form.dataset.id,
    fields: [...form.elements]
      .filter((field) => field.name && field.type !== 'file')
      .map((field) => ({
        name: field.name,
        type: field.type,
        value: field.value,
        checked: field.checked,
      })),
  }));
  const oldForm =
    app.querySelector('form[data-form="delegation"]') || app.querySelector('form[data-form]');
  const formName = oldForm?.dataset.form;
  const old = document.activeElement;
  const focusId = app.contains(old) ? old.id : null;
  const focusAction = app.contains(old) ? old.dataset.action : null;
  app.innerHTML = `<header class="appbar"><strong><img class="app-mark" src="../desktop/assets/workroom.svg" width="18" height="18" alt="" aria-hidden="true">작업실</strong><div class="row">${button(e(accountLabel(data.runtime)), 'nav:account', 'class="plain"')}${button('새로고침', 'refresh', `class="plain" ${ui.busy ? 'disabled' : ''}`)}</div></header>
    <div class="shell ${hasTaskPane() ? 'with-taskpane' : 'overview-shell'} ${ui.listOpen ? 'show-list' : ''} ${data.products.length ? '' : 'no-products'}">
      <aside class="sidebar"><div class="nav-label">내 제품</div><nav class="products" aria-label="등록한 제품">${data.products.map(taskNav).join('')}</nav><nav class="portfolio-nav" aria-label="포트폴리오 탐색">${button(`${icon('page')}<span>포트폴리오</span>`, 'open-portfolio', portfolioArea() ? 'aria-current="page"' : '')}</nav><nav class="bottom" aria-label="앱 설정">${button('<span aria-hidden="true">＋</span><span>제품 등록</span>', 'nav:new-product', 'aria-label="+ 제품 등록"')}${button(`${icon('connection')}<span>MCP 연결</span>`, 'nav:connection', ui.view === 'connection' ? 'aria-current="page"' : '')}</nav></aside>
      <div class="workspace">${workspaceToolbar()}<div class="workspace-body">${hasTaskPane() ? taskPane() : ''}
        <main class="main ${ui.view === 'home' ? 'overview-main' : ui.view === 'delegate' ? 'request-main' : ''}"><div class="content ${ui.view === 'home' ? 'overview-content' : ''}"><div class="sync-notice small muted" role="status">${ui.externalPending ? pendingMessage() : ''}</div><div class="message" role="status" aria-live="polite">${ui.message ? `<div class="notice ${ui.error ? 'error' : ''}">${e(ui.message)}</div>` : ''}</div>${view()}</div></main>
      </div></div>
    </div>${ui.requestOpen ? `<dialog class="request-dialog" aria-labelledby="request-title">${delegationPage(product(), data.runtime, requestDraft())}</dialog>` : ''}`;
  const newForm =
    app.querySelector('form[data-form="delegation"]') || app.querySelector('form[data-form]');
  const newMain = app.querySelector('.main');
  newMain.dataset.location = locationKey();
  if (oldLocation === newMain.dataset.location) {
    app.querySelectorAll('details').forEach((d) => {
      if (expanded.includes(d.querySelector('summary')?.textContent)) d.open = true;
    });
    newMain.scrollTop = scrollTop;
  }
  const restored =
    oldLocation !== newMain.dataset.location && ui.locations[newMain.dataset.location];
  if (restored) {
    newMain.scrollTop = restored.scroll;
    app.querySelectorAll('details').forEach((d) => {
      if (restored.expanded.includes(d.querySelector('summary')?.textContent)) d.open = true;
    });
  }
  if (ui.restoreExpanded) {
    app.querySelectorAll('details').forEach((d) => {
      if (ui.restoreExpanded.includes(d.querySelector('summary')?.textContent)) d.open = true;
    });
    ui.restoreExpanded = null;
  }
  if (ui.restoreScroll !== null) {
    newMain.scrollTop = ui.restoreScroll;
    ui.restoreScroll = null;
  }
  const taskList = app.querySelector('.tasknav');
  if (taskList) taskList.scrollTop = restored ? restored.list : taskScroll;
  if (!ui.resetForm && oldLocation === newMain.dataset.location)
    for (const snapshot of formSnapshots) {
      const form = [...app.querySelectorAll('form[data-form]')].find(
        (form) => form.dataset.form === snapshot.name && form.dataset.id === snapshot.id,
      );
      if (!form) continue;
      for (const saved of snapshot.fields) {
        const field = [...form.elements].find(
          (field) =>
            field.name === saved.name && (saved.type !== 'radio' || field.value === saved.value),
        );
        if (!field) continue;
        if (['checkbox', 'radio'].includes(saved.type)) field.checked = saved.checked;
        else field.value = saved.value;
      }
    }
  ui.resetForm = false;
  if (ui.formDirty && newForm && formName !== 'delegation') {
    const unsaved = document.createElement('div');
    unsaved.className = 'notice row between';
    unsaved.innerHTML =
      '<span>저장하지 않은 입력이 있습니다.</span>' + button('수정 취소', 'discard-form');
    newForm.before(unsaved);
  }
  if (ui.requestOpen) {
    const dialog = app.querySelector('.request-dialog');
    dialog.showModal();
    dialog.querySelector('.request-fields').scrollTop = oldRequestScroll;
    const notice = dialog.querySelector('.request-notice');
    if (ui.message)
      notice.innerHTML = `<div class="notice ${ui.error ? 'error' : ''}">${e(ui.message)}</div>`;
  }
  if (ui.busy)
    app
      .querySelectorAll(
        'button[type=submit],button[data-action^="inspect:"],.request-dialog button[data-action]',
      )
      .forEach((b) => {
        b.disabled = true;
      });
  if (focusId && document.getElementById(focusId))
    document.getElementById(focusId).focus({ preventScroll: true });
  else if (focusAction)
    [...app.querySelectorAll('[data-action]')]
      .find((b) => b.dataset.action === focusAction)
      ?.focus({ preventScroll: true });
  if (ui.requestJustOpened) {
    document.getElementById('request-goal')?.focus({ preventScroll: true });
    ui.requestJustOpened = false;
  }
  ui.rendering = false;
  try {
    if (['home', 'ops', 'portfolio', 'scope', 'product', 'records'].includes(ui.view))
      localStorage.setItem(
        'workroom-navigation',
        JSON.stringify({
          view: ui.view,
          productId: ui.productId,
          taskId: ui.taskId,
          portfolioId: ui.portfolioId,
          taskQuery: ui.taskQuery,
          lastTasks: ui.lastTasks,
          lastQueries: ui.lastQueries,
        }),
      );
  } catch {}
}
function view() {
  switch (ui.view) {
    case 'home':
      return productHome(
        product(),
        data,
        requestDraft(),
        Object.entries(ui.requests).filter(([key]) => key.startsWith(ui.productId + '@')),
      );
    case 'account':
      return accountReturnNotice() + accountPage(data.runtime);
    case 'scope':
      return scopePage();
    case 'record-detail':
      return recordDetailPage();
    case 'work-link':
      return linkPage();
    case 'new-product':
      return newProduct();
    case 'product':
      return productPage();
    case 'records':
      return recordsPage();
    case 'new-record':
      return newRecord();
    case 'new-work':
      return newWork();
    case 'new-decision':
      return newDecision();
    case 'new-target':
      return newTarget();
    case 'portfolio':
      return portfolioPage();
    case 'connection':
      return connectionPage();
    default:
      return operations();
  }
}
function newProduct() {
  return (
    header('함께 관리할 제품', '개발 폴더와 이루려는 목표를 연결합니다.') +
    `<form data-form="product" class="form">${field('name', '제품 이름', '', 'input', 'required maxlength="100"')}${field('folder', '제품 폴더', '', 'input', 'required readonly placeholder="폴더 선택 버튼으로 연결"')}<div>${button('폴더 선택', 'folder')}</div>${field('goal', '지금 이 제품에서 이루고 싶은 것', '', 'textarea', 'maxlength="2000" placeholder="예: 가져오기와 검색 기능 안정화"')}<div class="actions"><button class="primary" type="submit">제품 등록</button>${button('돌아가기', 'nav:ops', 'class="plain"')}</div></form>`
  );
}
function operations() {
  if (!data.products.length)
    return `<div class="empty"><h1>제품 폴더 연결</h1><p class="muted gap">개발 중인 제품의 폴더를 선택하세요. 점검과 에이전트가 보고한 작업을 제품별로 모아 볼 수 있습니다.</p><div class="actions">${button('첫 제품 등록', 'nav:new-product', 'class="primary"')}</div></div>`;
  const selected = data.tasks.find((t) => t.id === ui.taskId && t.productId === ui.productId);
  return selected
    ? `<section class="detail" aria-label="작업 상세">${taskDetail(selected)}</section>`
    : productWelcome();
}
function taskDetail(t) {
  if (t.kind === 'agent') return agentDetail(t, data);
  const base = crumb(t) + header(t.title, `${labels[t.status]} · ${date(t.created)}`, '');
  if (t.kind === 'decision')
    return (
      base +
      `<p>${e(t.reason)}</p>${t.status === 'decided' ? `<div class="note"><h2>${e(t.options[t.selected].label)}</h2><p>${e(t.options[t.selected].effect)}</p></div><p class="muted small gap">결정이 기록되었습니다. 연결된 에이전트가 다음 조회에서 확인할 수 있습니다. 자동 실행 재개는 아직 연결되지 않았습니다.</p>${relatedRecords(t)}` : `<form data-form="decision" data-id="${t.id}"><fieldset><legend>적용할 방침</legend>${t.options.map((o, i) => `<label class="choice"><input type="radio" name="option" value="${i}" required><span>${e(o.label)}<span class="small muted">${e(o.effect)}</span></span></label>`).join('')}</fieldset><div class="actions"><button type="submit" class="primary">결정 저장</button>${button(t.status === 'deferred' ? '보류 해제' : '보류', `defer:${t.id}`)}</div></form>`}`
    );
  if (t.kind === 'inspection')
    return (
      base +
      `<p>폴더에서 직접 확인한 내용입니다. 코드 수정과 테스트 실행은 포함하지 않습니다.</p><section class="section"><h2>점검 결과</h2><dl>${t.result.observations.map((x) => `<div class="fact"><dt>${e(x.label)}</dt><dd>${e(x.value)}</dd></div>`).join('')}</dl>${inspectionSummary(t.result)}</section><details><summary>점검 범위와 한계</summary>${t.result.limits.map((x) => `<p class="small muted gap">${e(x)}</p>`).join('')}</details>${relatedRecords(t)}`
    );
  if (ui.source) {
    t = projectWork(t, data.tasks);
    const file = ui.source === 'evidence' ? null : (t.changedFiles || [])[Number(ui.source)];
    return `${crumb(t)}${button(ui.evidenceReturn === 'portfolio' ? '← 포트폴리오 초안' : '← 작업으로 돌아가기', 'source-close', 'class="link back"')}${header(file ? '변경 내용' : '실행 근거', t.title)}${file ? `<div class="note"><code>${e(file.path)}</code><p class="gap">${e(file.summary)}</p></div><p class="small muted gap">보고자가 제공한 변경 설명입니다. 원본 diff를 자동 수집한 결과는 아닙니다.</p>` : `<section class="section"><h2>보고된 근거</h2><p class="gap">${e(t.evidence)}</p></section><section class="section"><h2>확인하지 못한 범위</h2><p class="gap">${e(t.limitations)}</p></section><section class="section"><h2>기여 범위</h2><p class="gap">${e(t.contribution)}</p></section><p class="small muted gap">출처: ${actorLabel(t.actor)} · 앱의 독립 검증 없음</p><section class="section"><h2>연결된 실행</h2>${executionList(data.tasks.find((r) => r.id === t.id))}</section>`}`;
  }
  return workDetail(t);
}
function inspectionSummary(result) {
  const pending = result.unconfirmed || [];
  const findings = result.findings.length
    ? `<div class="note"><h3>확인이 필요한 점</h3>${result.findings.map((x) => `<p>${e(x)}</p>`).join('')}</div>`
    : '';
  const unavailable = pending.length
    ? `<div class="note"><h3 class="warn">확인하지 못한 항목</h3>${pending.map((x) => `<p>${e(x)}</p>`).join('')}<p class="small muted">이 항목은 정상 여부를 판단하지 않았습니다.</p></div>`
    : '';
  return (
    findings + unavailable ||
    '<p class="status">확인한 기본 항목에서 추가 확인 사항이 없었습니다.</p>'
  );
}
function productWelcome() {
  return productHome(
    product(),
    data,
    requestDraft(),
    Object.entries(ui.requests).filter(([key]) => key.startsWith(ui.productId + '@')),
  );
}

function productPage() {
  const p = product();
  if (!p) return empty('등록한 제품이 없습니다.', button('제품 등록', 'nav:new-product'));
  return (
    header('폴더·수집 연결', p.name, button('설정으로', 'nav:scope')) +
    `<section><h2>제품 폴더</h2><p class="gap product-folder">${e(p.folder)}</p><p class="small muted gap">${e(observation(p))}</p><div class="actions">${button(ui.busy ? '점검 중…' : '지금 기본 점검', `inspect:${p.id}`)}</div></section>${captureSetup(p)}<details><summary>결과를 직접 기록</summary><div class="actions">${button('작업 결과 기록', 'nav:new-work')}${button('판단 요청 만들기', 'nav:new-decision')}</div></details>`
  );
}
function captureSetup(p) {
  const connection = (data.captureConnections || []).find((c) => c.productId === p.id);
  const plan = ui.hookPlan?.productId === p.id ? ui.hookPlan : null;
  return `<section class="capture-setup section"><div class="row between"><h2>Codex 작업 자동 수집</h2><span class="small muted">${!p.codexCaptureEnabled ? '꺼짐' : connection ? `최근 수집 ${date(connection.lastReceivedAt)}` : '첫 이벤트 수신 대기'}</span></div><p class="small muted gap">이 제품에서 파일 변경·검사 명령이 있었던 응답을 기록합니다. 일반 대화, 사용자 프롬프트와 전체 대화 로그는 수집하지 않습니다.</p><div class="actions">${button('연결 설정 확인', `codex-prepare:${p.id}`)}${typeof p.codexCaptureEnabled === 'boolean' ? button(p.codexCaptureEnabled ? '수집 끄기' : '수집 다시 켜기', `codex-toggle:${p.id}`, 'class="plain"') : ''}${connection?.lastTaskId ? button('최근 수집 작업', `task:${connection.lastTaskId}`, 'class="link"') : ''}</div>${p.codexCaptureEnabled && !connection ? '<p class="small muted gap">설정 저장만으로 실행이 확인된 것은 아닙니다. Codex에서 이 프로젝트를 다시 열고 /hooks에서 작업실 훅을 검토·신뢰하면 다음 작업부터 수집합니다.</p>' : ''}${plan ? `<div class="hook-plan note"><h3>이 제품의 연결 설정</h3><p class="small muted gap">설정 파일: ${e(plan.filename)}</p><p class="small muted gap">${plan.existing ? '기존 훅을 유지하고 작업실 항목만 추가·갱신합니다. 원본을 백업합니다.' : '새 프로젝트 훅 파일을 만듭니다.'} 코드와 전역 설정은 변경하지 않습니다.</p><p class="small muted gap">실행: ${e(plan.node)}<br>${e(plan.script)}</p><p class="small muted gap">수집기는 로컬에만 저장하며 개발 작업을 차단하거나 에이전트에 추가 지시를 보내지 않습니다. 전체 완료 응답은 내부 근거에 보관합니다.</p><details><summary>작성할 훅 JSON 보기</summary><pre>${e(JSON.stringify(plan.config, null, 2))}</pre></details><div class="actions">${button('이 제품에 연결 설정 저장', `codex-install:${p.id}`, 'class="primary"')}${button('닫기', 'codex-close', 'class="plain"')}</div></div>` : ''}</section>`;
}
function newDecision() {
  if (!data.products.length) return newProduct();
  return (
    header('판단 요청 만들기', '자동으로 정할 수 없는 방침과 선택별 영향을 기록합니다.') +
    `<form data-form="new-decision" class="form">${productSelect()}${field('title', '요청 제목', '', 'input', 'required maxlength="200"')}${field('reason', '왜 이 결정이 필요한가요?', '', 'textarea', 'required maxlength="4000"')}<div class="formgrid">${field('label1', '선택 1', '', 'input', 'required maxlength="160"')}${field('label2', '선택 2', '', 'input', 'required maxlength="160"')}${field('effect1', '선택 1의 영향', '', 'textarea', 'required maxlength="1200"')}${field('effect2', '선택 2의 영향', '', 'textarea', 'required maxlength="1200"')}</div><div><button type="submit" class="primary">판단 요청 저장</button></div></form>`
  );
}
function newWork() {
  if (!data.products.length) return newProduct();
  return (
    header('작업 결과 기록', '확인한 사실과 확인하지 못한 범위를 함께 남깁니다.') +
    `<form data-form="work" class="form">${productSelect()}${field('title', '작업 제목', '', 'input', 'required maxlength="200"')}${field('summary', '무엇이 달라졌나요?', '', 'textarea', 'required maxlength="8000"')}${field('evidence', '확인한 근거', '', 'textarea', 'required maxlength="8000" placeholder="예: 수정 커밋, 테스트 결과, 재현 방법"')}${field('limitations', '아직 확인하지 못한 것', '', 'textarea', 'required maxlength="4000"')}${field('contribution', '나와 에이전트의 기여 범위', '', 'textarea', 'required maxlength="3000"')}<div><button type="submit" class="primary">결과와 근거 저장</button></div></form>`
  );
}
function recordsPage() {
  return (
    header(
      '기록',
      product()?.name || '등록한 제품이 없습니다.',
      button('기록 추가', 'nav:new-record'),
    ) +
    `${field('record-query', '내용 검색', ui.query)}<div id="record-results">${recordResults()}</div>`
  );
}
function recordResults() {
  const rows = data.records.filter(
    (r) =>
      r.productId === product()?.id &&
      `${r.title} ${r.content} ${r.scope}`.toLowerCase().includes(ui.query.toLowerCase()),
  );
  return rows.length
    ? rows
        .map(
          (r) =>
            `<article class="record"><div class="row between"><h2>${e(r.title)}</h2><span class="badge">${provenance[r.provenance]}</span></div><p class="gap record-excerpt">${e(r.content)}</p>${recordUseLine(r)}<p class="small muted gap">적용: ${e(r.scope)}<br>출처: ${e(r.source)}<br>마지막 변경: ${date(r.updated)} · ${r.validity === 'needs_review' ? '절차 재확인 중 · 조회 보류' : r.active ? '자동 참조 대상' : '자동 참조에서 제외'}</p><div class="row gap">${button('조건·유효성 보기', `record-detail:${r.id}`, 'class="plain"')}${r.sourceTaskId ? button('출처 작업', `task:${r.sourceTaskId}`, 'class="link"') : ''}${button(r.active ? '자동 참조에서 제외' : '다시 포함', `record-toggle:${r.id}`, 'class="plain"')}</div></article>`,
        )
        .join('')
    : empty(
        '일치하는 기록이 없습니다.',
        '제품을 점검하거나 작업 결과를 기록하면 근거가 여기에 쌓입니다.',
      );
}
function recordUseLine(record) {
  const contexts = (data.agentContexts || []).filter((c) =>
    c.context.records.some((r) => r.id === record.id),
  );
  const latest = contexts[0],
    task = latest && data.tasks.find((t) => t.id === latest.taskId);
  return `<div class="usage-line">${task ? `최근 제공: ${button(e(task.title), `task:${task.id}`, 'class="link"')} · ${contexts.length}회 실행에 제공` : '아직 내장 실행에 제공되지 않은 기록'}<br>제공 이력이며 실제 활용 여부는 별도입니다.</div>`;
}
function newRecord() {
  if (!data.products.length) return newProduct();
  return (
    header('기록 추가', '언제 다시 써야 하는 정보인지 함께 남깁니다.') +
    `<form data-form="record" class="form">${productSelect()}${field('title', '제목', '', 'input', 'required maxlength="200"')}${field('content', '내용', '', 'textarea', 'required maxlength="8000"')}${field('scope', '적용 조건', '', 'textarea', 'required maxlength="1000"')}${field('source', '출처', '', 'input', 'required maxlength="1000"')}<div><button type="submit" class="primary">기록 저장</button></div></form>`
  );
}
function newTarget() {
  return (
    header('포트폴리오 대상 추가', '기업별로 강조할 경험과 페이지를 따로 관리합니다.') +
    `<form data-form="target" class="form">${field('target', '기업 또는 대상 이름', '', 'input', 'required maxlength="160" placeholder="예: 기본 포트폴리오, 지원 기업명"')}${field('requirements', '이 대상에게 보여주고 싶은 경험', '', 'textarea', 'maxlength="5000"')}${product() ? `<label class="check-option"><input type="checkbox" name="autoSubscribe">${e(product().name)}의 새 작업을 이 초안에 자동 반영</label><p class="small muted">기존 작업은 직접 선택합니다. 자동 반영해도 웹에 공개되지 않습니다.</p>` : ''}<div><button type="submit" class="primary">초안 만들기</button></div></form>`
  );
}
function loadDraft(id) {
  const p = data.portfolios.find((x) => x.id === id);
  if (p) {
    ui.portfolioId = p.id;
    ui.draft = structuredClone(p);
    ui.draftBase = structuredClone(p);
    ui.conflictRemote = null;
    ui.dirty = false;
  }
}
function preview(d) {
  return `<article class="paper" aria-label="포트폴리오 미리보기">${d.intro ? `<h2>${e(d.intro)}</h2>` : '<p class="muted small">소개 문장 없음</p>'}${d.entries.length ? d.entries.map((x) => `<section ${x.taskId === ui.fromTaskId ? 'class="current-entry"' : ''}><h3>${e(x.title)}</h3><p>${e(x.description)}</p><p class="small">기여 범위: ${e(x.contribution)}</p></section>`).join('') : '<p class="muted gap">아직 포함한 작업이 없습니다.</p>'}</article>`;
}
function subscriptions(d) {
  return `<details class="subscriptions"><summary>자동 반영 설정${d.autoProductIds?.length ? ` · ${d.autoProductIds.length}개 제품` : ' · 꺼짐'}</summary><p class="small muted gap">선택한 제품의 새 작업 보고와 이후 수정 보고를 이 초안에 반영합니다. 직접 고친 문장과 제외한 사례는 보존합니다.</p>${data.products.map((p) => `<label class="check-option"><input type="checkbox" data-subscription="${p.id}" ${(d.autoProductIds || []).includes(p.id) ? 'checked' : ''}>${e(p.name)}</label>`).join('')}<p class="small muted">설정을 끄면 다음 반영부터 중단하며 기존 사례는 유지합니다. 변경 후 초안을 저장하세요.</p></details>`;
}
function conflictReview() {
  const remote = ui.conflictRemote;
  return remote
    ? `<section class="conflict-review"><h2>저장된 초안에 다른 변경이 있습니다</h2><p class="small muted gap">작성 중인 입력은 아래 편집기에 남아 있습니다. 저장된 내용을 확인한 뒤, 충돌한 부분에 내 변경을 우선 적용할 수 있습니다.</p><details><summary>저장된 초안과 설정 보기</summary>${preview(remote)}<p class="small muted gap">비공개 강조점: ${e(remote.requirements)}</p><p class="small muted gap">자동 반영: ${(remote.autoProductIds || []).map(productName).map(e).join(', ') || '꺼짐'}</p></details><div class="actions">${button('내 변경 우선으로 저장', 'save-portfolio-overwrite')}${button('저장된 초안으로 돌아가기', 'discard-draft')}</div></section>`
    : '';
}
function portfolioPage() {
  const from = data.tasks.find((t) => t.id === ui.fromTaskId);
  const back = ui.history.length
    ? ''
    : from
      ? button(`← ${e(from.title)}`, `task:${from.id}`, 'class="link back"')
      : '';
  if (!data.portfolios.length)
    return (
      back +
      header('포트폴리오 초안', '기업 또는 기본 페이지를 선택해 작업 사례를 보관합니다.') +
      empty('아직 저장한 대상이 없습니다.', button('첫 대상 추가', 'nav:new-target'))
    );
  if (!ui.draft || !data.portfolios.some((p) => p.id === ui.portfolioId))
    loadDraft(data.portfolios.find((p) => p.id === ui.portfolioId)?.id || data.portfolios[0].id);
  const d = ui.draft;
  return (
    back +
    header('포트폴리오 초안', '대상별 저장 · 웹 배포 미연결') +
    `<div class="targetbar row between"><strong>${e(d.target)}</strong><span id="save-state" class="small muted">${ui.dirty ? '저장하지 않은 변경' : '로컬 초안 저장됨'}</span></div>${!ui.editing && !ui.review ? `<div class="folio-context">${e(d.requirements || '이 대상에게 강조할 경험을 초안 편집에서 정할 수 있습니다.')}<br><span class="small">${d.autoProductIds?.length ? `${d.autoProductIds.map(productName).map(e).join(', ')}의 새 결과를 받습니다.` : '새 결과 자동 반영이 꺼져 있습니다.'} · ${d.entries.length}개 사례 · HTML 저장 가능</span></div>` : ''}${!ui.editing && !ui.review ? portfolioAgentPanel(d, data) : ''}${portfolioSourceNotices(d)}${d.pendingTaskIds?.length ? `<p class="notice">사례 20개 한도로 ${d.pendingTaskIds.length}개 작업이 대기 중입니다. 사례를 제외하고 저장하면 빈자리에 반영합니다.</p>` : ''}${
      ui.review
        ? exportReview(d)
        : `${from && !d.entries.some((x) => x.taskId === from.id) ? `<div class="context-entry row between"><span>‘${e(from.title)}’은 이 대상에 포함되지 않았습니다.</span>${button('이 작업 추가', `add-current:${from.id}`)}</div>` : ''}${
            ui.editing
              ? `${conflictReview()}<section class="editor" aria-label="초안 편집">${subscriptions(d)}${field('folio-intro', '페이지 첫 문장', d.intro, 'textarea', 'maxlength="2000" data-draft="intro"')}${field('folio-requirements', '대상별 강조점 · 비공개', d.requirements, 'textarea', 'maxlength="5000" data-draft="requirements"')}<div><label for="add-task">기록된 작업에서 사례 추가</label><select id="add-task"><option value="">작업 선택</option>${data.tasks
                  .filter(
                    (t) =>
                      t.kind === 'work' &&
                      !t.parentTaskId &&
                      !d.entries.some((x) => x.taskId === t.id),
                  )
                  .map(
                    (t) =>
                      `<option value="${t.id}">${e(t.title)} / ${e(productName(t.productId))}</option>`,
                  )
                  .join(
                    '',
                  )}</select></div>${d.entries.map((x, i) => `<section class="entry-editor"><div class="row between"><h2>${e(x.title)}</h2><div class="toolbar">${i ? button('위로', `move-entry:${i}`) : ''}${button('제외', `remove-entry:${i}`)}</div></div>${field(`entry-title-${i}`, '제목', x.title, 'input', `data-entry="${i}" data-key="title" maxlength="200"`)}${field(`entry-description-${i}`, '사례 설명', x.description, 'textarea', `data-entry="${i}" data-key="description" maxlength="5000"`)}${field(`entry-contribution-${i}`, '기여 범위', x.contribution, 'textarea', `data-entry="${i}" data-key="contribution" maxlength="3000"`)}<details><summary>원본 근거 확인</summary><p class="small muted gap">${e(data.tasks.find((t) => t.id === x.taskId)?.evidence || '출처를 확인할 수 없습니다.')}</p><p class="small muted gap">앱의 독립 검증 없음</p></details></section>`).join('')}<div class="actions">${button('초안 저장', 'save-portfolio', 'class="primary"')}${button('수정 취소', 'discard-draft')}</div></section>`
              : `<div id="folio-preview">${preview(d)}</div><div class="actions">${button('초안 편집', 'edit-portfolio')}${from ? button('작업 근거 보기', `portfolio-evidence:${from.id}`, 'class="plain"') : ''}${entryEvidence(d)}${button('HTML 내보내기 검토', 'review-export')}</div>`
          }<p class="small muted gap">${d.autoProductIds?.length ? `자동 반영 중 · ${d.autoProductIds.map(productName).map(e).join(', ')}<br>` : ''}${d.exports.length ? `최근 내보내기 ${date(d.exports.at(-1).at)}` : '아직 내보낸 버전 없음'}</p>`
    }`
  );
}
function exportReview(d) {
  return `<section class="dialog"><p class="eyebrow">내보내기 전 검토</p><h2>${e(d.target)}용 페이지</h2><div class="note"><p>포함: 소개 문장, 선택한 사례와 기여 범위</p><p>제외: 기업별 비공개 강조점, 내부 근거 원문, 로컬 경로, 작업 이력</p></div><div class="gap">${preview(d)}</div><div class="actions">${button('HTML 파일로 저장', 'export', 'class="primary"')}${button('편집으로 돌아가기', 'cancel-export')}</div><p class="small muted gap">저장 위치는 다음 창에서 선택합니다. 파일을 저장해도 웹에 공개되지는 않습니다.</p></section>`;
}
function connectionPage() {
  return (
    header('MCP 연결', '외부 에이전트가 이 앱과 같은 기록을 읽고 쓸 수 있습니다.') +
    `<div class="form"><div class="note"><h3>연결하면 가능한 것</h3><p>제품 조회 · 적용할 기록 검색 · 저장소 기본 점검 · 판단 요청 · 작업 결과와 지식 기록</p><p class="small muted">등록 폴더 변경, 사용자 대신 결정, 실제 코드 수정과 배포 기능은 MCP에 노출하지 않았습니다.</p></div>${ui.connection ? `<h2>stdio 연결 설정</h2><p class="muted">Node.js 24 이상이 필요합니다. 아래 형식을 지원하는 MCP 클라이언트에 등록하세요. 제품별 연결 방식은 클라이언트에 따라 다릅니다.</p><pre>${e(JSON.stringify(ui.connection.config, null, 2))}</pre><p class="small muted">앱 데이터 위치<br>${e(ui.connection.dataDirectory)}</p>` : button('연결 설정 보기', 'connection-load', 'class="primary"')}<details><summary>최근 기록 변경</summary>${data.audit
      .slice(0, 15)
      .map((a) => `<p class="small muted gap">${date(a.at)} · ${e(a.action)}<br>${e(a.detail)}</p>`)
      .join('')}</details></div>`
  );
}

async function saveDraft(preferLocal = false) {
  const latest = await call('snapshot');
  const remote = latest.portfolios.find((p) => p.id === ui.portfolioId);
  if (!remote) throw new Error('대상을 찾을 수 없습니다. 현재 입력은 보존했습니다.');
  if (preferLocal && remote.revision !== ui.conflictRemote?.revision) {
    ui.conflictRemote = remote;
    throw new Error(
      '저장된 초안이 다시 바뀌었습니다. 최신 내용을 확인하세요. 현재 입력은 보존했습니다.',
    );
  }
  let d;
  try {
    d = mergeDraft(ui.draftBase, ui.draft, remote, preferLocal);
  } catch (error) {
    ui.conflictRemote = remote;
    throw error;
  }
  const saved = await call('savePortfolio', {
    id: d.id,
    revision: remote.revision,
    intro: d.intro,
    requirements: d.requirements,
    entries: d.entries,
    autoProductIds: d.autoProductIds || [],
  });
  await refresh();
  loadDraft(saved.id);
  ui.editing = false;
  flash('초안을 저장했습니다.');
}
async function syncExternal() {
  if (ui.busy || ui.syncing) return;
  ui.syncing = true;
  try {
    const token = await call('changes');
    if (token === data.changeToken || ui.busy) return;
    if (ui.dirty || ui.formDirty || ui.review) {
      ui.externalPending = true;
      const notice = document.querySelector('.sync-notice');
      if (notice) notice.textContent = pendingMessage();
      return;
    }
    const next = await call('snapshot');
    if (ui.busy || ui.dirty || ui.formDirty || ui.review) return;
    applySnapshot(next);
    restoreRequestAfterSetup();
    if (ui.draft) loadDraft(ui.portfolioId);
    render();
  } catch (error) {
    const notice = document.querySelector('.sync-notice');
    if (notice)
      notice.textContent = `새 기록을 확인하지 못했습니다. 다음 확인 때 재시도합니다. ${error.message}`;
  } finally {
    ui.syncing = false;
  }
}
async function run(fn) {
  if (ui.busy) return;
  ui.busy = true;
  app.querySelectorAll('button[type=submit],button[data-action^="inspect:"]').forEach((b) => {
    b.disabled = true;
  });
  try {
    await fn();
  } catch (error) {
    flash(error.message, true);
  } finally {
    ui.busy = false;
    render();
  }
}
app.addEventListener('click', async (event) => {
  const target = event.target.closest('button[data-action]');
  if (!target) return;
  const [action, id] = target.dataset.action.split(':');
  if (action === 'request-close') {
    closeRequest();
    return;
  }
  if (action === 'folder') {
    const response = await window.workroom.chooseFolder();
    if (response.ok && response.value) {
      document.getElementById('folder').value = response.value;
      ui.formDirty = true;
    } else if (!response.ok) {
      flash(response.error, true);
      render();
    }
    return;
  }
  await run(async () => {
    if (
      [
        'operation-check',
        'issue-start',
        'issue-defer',
        'portfolio-edit',
        'portfolio-auto',
        'portfolio-apply',
      ].includes(action)
    ) {
      if (!canLeave()) return;
      let task;
      if (action === 'operation-check')
        task = await runtimeCall('checkOperations', { productId: id });
      if (action === 'issue-start' || action === 'issue-defer')
        task = await runtimeCall('issueAction', {
          id,
          action: action === 'issue-start' ? 'investigate' : 'defer',
        });
      if (action === 'portfolio-edit')
        task = await runtimeCall('editPortfolio', { portfolioId: id });
      if (action === 'portfolio-auto') {
        const p = data.portfolios.find((p) => p.id === id);
        await runtimeCall('configurePortfolioEditor', {
          id,
          revision: p.revision,
          enabled: !p.autoEdit,
        });
      }
      if (action === 'portfolio-apply') await runtimeCall('applyPortfolioEdit', { id });
      await refresh();
      if (ui.draft) loadDraft(ui.portfolioId);
      if (task?.kind === 'agent') {
        ui.taskId = task.id;
        ui.productId = task.productId;
        ui.view = 'ops';
        ui.source = null;
      } else
        flash(
          action === 'operation-check'
            ? '현재 운영 상태를 확인했습니다.'
            : '운영 상태를 저장했습니다.',
        );
    } else if (action.startsWith('runtime-')) {
      if (!canLeave()) return;
      const method = {
        'runtime-login': 'login',
        'runtime-device': 'login',
        'runtime-cancel-login': 'cancelLogin',
        'runtime-logout': 'logout',
        'runtime-verify': 'verify',
        'runtime-restart': 'restart',
        'runtime-pause': 'configure',
      }[action];
      const args =
        action === 'runtime-device'
          ? { mode: 'device_code' }
          : action === 'runtime-login'
            ? { mode: 'browser' }
            : action === 'runtime-pause'
              ? { paused: !data.runtime?.paused }
              : {};
      if (method) {
        await runtimeCall(method, args);
        await refresh();
      }
    } else if (action === 'agent-stop' || action === 'agent-resume') {
      if (!canLeave()) return;
      const task = data.tasks.find((t) => t.id === id);
      await runtimeCall(action === 'agent-stop' ? 'stop' : 'resume', {
        id,
        ...(action === 'agent-resume' ? { revision: task.revision } : {}),
      });
      await refresh();
    } else if (action === 'agent-replan') {
      if (!canLeave()) return;
      const previous = data.tasks.find((t) => t.id === id);
      const task = await runtimeCall('start', {
        productId: previous.productId,
        goal: previous.goal,
        mode: 'change',
        testFiles: previous.testFiles,
      });
      await refresh();
      ui.taskId = task.id;
      ui.view = 'ops';
      flash('기존 수정안을 보존하고 최신 원본으로 새 수정을 맡겼습니다.');
    } else if (action === 'toggle-list') {
      ui.listOpen = !ui.listOpen;
    } else if (action === 'delegate' || action === 'agent-followup') {
      startRequest(
        undefined,
        action === 'agent-followup' ? data.tasks.find((t) => t.id === id) : undefined,
      );
    } else if (action === 'request-restore') {
      if (!canLeave() || !id.startsWith(ui.productId + '@') || !ui.requests[id]) return;
      const previous = requestDraft(),
        saved = ui.requests[id];
      if (previous.goal?.trim()) ui.requests[id] = { ...previous };
      else delete ui.requests[id];
      ui.requests[ui.productId] = saved;
      persistRequests();
      startRequest();
    } else if (action === 'delegate-return') {
      if (!canLeave()) return;
      returnToRequest();
    } else if (action === 'nav') {
      if (id === 'new-change' || id === 'new-investigation')
        startRequest(id === 'new-change' ? 'change' : 'investigation');
      else {
        if (id === 'account') {
          if (ui.requestOpen) {
            ui.accountReturn = ui.productId;
            sessionStorage.setItem('workroom-account-return', ui.accountReturn);
          } else {
            ui.accountReturn = null;
            sessionStorage.removeItem('workroom-account-return');
          }
        }
        go(id);
      }
      ui.listOpen = false;
    } else if (action === 'refresh') {
      if (!canLeave()) return;
      await refresh();
      ui.draft = null;
      flash('최신 기록을 불러왔습니다.');
    } else if (action === 'product') {
      if (!canLeave()) return;
      rememberLocation();
      ui.productId = id;
      ui.taskQuery = ui.lastQueries[id] || '';
      ui.taskId =
        ui.lastTasks[id] ||
        rootTasks().find((t) => t.productId === id && t.status === 'needs_decision')?.id ||
        rootTasks().find((t) => t.productId === id)?.id;
      ui.relatedOpen = false;
      ui.history = [];
      go('home');
    } else if (action === 'task') {
      ui.listOpen = false;
      if (!canLeave()) return;
      rememberLocation();
      ui.history = [];
      ui.taskId = id;
      const t = data.tasks.find((t) => t.id === id);
      if (t) ui.productId = t.productId;
      ui.relatedOpen = false;
      ui.editing = false;
      go('ops');
    } else if (action === 'open-executions') {
      const group = app.querySelector('.execution-group');
      if (group) {
        group.open = true;
        group.scrollIntoView({ block: 'start' });
        group.querySelector('summary')?.focus({ preventScroll: true });
      }
    } else if (action === 'source') {
      ui.sourceExpanded = [...app.querySelectorAll('details[open]')].map(
        (d) => d.querySelector('summary')?.textContent,
      );
      ui.sourceScroll = document.querySelector('.main').scrollTop;
      ui.source = id;
      ui.evidenceReturn = 'ops';
    } else if (action === 'source-close' && ui.evidenceReturn === 'route') {
      returnLocation();
    } else if (action === 'source-close') {
      if (go(ui.evidenceReturn || 'ops')) {
        ui.restoreExpanded = ui.evidenceReturn === 'ops' ? ui.sourceExpanded : null;
        ui.restoreScroll = ui.sourceScroll;
      }
    } else if (action === 'portfolio-evidence') {
      if (!canLeave()) return;
      pushLocation();
      const previousScroll = document.querySelector('.main').scrollTop;
      if (!go('ops')) return;
      ui.sourceScroll = previousScroll;
      ui.taskId = id;
      ui.productId = data.tasks.find((t) => t.id === id)?.productId;
      ui.source = 'evidence';
      ui.evidenceReturn = 'route';
    } else if (action === 'task-portfolio' || action === 'open-portfolio') {
      if (!canLeave()) return;
      if (action === 'task-portfolio') pushLocation();
      else {
        rememberLocation();
        ui.history = [];
      }
      if (!go('portfolio')) return;
      ui.fromTaskId = action === 'task-portfolio' ? id : null;
      ui.editing = false;
      const p =
        data.portfolios.find((p) => p.entries.some((x) => x.taskId === id)) ||
        data.portfolios.find((p) => p.id === ui.portfolioId) ||
        data.portfolios[0];
      ui.draft = null;
      if (p) loadDraft(p.id);
    } else if (action === 'return-location') {
      returnLocation();
    } else if (action === 'target') {
      if (!canLeave()) return;
      rememberLocation();
      loadDraft(id);
      ui.view = 'portfolio';
      ui.source = null;
      ui.review = false;
      ui.listOpen = false;
    } else if (action === 'record-detail') {
      if (!canLeave()) return;
      pushLocation();
      await refresh();
      ui.recordId = id;
      ui.recordEditing = false;
      ui.view = 'record-detail';
      ui.source = null;
    } else if (action === 'record-edit') {
      const record = data.records.find((r) => r.id === ui.recordId);
      ui.recordBaseRevision = record.revision;
      ui.recordEditing = true;
    } else if (action === 'record-cancel') {
      ui.formDirty = false;
      ui.resetForm = true;
      ui.recordEditing = false;
    } else if (action === 'record-source') {
      if (!canLeave()) return;
      pushLocation();
      ui.view = 'ops';
      ui.taskId = id;
      ui.productId = data.tasks.find((t) => t.id === id)?.productId;
      ui.source = 'evidence';
      ui.evidenceReturn = 'route';
    } else if (action === 'link-work') {
      if (!canLeave()) return;
      pushLocation();
      const report = data.tasks.find((t) => t.id === id);
      ui.linkTaskId = id;
      ui.linkParent = report.parentTaskId || '';
      ui.linkBase = {
        id,
        revision: report.revision,
        parents: Object.fromEntries(rootTasks().map((t) => [t.id, t.revision])),
      };
      ui.view = 'work-link';
      ui.source = null;
    } else if (action === 'link-cancel') {
      ui.formDirty = false;
      ui.resetForm = true;
      returnLocation();
    } else if (action === 'source-keep' || action === 'source-regenerate') {
      if (!canLeave()) return;
      const p = data.portfolios.find((p) => p.id === ui.portfolioId);
      await call('reviewPortfolioSource', {
        id: p.id,
        revision: p.revision,
        taskId: id,
        mode: action === 'source-keep' ? 'keep' : 'regenerate',
      });
      await refresh();
      loadDraft(p.id);
      flash('현재 근거를 확인한 결과를 저장했습니다. 내보낸 버전은 그대로입니다.');
    } else if (action === 'edit-portfolio') {
      ui.editing = true;
    } else if (action === 'add-current') {
      const t = data.tasks.find((t) => t.id === id && t.kind === 'work');
      if (t && !ui.draft.entries.some((x) => x.taskId === id)) {
        ui.draft.entries.push({
          taskId: id,
          title: t.title,
          description: t.summary.slice(0, 5000),
          contribution: t.contribution,
        });
        ui.dirty = true;
        ui.editing = true;
      }
    } else if (action === 'inspect') {
      if (!canLeave()) return;
      flash('저장소를 읽고 있습니다…');
      render();
      const t = await call('inspect', { productId: id });
      await refresh();
      ui.taskId = t.id;
      ui.view = 'ops';
      flash('기본 점검 완료. 확인한 내용과 미확인 범위를 함께 저장했습니다.');
    } else if (action === 'discard-form') {
      ui.formDirty = false;
      ui.resetForm = true;
      flash('저장하지 않은 입력을 취소했습니다.');
    } else if (action === 'defer') {
      if (!canLeave()) return;
      const t = data.tasks.find((t) => t.id === id);
      await call('deferDecision', { id, revision: t.revision, deferred: t.status !== 'deferred' });
      await refresh();
      flash(
        t.status === 'deferred'
          ? '판단 대기로 되돌렸습니다.'
          : '보류했습니다. 해결된 것으로 처리하지 않습니다.',
      );
    } else if (action === 'record-toggle') {
      if (!canLeave()) return;
      const r = data.records.find((r) => r.id === id);
      await call('toggleRecord', { id, revision: r.revision, active: !r.active });
      await refresh();
      ui.relatedOpen = true;
      flash(
        r.active
          ? '다음 MCP 조회의 자동 참조에서 제외했습니다. 원본은 보존됩니다.'
          : '자동 참조에 다시 포함했습니다.',
      );
    } else if (action === 'codex-prepare') {
      if (!canLeave()) return;
      const result = await window.workroom.codexSetup(id);
      if (!result.ok) throw new Error(result.error);
      ui.hookPlan = result.value;
    } else if (action === 'codex-close') {
      ui.hookPlan = null;
    } else if (action === 'codex-install') {
      if (!canLeave() || ui.hookPlan?.productId !== id) return;
      const result = await window.workroom.codexSetup(id, ui.hookPlan.revision);
      if (!result.ok) throw new Error(result.error);
      ui.hookPlan = null;
      await refresh();
      flash(
        '설정을 저장했습니다. Codex에서 프로젝트를 다시 열고 /hooks에서 작업실 훅을 검토·신뢰하세요.',
      );
    } else if (action === 'codex-toggle') {
      if (!canLeave()) return;
      const p = data.products.find((p) => p.id === id);
      await call('setCodexCapture', { productId: id, enabled: !p.codexCaptureEnabled });
      await refresh();
      flash(
        p.codexCaptureEnabled
          ? '새 이벤트 수집을 중단했습니다. 기존 기록은 유지합니다.'
          : '수집을 다시 켰습니다. 다음 응답 종료 이벤트를 기다립니다.',
      );
    } else if (action === 'connection-load') {
      const response = await window.workroom.connectionInfo();
      if (!response.ok) throw new Error(response.error);
      ui.connection = response.value;
    } else if (action === 'save-portfolio' || action === 'save-portfolio-overwrite') {
      await saveDraft(action === 'save-portfolio-overwrite');
    } else if (action === 'discard-draft') {
      await refresh();
      loadDraft(ui.portfolioId);
      ui.editing = false;
      flash('저장된 초안으로 돌아왔습니다.');
    } else if (action === 'remove-entry') {
      ui.draft.entries.splice(Number(id), 1);
      ui.dirty = true;
    } else if (action === 'move-entry') {
      const i = Number(id);
      [ui.draft.entries[i - 1], ui.draft.entries[i]] = [
        ui.draft.entries[i],
        ui.draft.entries[i - 1],
      ];
      ui.dirty = true;
    } else if (action === 'review-export') {
      if (!canLeave()) return;
      if (!ui.draft.intro.trim() || !ui.draft.entries.length)
        throw new Error('소개와 작업 사례를 하나 이상 넣고 저장해주세요.');
      ui.review = true;
    } else if (action === 'cancel-export') ui.review = false;
    else if (action === 'export') {
      const result = await window.workroom.exportPortfolio(ui.draft.id, ui.draft.revision);
      if (!result.ok) throw new Error(result.error);
      if (result.value) {
        await refresh();
        loadDraft(ui.portfolioId);
        ui.review = false;
        flash(`HTML 저장 완료: ${result.value.filename} · 웹 배포는 하지 않았습니다.`);
      }
    }
  });
});
app.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  run(async () => {
    ui.message = '';
    switch (form.dataset.form) {
      case 'delegation': {
        rememberRequest(form);
        const draft = requestDraft();
        if (ui.requestSaveFailed)
          throw new Error('요청 초안을 보관하지 못했습니다. 입력을 유지하고 다시 시도해 주세요.');
        const testFiles =
          draft.mode === 'change'
            ? draft.testFiles
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean)
            : [];
        if (testFiles.length && !draft.allowTests)
          throw new Error('지정한 테스트의 실행을 허용하거나 테스트 경로를 비워주세요.');
        if (!data.runtime?.modelId || !['connected', 'ready'].includes(data.runtime.state))
          throw new Error('먼저 계정과 모델 연결을 완료해 주세요.');
        const task = await runtimeCall('start', {
          productId: product().id,
          goal: draft.goal,
          mode: draft.mode,
          testFiles,
          ...(draft.sourceTaskId ? { sourceTaskId: draft.sourceTaskId } : {}),
        });
        delete ui.requests[ui.productId];
        persistRequests();
        await refresh();
        ui.requestOpen = false;
        ui.taskId = task.id;
        ui.view = 'ops';
        ui.listOpen = false;
        ui.source = null;
        ui.resetForm = true;
        flash('작업을 맡겼습니다. 진행 단계와 필요한 판단을 여기에서 확인할 수 있습니다.');
        break;
      }
      case 'change-start': {
        const testFiles = values.testFiles
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (testFiles.length && !values.allowTests)
          throw new Error('지정한 테스트의 실행을 허용하거나 테스트 경로를 비워주세요.');
        const task = await runtimeCall('start', {
          productId: product().id,
          goal: values.goal,
          mode: 'change',
          testFiles,
        });
        await refresh();
        ui.taskId = task.id;
        ui.view = 'ops';
        flash(
          '분리된 수정안 작성을 맡겼습니다. 작업 폴더에 반영하기 전에 변경과 검사 결과를 확인할 수 있습니다.',
        );
        break;
      }
      case 'change-apply': {
        const task = data.tasks.find((t) => t.id === form.dataset.id),
          change = data.agentChanges.find((c) => c.id === task.changeSetId);
        try {
          await runtimeCall('applyChange', {
            id: task.id,
            revision: task.revision,
            artifactHash: change.artifactHash,
            acceptUnconfirmed: !!values.acceptUnconfirmed,
          });
          flash('검토한 수정본을 반영했습니다. 결과와 기록을 이어서 정리합니다.');
        } finally {
          ui.formDirty = false;
          ui.resetForm = true;
          await refresh();
        }
        break;
      }
      case 'operation-policy': {
        await runtimeCall('configureOperations', {
          productId: form.dataset.id,
          version: Number(form.dataset.version),
          enabled: !!values.enabled,
          intervalMinutes: Number(values.intervalMinutes),
          maxDailyStarts: Number(values.maxDailyStarts),
          allowChanges: !!values.allowChanges,
          testFiles: values.testFiles
            .split(/\r?\n/)
            .map((x) => x.trim())
            .filter(Boolean),
          allowTests: !!values.allowTests,
          maxRepairs: values.repairOnce ? 1 : 0,
        });
        ui.formDirty = false;
        ui.resetForm = true;
        await refresh();
        flash('운영 범위를 저장했습니다. 다음 일정부터 이 범위로 진행합니다.');
        break;
      }
      case 'runtime-model': {
        await runtimeCall('configure', values);
        await refresh();
        flash(
          ui.requestOpen
            ? '연결을 준비했습니다. 보관한 요청을 확인한 뒤 맡겨주세요.'
            : '작업 모델을 저장했습니다.',
        );
        break;
      }
      case 'runtime-manual': {
        document.getElementById('oauth-code').value = '';
        await runtimeCall('manualCode', values);
        await refresh();
        break;
      }
      case 'agent-start': {
        const task = await runtimeCall('start', { productId: product().id, goal: values.goal });
        await refresh();
        ui.taskId = task.id;
        ui.view = 'ops';
        flash('조사를 맡겼습니다. 단계별 진행과 근거가 여기에 쌓입니다.');
        break;
      }
      case 'product': {
        const p = await call('createProduct', values);
        await refresh();
        ui.productId = p.id;
        ui.taskId = null;
        ui.view = 'home';
        flash('제품을 연결했습니다. 첫 작업을 맡겨보세요.');
        break;
      }
      case 'goal': {
        const p = data.products.find((p) => p.id === form.dataset.id);
        await call('updateProduct', { id: p.id, revision: p.revision, goal: values.goal });
        await refresh();
        flash('현재 목표를 저장했습니다.');
        break;
      }
      case 'decision': {
        const t = data.tasks.find((t) => t.id === form.dataset.id);
        await call('resolveDecision', {
          id: t.id,
          revision: t.revision,
          option: Number(values.option),
        });
        await refresh();
        flash('방침과 적용 범위를 기록했습니다. 에이전트가 다음 조회에서 확인할 수 있습니다.');
        break;
      }
      case 'new-decision': {
        const t = await call('requestDecision', {
          productId: values.productId,
          title: values.title,
          reason: values.reason,
          options: [
            { label: values.label1, effect: values.effect1 },
            { label: values.label2, effect: values.effect2 },
          ],
        });
        await refresh();
        ui.productId = t.productId;
        ui.taskId = t.id;
        ui.view = 'ops';
        ui.source = null;
        flash('판단 요청을 저장했습니다.');
        break;
      }
      case 'work': {
        const t = await call('reportWork', values);
        await refresh();
        ui.productId = t.productId;
        ui.taskId = t.id;
        ui.view = 'ops';
        ui.source = null;
        flash('작업 결과와 근거를 기록했습니다.');
        break;
      }
      case 'work-link': {
        const parentId = values.parentTaskId || null;
        const result = await call('changeWorkLink', {
          id: ui.linkBase.id,
          revision: ui.linkBase.revision,
          parentTaskId: parentId,
          ...(parentId ? { parentRevision: ui.linkBase.parents[parentId] } : {}),
          reason: values.reason,
        });
        ui.formDirty = false;
        ui.resetForm = true;
        await refresh();
        if (ui.draft) loadDraft(ui.portfolioId);
        const previous = ui.history.pop();
        if (previous) Object.assign(ui, previous);
        else {
          ui.view = 'ops';
          ui.taskId = result.task.id;
        }
        flash(
          '원본을 보존하고 실행 연결을 정정했습니다. 초안의 영향과 직접 편집한 문장을 함께 확인하세요.',
        );
        break;
      }
      case 'record-review': {
        await call('reviewRecord', {
          id: ui.recordId,
          revision: ui.recordBaseRevision,
          content: values.content,
          scope: values.scope,
          validity: values.validity,
          reason: values.reason,
        });
        ui.recordEditing = false;
        await refresh();
        flash('적용 조건과 유효성을 저장했습니다. 과거 제공 버전은 유지됩니다.');
        break;
      }
      case 'record': {
        await call('addRecord', values);
        await refresh();
        ui.productId = values.productId;
        ui.view = 'records';
        flash('적용 조건과 출처를 함께 저장했습니다.');
        break;
      }
      case 'target': {
        const p = await call('createPortfolio', {
          target: values.target,
          requirements: values.requirements,
          autoProductIds: values.autoSubscribe && product() ? [product().id] : [],
        });
        await refresh();
        loadDraft(p.id);
        ui.view = 'portfolio';
        ui.editing = true;
        flash('대상별 초안을 만들었습니다.');
        break;
      }
    }
    ui.formDirty = false;
  });
});
app.addEventListener('input', (event) => {
  if (ui.rendering || !event.target.isConnected) return;
  const el = event.target;
  if (el.closest('form[data-form="delegation"]')) {
    rememberRequest(el.closest('form'));
    return;
  }
  if (el.closest('form[data-form]')) ui.formDirty = true;
  if (el.id === 'task-query') {
    ui.taskQuery = el.value;
    document.querySelector('.tasknav').innerHTML = taskRows();
  }
  if (el.id === 'record-query') {
    ui.query = el.value;
    document.getElementById('record-results').innerHTML = recordResults();
  }
  if (el.dataset.draft) {
    ui.draft[el.dataset.draft] = el.value;
    ui.dirty = true;
  }
  if (el.dataset.entry !== undefined) {
    ui.draft.entries[Number(el.dataset.entry)][el.dataset.key] = el.value;
    ui.dirty = true;
  }
  if (ui.dirty && ui.view === 'portfolio') {
    const previewNode = document.getElementById('folio-preview');
    if (previewNode) previewNode.innerHTML = preview(ui.draft);
    document.getElementById('save-state').textContent = '저장하지 않은 변경';
  }
});
app.addEventListener('change', (event) => {
  if (ui.rendering || !event.target.isConnected) return;
  if (event.target.dataset.subscription) {
    const ids = new Set(ui.draft.autoProductIds || []);
    event.target.checked
      ? ids.add(event.target.dataset.subscription)
      : ids.delete(event.target.dataset.subscription);
    ui.draft.autoProductIds = [...ids];
    ui.dirty = true;
    document.getElementById('save-state').textContent = '저장하지 않은 변경';
  }
  if (event.target.closest('form[data-form="delegation"]')) {
    rememberRequest(event.target.closest('form'));
    if (event.target.name === 'mode') {
      ui.resetForm = true;
      render();
    }
    return;
  }
  if (event.target.closest('form[data-form]')) ui.formDirty = true;
  if (event.target.id === 'link-parent') {
    ui.linkParent = event.target.value;
    render();
  }
  if (event.target.id === 'record-product') {
    ui.productId = event.target.value;
    render();
  }
  if (event.target.id === 'target-switch') {
    if (canLeave()) {
      loadDraft(event.target.value);
      ui.review = false;
      ui.message = '';
    }
    render();
  }
  if (event.target.id === 'add-task' && event.target.value) {
    const t = data.tasks.find((t) => t.id === event.target.value);
    if (!t || ui.draft.entries.some((x) => x.taskId === t.id)) return;
    ui.draft.entries.push({
      taskId: t.id,
      title: t.title,
      description: t.summary.slice(0, 5000),
      contribution: t.contribution,
    });
    ui.dirty = true;
    render();
  }
});
app.addEventListener(
  'toggle',
  (event) => {
    if (event.target.matches('[data-related]')) ui.relatedOpen = event.target.open;
  },
  true,
);
app.addEventListener(
  'cancel',
  (event) => {
    if (event.target.matches('.request-dialog')) {
      event.preventDefault();
      closeRequest();
    }
  },
  true,
);
window.addEventListener('beforeunload', (event) => {
  if (ui.dirty || ui.formDirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
try {
  await refresh();
  render();
} catch (error) {
  app.innerHTML = `<main class="main"><h1>저장소를 열 수 없습니다.</h1><p class="gap">${e(error.message)}</p></main>`;
}

setInterval(syncExternal, 2000);
window.addEventListener('focus', syncExternal);

function reportDetails(t) {
  return `<section class="section"><div class="row between sectionhead"><h2>변경 파일 <span class="count">${(t.changedFiles || []).length}</span></h2><span class="small muted">변경 설명</span></div>${
    t.changedFiles?.length
      ? `<div class="files">${t.changedFiles
          .map((f, i) => {
            const parts = f.path.replaceAll('\\', '/').split('/');
            const name = parts.pop();
            return button(
              `${icon('file')}<span class="file-info"><span class="file-name">${e(name)} <span class="file-dir">${e(parts.join('/'))}</span></span><span class="file-description">${e(f.summary || '변경 설명 없음')}</span></span>${icon('arrow')}`,
              `source:${i}`,
              `class="file-row" aria-label="${e(f.path)}"`,
            );
          })
          .join('')}</div>`
      : '<p class="muted small gap">변경 파일 목록이 첨부되지 않았습니다.</p>'
  }</section><section class="section"><div class="row between sectionhead"><h2>실행 결과</h2>${button('실행 근거 보기', 'source:evidence', 'class="link"')}</div>${t.checks?.length ? `<ul class="checks">${t.checks.map((c) => `<li><details class="check-detail"><summary>${icon(c.result === 'passed' ? 'check' : c.result === 'failed' ? 'failed' : 'pending')}<span class="check-name">${e(c.name)}</span><span class="check-status ${c.result}">${{ passed: '통과 보고', failed: '실패 보고', unconfirmed: '미확인' }[c.result]}</span>${icon('arrow')}</summary><p>${e(c.detail || '상세 보고 없음')}</p></details></li>`).join('')}</ul>` : `<p class="gap">${e(t.evidence)}</p><p class="small muted gap">개별 검사 결과는 첨부되지 않았습니다.</p>`}<details class="verification"><summary>검증 범위 · 앱의 독립 검증 없음</summary><p class="small muted gap">${e(t.limitations)}</p><p class="small muted gap">출처: ${actorLabel(t.actor)}</p></details></section>`;
}

function executionList(t) {
  return workReports(t, data.tasks)
    .map(
      (r) =>
        `<article class="execution-row"><div class="row between"><div><h3>${e(r.title)}</h3><p class="small muted gap">${actorLabel(r.actor)} · 보고 v${r.sourceVersion || 1} · ${date(r.created)}</p></div>${button(r.parentTaskId ? '연결 바로잡기' : '다른 작업에 연결', `link-work:${r.id}`, 'class="plain"')}</div><p class="gap">${e(r.summary)}</p><p class="small muted gap">${e(r.linkReason || (r.parentTaskId ? '보고자가 명시한 작업 ID로 연결' : '이 문제의 기준 보고'))}</p><details><summary>원문과 보고 버전 보기</summary><p class="gap">${e(r.evidence)}</p><p class="small muted gap">한계: ${e(r.limitations)}</p>${(
          data.reports || []
        )
          .filter((v) => v.taskId === r.id)
          .sort((a, b) => b.sourceVersion - a.sourceVersion)
          .map(
            (v) =>
              `<details><summary>보고 v${v.sourceVersion} · ${date(v.created)}</summary><p class="gap">${e(v.snapshot.summary)}</p><p class="small muted gap">${e(v.snapshot.evidence)}</p><p class="small muted gap">${e(v.snapshot.limitations)}</p></details>`,
          )
          .join('')}</details></article>`,
    )
    .join('');
}

function workFollowup(reports) {
  const checks = reports.flatMap((r) =>
    (r.checks || []).filter((c) => c.result !== 'passed').map((c) => ({ ...c, report: r.title })),
  );
  const limits = [...new Set(reports.map((r) => r.limitations).filter(Boolean))];
  return `<section class="task-outcome work-followup"><h2>보고에서 확인할 사항</h2>
    ${
      checks.length
        ? `<p>실행 근거에 실패·미확인 항목 ${checks.length}건이 있습니다. 후속 보고에서 해결됐는지는 각 근거를 함께 확인하세요.</p><ul>${checks
            .slice(0, 3)
            .map(
              (c) =>
                `<li><strong>${e(c.name)}</strong><span>${c.result === 'failed' ? '실패 보고' : '미확인'} · ${e(c.report)}</span></li>`,
            )
            .join('')}</ul>`
        : '<p>현재 제품의 정상 동작 여부는 이 보고만으로 판단하지 않습니다.</p>'
    }
    ${limits
      .slice(0, 2)
      .map((l) => `<p class="reported-limit">${e(l)}</p>`)
      .join('')}
    <div class="actions">${button('보고와 실행 근거 확인', 'open-executions', 'class="link"')}${limits.length > 2 || checks.length > 3 ? '<span class="small muted">나머지 항목은 실행 근거에 보관되어 있습니다.</span>' : ''}</div></section>`;
}

function workDetail(t) {
  const reports = workReports(t, data.tasks);
  const ids = new Set(reports.map((r) => r.id));
  const records = data.records.filter((r) => ids.has(r.sourceTaskId));
  return (
    header(t.title, `${labels[t.status]} · ${date(t.created)}`) +
    `<p class="task-summary">${e(t.summary)}</p><p class="small muted gap">운영 배포 미확인 · 보고된 결과와 앱의 독립 검증은 구분합니다.</p>
    ${t.parentTaskId ? `<div class="task-outcome"><h2>다른 문제에 연결된 실행입니다</h2>${button(data.tasks.find((x) => x.id === t.parentTaskId)?.title || '상위 작업', `task:${t.parentTaskId}`, 'class="link"')}</div>` : `${workFollowup(reports)}`}
    ${artifact(t)}<section class="section"><h2>재사용할 기록</h2>${records.length ? records.map((r) => button(`<span><strong>${e(r.title)}</strong><small>${r.validity === 'needs_review' ? '절차 재확인 중 · MCP 제공 보류' : !r.active ? '자동 참조에서 제외' : e(r.scope)}</small></span>${icon('arrow')}`, `record-detail:${r.id}`, 'class="related-link"')).join('') : '<p class="small muted gap">연결된 기록이 없습니다.</p>'}</section>
    <details class="execution-group"><summary>실행 근거 ${reports.length}건</summary>${executionList(t)}${reportDetails(projectWork(t, data.tasks))}</details>
    ${
      (data.workLinks || []).some(
        (l) => l.taskId === t.id || l.fromTaskId === t.id || l.toTaskId === t.id,
      )
        ? `<details><summary>연결 정정 이력</summary>${(data.workLinks || [])
            .filter((l) => l.taskId === t.id || l.fromTaskId === t.id || l.toTaskId === t.id)
            .map(
              (l) =>
                `<p class="small muted gap">${date(l.created)} · ${e(l.reason)}<br>${e(data.tasks.find((t) => t.id === l.taskId)?.title)} → ${e(data.tasks.find((t) => t.id === l.toTaskId)?.title || '별도 작업')}</p>`,
            )
            .join('')}</details>`
        : ''
    }`
  );
}

function linkPage() {
  const report = data.tasks.find((t) => t.id === ui.linkTaskId);
  if (!report) return empty('보고를 찾을 수 없습니다.', '목록에서 다시 선택하세요.');
  const affected = new Set([report.id, report.parentTaskId, ui.linkParent].filter(Boolean));
  const impacts = data.portfolios.filter((p) => p.entries.some((e) => affected.has(e.taskId)));
  const candidates = rootTasks().filter(
    (t) => t.kind === 'work' && t.id !== report.id && t.productId === report.productId,
  );
  const hasChildren = data.tasks.some((t) => t.parentTaskId === report.id);
  return (
    header('실행 연결 바로잡기', report.title) +
    `<p>원문과 보고 버전은 보존하고 어떤 문제에 속하는지만 바꿉니다. 다른 작업에 연결하면 이 보고는 그 작업의 실행 근거에서 볼 수 있습니다.</p>
    ${hasChildren ? '<p class="notice">이 작업에 연결된 실행이 있습니다. 먼저 해당 실행의 연결을 정리하세요.</p>' : ''}
    <form data-form="work-link" data-id="${report.id}" class="form gap"><div><label for="link-parent">연결할 문제</label><select id="link-parent" name="parentTaskId"><option value="" ${!ui.linkParent ? 'selected' : ''}>별도 작업으로 분리</option>${candidates.map((t) => `<option value="${t.id}" ${ui.linkParent === t.id ? 'selected' : ''}>${e(t.title)}</option>`).join('')}</select></div>
    ${field('reason', '연결을 바꾸는 이유', '', 'textarea', 'required maxlength="1000"')}
    <section><h2>함께 영향을 받는 초안</h2>${
      impacts.length
        ? impacts
            .map(
              (p) =>
                `<div class="record"><h3>${e(p.target)}</h3>${p.entries
                  .filter((x) => affected.has(x.taskId))
                  .map((x) => {
                    const source = p.entrySources?.[x.taskId];
                    return `<p class="small muted gap">${e(x.title)} · ${!source?.automatic || source.editedFields.length ? '직접 쓴 문장 보존 · 근거 재확인 표시' : x.taskId === report.id && ui.linkParent ? '자동 생성한 별도 사례 제외 · 원문은 연결한 작업에서 보존' : '자동 생성한 문장을 현재 연결로 갱신'}</p>`;
                  })
                  .join('')}</div>`,
            )
            .join('')
        : '<p class="small muted gap">이 연결을 사용하는 초안이 없습니다.</p>'
    }<p class="small muted gap">내보낸 HTML과 기존 버전은 바뀌지 않습니다. 분리한 기록을 새 사례로 자동 추가하지 않습니다.</p></section>
    <div class="actions"><button type="submit" class="primary" ${hasChildren ? 'disabled' : ''}>연결 정정 저장</button>${button('취소', 'link-cancel')}</div></form>`
  );
}

function recordDetailPage() {
  const r = data.records.find((r) => r.id === ui.recordId);
  if (!r) return empty('기록을 찾을 수 없습니다.', '다시 선택해 주세요.');
  const uses = (data.contextUses || []).filter((u) => u.records.some((x) => x.id === r.id));
  const history = (data.recordHistory || []).filter((h) => h.recordId === r.id);
  return (
    header(
      r.title,
      r.validity === 'needs_review'
        ? '절차 재확인 중 · MCP 조회 제공 보류'
        : r.active
          ? '같은 제품의 활성 기록'
          : '자동 참조에서 제외',
    ) +
    (ui.recordEditing
      ? `<form data-form="record-review" data-id="${r.id}" class="form">${field('content', '재사용할 내용', r.content, 'textarea', 'required maxlength="8000"')}${field('scope', '어떤 변경에 적용하는가', r.scope, 'textarea', 'required maxlength="1000"')}<div><label for="validity">현재 유효성</label><select id="validity" name="validity"><option value="valid" ${r.validity !== 'needs_review' ? 'selected' : ''}>조건을 확인함 · 조회에 제공 가능</option><option value="needs_review" ${r.validity === 'needs_review' ? 'selected' : ''}>절차 재확인 필요 · 조회 제공 보류</option></select></div>${field('reason', '수정 또는 보류 이유', r.validityReason || '', 'textarea', 'required maxlength="1000"')}<div class="actions"><button type="submit" class="primary">조건 저장</button>${button('취소', 'record-cancel')}</div><p class="small muted">별도로 제외한 기록은 유효성을 확인해도 자동으로 다시 포함하지 않습니다.</p></form>`
      : `<p class="record-content">${e(r.content)}</p>${recordUseLine(r)}<section class="section"><dl><div class="fact"><dt>적용 조건</dt><dd>${e(r.scope)}</dd></div><div class="fact"><dt>출처</dt><dd>${e(r.source)}</dd></div><div class="fact"><dt>유효성</dt><dd>${e(r.validityReason || '출처와 적용 조건을 확인한 뒤 사용하세요. 자동으로 관련성을 판정한 결과가 아닙니다.')}</dd></div></dl></section><div class="actions">${button('조건과 유효성 수정', 'record-edit')}${r.sourceTaskId ? button('원본 경험 보기', `record-source:${r.sourceTaskId}`, 'class="plain"') : ''}${button(r.active ? '다음 조회부터 제외' : '조회에 다시 포함', `record-toggle:${r.id}`, 'class="plain"')}</div>`) +
    `<details><summary>이전에 조회에 제공한 버전 · ${uses.length}건</summary><p class="small muted gap">조회에 반환한 내용이며 실제 에이전트가 활용했다는 확인은 아닙니다.</p>${uses
      .map((u) => {
        const v = u.records.find((x) => x.id === r.id);
        return `<article class="record"><h3>${date(u.created)} · 기록 v${v.revision}</h3><p class="small muted gap">조회: ${e(u.query || '제품 기록 조회')}</p><p class="gap">${e(v.content)}</p><p class="small muted gap">당시 조건: ${e(v.scope)}</p></article>`;
      })
      .join(
        '',
      )}</details><details><summary>이전 기록 버전 · ${history.length}건</summary>${history.map((h) => `<article class="record"><h3>v${h.snapshot.revision} · ${date(h.created)}</h3><p class="gap">${e(h.snapshot.content)}</p><p class="small muted gap">${e(h.snapshot.scope)}</p></article>`).join('')}</details>`
  );
}

function portfolioSourceNotices(d) {
  return d.entries
    .filter((x) => d.entrySources?.[x.taskId]?.sourceConflict)
    .map(
      (x) =>
        `<section class="conflict-review"><h2>${e(x.title)} · 연결 근거가 바뀌었습니다</h2><p class="small muted gap">직접 쓴 문장은 보존했습니다. 현재 근거를 확인한 뒤 유지하거나, 이 사례의 제목·설명·기여를 현재 보고로 다시 작성할 수 있습니다.</p><div class="actions">${button('현재 근거 보기', `portfolio-evidence:${x.taskId}`)}${button('이 문장 유지 확인', `source-keep:${x.taskId}`)}${button('현재 보고로 문장 다시 작성', `source-regenerate:${x.taskId}`)}</div></section>`,
    )
    .join('');
}
function entryEvidence(d) {
  return `<details class="case-evidence"><summary>사례별 근거와 선정 이유</summary><p class="small muted gap">${e(d.requirements || '대상별 강조점을 아직 입력하지 않았습니다.')} · 채용 공고 자동 분석은 미연결입니다.</p>${d.entries.map((x) => `<div class="record"><h3>${e(x.title)}</h3><p class="small muted gap">${e(d.entrySources?.[x.taskId]?.selectionReason || (d.entrySources?.[x.taskId]?.automatic ? '구독한 제품의 작업 보고에서 연결' : '사용자가 이 대상의 사례로 선택'))} · ${e(productName(data.tasks.find((t) => t.id === x.taskId)?.productId))}</p>${button('원본 경험 보기', `portfolio-evidence:${x.taskId}`, 'class="plain"')}</div>`).join('')}</details>`;
}
function scopePage() {
  const p = product();
  if (!p) return newProduct();
  return (
    header('제품 설정', p.name) +
    `<section class="settings-connection"><div><h2>제품 폴더와 결과 수집</h2><p class="small muted">${e(observation(p))}</p></div>${button('연결 관리', 'nav:product')}</section><section class="section"><h2>제품 목표</h2><form data-form="goal" data-id="${p.id}" class="form gap">${field('goal', '이 제품에서 이루고 싶은 것', p.goal, 'textarea', 'maxlength="2000"')}<div><button type="submit">목표 저장</button></div></form></section>${operationSettings(p, data)}`
  );
}
