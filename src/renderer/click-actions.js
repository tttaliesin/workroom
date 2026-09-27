import { t as tr } from '../shared/i18n.mjs';
import {
  call,
  canLeave,
  closeRequest,
  flash,
  go,
  pushLocation,
  refresh,
  rememberLocation,
  render,
  returnLocation,
  returnToRequest,
  run,
  runtimeCall,
  saveDraft,
  startRequest,
} from './controller.js';
import { app, data, loadDraft, persistRequests, requestDraft, rootTasks, ui } from './state.js';
import { jevAction } from './jev-actions.js';
async function codexConnection(action, value) {
  const response = await window.workroom.codexConnection(action, ui.productId, value);
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
async function connectionStatus(action = 'status', value) {
  ui.codexStatus = null;
  const result = await codexConnection(action, value);
  ui.codexStatus = { ...result, productId: ui.productId };
}
async function operationAction(id, action) {
  if (!canLeave()) return;
  let task;
  if (action === 'operation-check') task = await runtimeCall('checkOperations', { productId: id });
  if (action === 'issue-start' || action === 'issue-defer')
    task = await runtimeCall('issueAction', {
      id,
      action: action === 'issue-start' ? 'investigate' : 'defer',
    });
  if (action === 'portfolio-edit') task = await runtimeCall('editPortfolio', { portfolioId: id });
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
        ? tr('현재 운영 상태를 확인했습니다.')
        : tr('운영 상태를 저장했습니다.'),
    );
}
async function runtimeAction(id, action) {
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
}
async function agentRunAction(id, action) {
  if (!canLeave()) return;
  const task = data.tasks.find((t) => t.id === id);
  await runtimeCall(action === 'agent-stop' ? 'stop' : 'resume', {
    id,
    ...(action === 'agent-resume' ? { revision: task.revision } : {}),
  });
  await refresh();
}
async function delegateAction(id, action) {
  startRequest(
    undefined,
    action === 'agent-followup' ? data.tasks.find((t) => t.id === id) : undefined,
  );
}
async function openPortfolioAction(id, action) {
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
}
async function sourceReviewAction(id, action) {
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
  flash(tr('현재 근거를 확인한 결과를 저장했습니다. 내보낸 버전은 그대로입니다.'));
}
async function savePortfolioAction(id, action) {
  await saveDraft(action === 'save-portfolio-overwrite');
}
// Every data-action handled inside run(); actions without an entry still re-render.
const clickActions = {
  'operation-check': operationAction,
  'issue-start': operationAction,
  'issue-defer': operationAction,
  'portfolio-edit': operationAction,
  'portfolio-auto': operationAction,
  'portfolio-apply': operationAction,
  'runtime-login': runtimeAction,
  'runtime-device': runtimeAction,
  'runtime-cancel-login': runtimeAction,
  'runtime-logout': runtimeAction,
  'runtime-verify': runtimeAction,
  'runtime-restart': runtimeAction,
  'runtime-pause': runtimeAction,
  'agent-stop': agentRunAction,
  'agent-resume': agentRunAction,
  'agent-replan': async (id) => {
    if (!canLeave()) return;
    const previous = data.tasks.find((t) => t.id === id);
    const task = await runtimeCall('start', {
      productId: previous.productId,
      goal: previous.goal,
      mode: 'change',
      testFiles: previous.testFiles,
      // The replaced task was only started with the user's consent for these tests.
      allowTests: previous.testFiles.length > 0,
    });
    await refresh();
    ui.taskId = task.id;
    ui.view = 'ops';
    flash(tr('기존 수정안을 보존하고 최신 원본으로 새 수정을 맡겼습니다.'));
  },
  'toggle-list': async (id) => {
    ui.listOpen = !ui.listOpen;
  },
  delegate: delegateAction,
  'agent-followup': delegateAction,
  'request-restore': async (id) => {
    if (!canLeave() || !id.startsWith(ui.productId + '@') || !ui.requests[id]) return;
    const previous = requestDraft(),
      saved = ui.requests[id];
    if (previous.goal?.trim()) ui.requests[id] = { ...previous };
    else delete ui.requests[id];
    ui.requests[ui.productId] = saved;
    persistRequests();
    startRequest();
  },
  'delegate-return': async (id) => {
    if (!canLeave()) return;
    returnToRequest();
  },
  nav: async (id) => {
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
  },
  refresh: async (id) => {
    if (!canLeave()) return;
    await refresh();
    ui.draft = null;
    flash(tr('최신 기록을 불러왔습니다.'));
  },
  product: async (id) => {
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
  },
  task: async (id) => {
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
  },
  'open-executions': async (id) => {
    const group = app.querySelector('.execution-group');
    if (group) {
      group.open = true;
      group.scrollIntoView({ block: 'start' });
      group.querySelector('summary')?.focus({ preventScroll: true });
    }
  },
  source: async (id) => {
    ui.sourceExpanded = [...app.querySelectorAll('details[open]')].map(
      (d) => d.querySelector('summary')?.textContent,
    );
    ui.sourceScroll = document.querySelector('.main').scrollTop;
    ui.source = id;
    ui.evidenceReturn = 'ops';
  },
  'source-close': async (id) => {
    if (ui.evidenceReturn === 'route') {
      returnLocation();
    } else {
      if (go(ui.evidenceReturn || 'ops')) {
        ui.restoreExpanded = ui.evidenceReturn === 'ops' ? ui.sourceExpanded : null;
        ui.restoreScroll = ui.sourceScroll;
      }
    }
  },
  'portfolio-evidence': async (id) => {
    if (!canLeave()) return;
    pushLocation();
    const previousScroll = document.querySelector('.main').scrollTop;
    if (!go('ops')) return;
    ui.sourceScroll = previousScroll;
    ui.taskId = id;
    ui.productId = data.tasks.find((t) => t.id === id)?.productId;
    ui.source = 'evidence';
    ui.evidenceReturn = 'route';
  },
  'task-portfolio': openPortfolioAction,
  'open-portfolio': openPortfolioAction,
  'return-location': async (id) => {
    returnLocation();
  },
  target: async (id) => {
    if (!canLeave()) return;
    rememberLocation();
    loadDraft(id);
    ui.view = 'portfolio';
    ui.source = null;
    ui.review = false;
    ui.listOpen = false;
  },
  'record-detail': async (id) => {
    if (!canLeave()) return;
    pushLocation();
    await refresh();
    ui.recordId = id;
    ui.recordEditing = false;
    ui.view = 'record-detail';
    ui.source = null;
  },
  'record-edit': async (id) => {
    const record = data.records.find((r) => r.id === ui.recordId);
    ui.recordBaseRevision = record.revision;
    ui.recordEditing = true;
  },
  'record-cancel': async (id) => {
    ui.formDirty = false;
    ui.resetForm = true;
    ui.recordEditing = false;
  },
  'record-source': async (id) => {
    if (!canLeave()) return;
    pushLocation();
    ui.view = 'ops';
    ui.taskId = id;
    ui.productId = data.tasks.find((t) => t.id === id)?.productId;
    ui.source = 'evidence';
    ui.evidenceReturn = 'route';
  },
  'link-work': async (id) => {
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
  },
  'link-cancel': async (id) => {
    ui.formDirty = false;
    ui.resetForm = true;
    returnLocation();
  },
  'source-keep': sourceReviewAction,
  'source-regenerate': sourceReviewAction,
  'edit-portfolio': async (id) => {
    ui.editing = true;
  },
  'add-current': async (id) => {
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
  },
  inspect: async (id) => {
    if (!canLeave()) return;
    flash(tr('저장소를 읽고 있습니다…'));
    render();
    const t = await call('inspect', { productId: id });
    await refresh();
    ui.taskId = t.id;
    ui.view = 'ops';
    flash(tr('기본 점검 완료. 확인한 내용과 미확인 범위를 함께 저장했습니다.'));
  },
  'discard-form': async (id) => {
    ui.formDirty = false;
    ui.resetForm = true;
    flash(tr('저장하지 않은 입력을 취소했습니다.'));
  },
  defer: async (id) => {
    if (!canLeave()) return;
    const t = data.tasks.find((t) => t.id === id);
    await call('deferDecision', { id, revision: t.revision, deferred: t.status !== 'deferred' });
    await refresh();
    flash(
      t.status === 'deferred'
        ? tr('판단 대기로 되돌렸습니다.')
        : tr('보류했습니다. 해결된 것으로 처리하지 않습니다.'),
    );
  },
  'record-toggle': async (id) => {
    if (!canLeave()) return;
    const r = data.records.find((r) => r.id === id);
    await call('toggleRecord', { id, revision: r.revision, active: !r.active });
    await refresh();
    ui.relatedOpen = true;
    flash(
      r.active
        ? tr('다음 MCP 조회의 자동 참조에서 제외했습니다. 원본은 보존됩니다.')
        : tr('자동 참조에 다시 포함했습니다.'),
    );
  },
  'codex-prepare': async (id) => {
    if (!canLeave()) return;
    const result = await window.workroom.codexSetup(id);
    if (!result.ok) throw new Error(result.error);
    ui.hookPlan = result.value;
  },
  'codex-close': async (id) => {
    ui.hookPlan = null;
  },
  'codex-install': async (id) => {
    if (!canLeave() || ui.hookPlan?.productId !== id) return;
    const result = await window.workroom.codexSetup(id, ui.hookPlan.revision);
    if (!result.ok) throw new Error(result.error);
    ui.hookPlan = null;
    if (ui.codexStatus) ui.codexStatus = { ...ui.codexStatus, hooks: [], warnings: [] };
    await refresh();
    flash(
      tr('수집 설정을 저장했습니다. Codex 연결의 승인 화면을 열어 작업실 훅을 검토·승인하세요.'),
    );
  },
  'codex-toggle': async (id) => {
    if (!canLeave()) return;
    const p = data.products.find((p) => p.id === id);
    await call('setCodexCapture', { productId: id, enabled: !p.codexCaptureEnabled });
    await refresh();
    flash(
      p.codexCaptureEnabled
        ? tr('새 이벤트 수집을 중단했습니다. 기존 기록은 유지합니다.')
        : tr('수집을 다시 켰습니다. 다음 응답 종료 이벤트를 기다립니다.'),
    );
  },
  'connection-load': async (id) => {
    const response = await window.workroom.connectionInfo();
    if (!response.ok) throw new Error(response.error);
    ui.connection = response.value;
  },
  'connection-product': async (id) => {
    if (!canLeave()) return;
    ui.productId = id;
    ui.codexStatus = null;
    ui.mcpPlan = null;
  },
  'connection-status': async () => {
    await connectionStatus();
    await refresh();
  },
  'connection-select': async (kind) => {
    await connectionStatus('select', kind);
    ui.mcpPlan = null;
  },
  'connection-prepare': async () => {
    ui.mcpPlan = await codexConnection('prepare');
  },
  'connection-cancel': async () => {
    ui.mcpPlan = null;
  },
  'connection-install': async () => {
    if (!ui.mcpPlan) return;
    const result = await codexConnection('install', ui.mcpPlan.id);
    ui.mcpPlan = null;
    ui.mcpBackup = result.backup;
    ui.codexStatus = null;
    flash(tr('Codex에 MCP 설정을 저장했습니다. 실제 연결 검사로 서버 응답을 확인하세요.'));
    await connectionStatus();
  },
  'connection-probe': async () => {
    await connectionStatus('probe');
    flash(tr('MCP 서버의 도구 목록과 제품 데이터 조회를 확인했습니다.'));
  },
  'connection-terminal': async () => {
    await codexConnection('terminal');
  },
  'save-portfolio': savePortfolioAction,
  'save-portfolio-overwrite': savePortfolioAction,
  'discard-draft': async (id) => {
    await refresh();
    loadDraft(ui.portfolioId);
    ui.editing = false;
    flash(tr('저장된 초안으로 돌아왔습니다.'));
  },
  'remove-entry': async (id) => {
    ui.draft.entries.splice(Number(id), 1);
    ui.dirty = true;
  },
  'move-entry': async (id) => {
    const i = Number(id);
    [ui.draft.entries[i - 1], ui.draft.entries[i]] = [ui.draft.entries[i], ui.draft.entries[i - 1]];
    ui.dirty = true;
  },
  'review-export': async (id) => {
    if (!canLeave()) return;
    if (!ui.draft.intro.trim() || !ui.draft.entries.length)
      throw new Error(tr('소개와 작업 사례를 하나 이상 넣고 저장해주세요.'));
    ui.review = true;
  },
  'cancel-export': async (id) => {
    ui.review = false;
  },
  export: async (id) => {
    const result = await window.workroom.exportPortfolio(ui.draft.id, ui.draft.revision);
    if (!result.ok) throw new Error(result.error);
    if (result.value) {
      await refresh();
      loadDraft(ui.portfolioId);
      ui.review = false;
      flash(tr`HTML 저장 완료: ${result.value.filename} · 웹 배포는 하지 않았습니다.`);
    }
  },
};
export async function handleClick(event) {
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
    if (action.startsWith('jev-')) return jevAction(action);
    if (Object.hasOwn(clickActions, action)) await clickActions[action](id, action);
  });
}
