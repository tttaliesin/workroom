import { button, e, icon } from './html.js';
import { mergeDraft } from './merge-draft.js';
import { newTarget, portfolioPage } from './portfolio-views.js';
import { delegationPage, productHome } from './product-overview.js';
import { newRecord, recordDetailPage, recordsPage } from './record-views.js';
import { accountLabel, accountPage } from './runtime-ui.js';
import {
  accountReturnNotice,
  connectionPage,
  newDecision,
  newProduct,
  newWork,
  productPage,
  scopePage,
} from './setup-views.js';
import {
  data,
  hasTaskPane,
  loadDraft,
  locationKey,
  persistRequests,
  portfolioArea,
  product,
  requestDraft,
  rootTasks,
  setData,
  ui,
} from './state.js';
import { linkPage, operations, taskNav, taskPane } from './work-views.js';
export const app = document.getElementById('app');
export function rememberRequest(form) {
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
export function startRequest(mode, source) {
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
export function closeRequest() {
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
export function returnToRequest() {
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
export async function call(method, args = {}) {
  const response = await window.workroom.call(method, args);
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
export function flash(message, error = false) {
  ui.message = message;
  ui.error = error;
}
function pendingMessage() {
  return ui.review
    ? '새 기록이 도착했습니다. 검토 중인 내용은 유지하며, 검토를 닫으면 반영합니다.'
    : '새 기록이 도착했습니다. 입력은 저장 후 함께 반영됩니다.';
}
export async function runtimeCall(method, args = {}) {
  const response = await window.workroom.runtime(method, args);
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
export function rememberLocation() {
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
export function pushLocation() {
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
export function returnLocation() {
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
  setData(next);
  ui.externalPending = false;
  if (!data.products.some((p) => p.id === ui.productId)) ui.productId = data.products[0]?.id;
  if (!data.tasks.some((t) => t.id === ui.taskId && t.productId === ui.productId))
    ui.taskId =
      rootTasks().find((t) => t.productId === ui.productId && t.status === 'needs_decision')?.id ||
      rootTasks().find((t) => t.productId === ui.productId)?.id;
}
export async function refresh() {
  applySnapshot(await call('snapshot'));
  restoreRequestAfterSetup();
}
export function canLeave() {
  if (!ui.dirty && !ui.formDirty) return true;
  flash('작성 중인 내용이 있습니다. 먼저 저장하거나 수정 취소를 선택하세요.', true);
  return false;
}
export function go(view) {
  if (!canLeave()) return false;
  rememberLocation();
  ui.requestOpen = false;
  ui.view = view;
  ui.review = false;
  ui.source = null;
  ui.message = '';
  return true;
}
export function render() {
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
export async function saveDraft(preferLocal = false) {
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
export async function syncExternal() {
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
export async function run(fn) {
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
