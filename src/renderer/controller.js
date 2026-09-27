import { t as tr } from '../shared/i18n.mjs';
import { mergeDraft } from './merge-draft.js';
import { captureScreen, restoreScreen, saveNavigation } from './screen-state.js';
import { pendingMessage, shellHTML } from './shell.js';
import {
  app,
  data,
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
      ? tr('초안 저장 실패 · 이 창에서 다시 시도하세요.')
      : tr('초안 자동 저장됨');
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
    flash(tr('요청 초안을 보관하지 못했습니다. 입력을 유지하고 다시 시도해 주세요.'), true);
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
    flash(tr('연결을 준비했습니다. 보관한 요청을 확인한 뒤 맡겨주세요.'));
  }
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
  flash(tr('작성 중인 내용이 있습니다. 먼저 저장하거나 수정 취소를 선택하세요.'), true);
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
  const before = captureScreen();
  app.innerHTML = shellHTML();
  restoreScreen(before);
  ui.rendering = false;
  saveNavigation();
}
export async function saveDraft(preferLocal = false) {
  const latest = await call('snapshot');
  const remote = latest.portfolios.find((p) => p.id === ui.portfolioId);
  if (!remote) throw new Error(tr('대상을 찾을 수 없습니다. 현재 입력은 보존했습니다.'));
  if (preferLocal && remote.revision !== ui.conflictRemote?.revision) {
    ui.conflictRemote = remote;
    throw new Error(
      tr('저장된 초안이 다시 바뀌었습니다. 최신 내용을 확인하세요. 현재 입력은 보존했습니다.'),
    );
  }
  let d;
  try {
    d = mergeDraft(ui.draftBase, ui.draft, remote, preferLocal);
  } catch (error) {
    ui.conflictRemote = remote;
    ui.editing = true;
    throw error;
  }
  const saved = await call('savePortfolio', {
    id: d.id,
    revision: remote.revision,
    intro: d.intro,
    templateId: d.templateId,
    requirements: d.requirements,
    entries: d.entries,
    autoProductIds: d.autoProductIds || [],
  });
  await refresh();
  loadDraft(saved.id);
  ui.editing = false;
  flash(tr('초안을 저장했습니다.'));
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
      notice.textContent = tr`새 기록을 확인하지 못했습니다. 다음 확인 때 재시도합니다. ${error.message}`;
  } finally {
    ui.syncing = false;
  }
}
export async function run(fn) {
  if (ui.busy) return;
  ui.busy = true;
  app
    .querySelectorAll('button[type=submit],button[data-action^="inspect:"],#jev-product')
    .forEach((b) => {
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
