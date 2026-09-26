import { button, e, icon } from './html.js';
import { mergeDraft } from './merge-draft.js';
import { newTarget, portfolioPage, preview } from './portfolio-views.js';
import { delegationPage, productHome } from './product-overview.js';
import { newRecord, recordDetailPage, recordResults, recordsPage } from './record-views.js';
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
import { linkPage, operations, taskNav, taskPane, taskRows } from './work-views.js';
const app = document.getElementById('app');
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
async function runtimeCall(method, args = {}) {
  const response = await window.workroom.runtime(method, args);
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
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
  setData(next);
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
