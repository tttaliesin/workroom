import { t as tr, localizedLabels, rawLabels } from '../shared/i18n.mjs';
import { agentLabels } from './runtime-ui.js';
export const app = document.getElementById('app');
export const ui = {
  view: 'home',
  productId: null,
  taskId: null,
  portfolioId: null,
  portfolioSection: 'write',
  draft: null,
  dirty: false,
  formDirty: false,
  dirtyForms: [],
  resetForm: false,
  resetForms: [],
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
export let data = { products: [], tasks: [], records: [], portfolios: [], audit: [] };
try {
  ui.portfolioAccountReturn = sessionStorage.getItem('workroom-portfolio-return');
} catch {}
try {
  // Reopening always starts on the last product's overview by design; only the selections
  // that each area resumes from are restored, never the last screen itself.
  const saved = JSON.parse(localStorage.getItem('workroom-navigation') || 'null');
  if (saved && typeof saved === 'object') {
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
  ui.accountReturn = sessionStorage.getItem('workroom-account-return');
} catch {}
try {
  ui.requestOrigin = JSON.parse(sessionStorage.getItem('workroom-request-origin') || 'null');
} catch {}
export function requestDraft() {
  return (
    ui.requests[ui.productId] || {
      mode: 'investigation',
      goal: '',
      testFiles: '',
      allowTests: false,
    }
  );
}
// Unsaved-input protection is tracked per form, so saving or failing one form on a screen
// never releases or resets the edits in another. `ui.formDirty` stays the single flag that
// navigation checks; the request dialog also sets it directly when its draft cannot be stored.
export const formKey = (form) => `${form.dataset.form}|${form.dataset.id || ''}`;
export function markFormDirty(form) {
  const key = formKey(form);
  if (!ui.dirtyForms.includes(key)) ui.dirtyForms.push(key);
  ui.formDirty = true;
}
// A form was saved: stop protecting it and show its stored values on the next render.
export function settleForm(form) {
  const key = formKey(form);
  ui.dirtyForms = ui.dirtyForms.filter((k) => k !== key);
  ui.resetForms.push(key);
  ui.formDirty = ui.dirtyForms.length > 0 || !!ui.requestSaveFailed;
}
// The user discarded their input: every form returns to its stored values.
export function discardForms() {
  ui.dirtyForms = [];
  ui.formDirty = false;
  ui.resetForm = true;
}
export function persistRequests() {
  try {
    localStorage.setItem('workroom-requests', JSON.stringify(ui.requests));
    ui.requestSaveFailed = false;
  } catch {
    ui.requestSaveFailed = true;
    ui.formDirty = true;
  }
}
export const hasTaskPane = () => data.products.length > 0 && (ui.view === 'ops' || portfolioArea());
export const labels = localizedLabels({
  needs_decision: '판단 필요',
  deferred: '보류',
  decided: '결정 기록됨',
  completed: '점검 완료',
  partial: '점검 완료 · 일부 미확인',
  reported: '결과 보고 · 독립 검증 없음',
});
Object.assign(labels, rawLabels(agentLabels));
export const actorLabel = (actor) =>
  ({
    mcp: tr('MCP 에이전트'),
    'codex-hook': tr('Codex 자동 수집'),
    pi: tr('내장 Pi'),
    user: tr('사용자'),
  })[actor] || tr('보고자');
export const provenance = localizedLabels({
  observed: '앱이 관찰',
  reported: '보고된 내용',
  user: '사용자 기록',
});
export const productName = (id) => data.products.find((p) => p.id === id)?.name || tr('제품');
export const product = () => data.products.find((p) => p.id === ui.productId) || data.products[0];
export const rootTasks = () => {
  const results = new Set(data.tasks.filter((t) => t.kind === 'agent').map((t) => t.resultTaskId));
  return data.tasks.filter((t) => !t.parentTaskId && !results.has(t.id));
};
export const portfolioArea = () => ['portfolio', 'new-target'].includes(ui.view);
export const locationKey = () =>
  `${ui.view}:${ui.productId}:${ui.taskId}:${ui.portfolioId}:${ui.recordId}:${ui.source}:${ui.editing}:${ui.portfolioSection}`;
export const shortStatus = localizedLabels({
  reported: '보고됨',
  completed: '점검 완료',
  partial: '일부 미확인',
  needs_decision: '판단 필요',
  deferred: '보류',
  decided: '결정됨',
});
Object.assign(shortStatus, rawLabels(agentLabels));
export function loadDraft(id) {
  const p = data.portfolios.find((x) => x.id === id);
  if (p) {
    ui.portfolioId = p.id;
    ui.draft = structuredClone(p);
    ui.draftBase = structuredClone(p);
    ui.conflictRemote = null;
    ui.dirty = false;
  }
}
export function setData(next) {
  data = next;
}
