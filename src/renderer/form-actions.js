import { t as tr } from '../shared/i18n.mjs';
import { publicationCall } from './publication-ui.js';
import { call, flash, refresh, rememberRequest, run, runtimeCall } from './controller.js';
import {
  data,
  loadDraft,
  persistRequests,
  product,
  requestDraft,
  settleForm,
  ui,
} from './state.js';
const formActions = {
  'project-status': async (form, values) => {
    await call('updateProjectStatus', {
      id: form.dataset.id,
      revision: Number(form.dataset.revision),
      ...values,
    });
    await refresh();
    flash(tr('현황을 저장했습니다.'));
  },
  milestone: async (form, values) => {
    const { milestoneDate, ...fields } = values;
    await call('saveMilestone', {
      ...fields,
      targetDate: milestoneDate,
      productId: form.dataset.product,
      taskIds: new FormData(form).getAll('taskIds'),
      ...(form.dataset.id ? { id: form.dataset.id, revision: Number(form.dataset.revision) } : {}),
    });
    ui.milestoneEditor = false;
    ui.milestoneId = null;
    await refresh();
    flash(tr('마일스톤을 저장했습니다.'));
  },
  'job-source': async (form, values) => {
    await call('saveJobSource', {
      portfolioId: form.dataset.id,
      revision: Number(form.dataset.revision),
      ...values,
    });
    await refresh();
    loadDraft(form.dataset.id);
    flash(tr('공고 원문 버전을 저장했습니다.'));
  },
  'publication-credentials': async (form, values) => {
    form.elements.token.value = '';
    await publicationCall('credentials', { token: values.token });
    await refresh();
    flash(tr('Vercel 토큰을 보호 저장소에 저장했습니다.'));
  },
  'publication-destination': async (form, values) => {
    await publicationCall('configure', {
      portfolioId: form.dataset.id,
      version: Number(form.dataset.version),
      ...values,
    });
    await refresh();
    flash(tr('공개 대상을 저장했습니다.'));
  },
  'verification-profile': async (form, values) => {
    await runtimeCall('configureVerification', {
      productId: form.dataset.id,
      version: Number(form.dataset.version),
      enabled: !!values.enabled,
      scripts: values.scripts
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean),
      timeoutSeconds: Number(values.timeoutSeconds),
      allowExecution: !!values.allowExecution,
    });
    await refresh();
    flash(tr('검사 환경을 저장했습니다. 새 수정 작업부터 적용합니다.'));
  },
  'background-mode': async (_form, values) => {
    await runtimeCall('configure', { background: !!values.background });
    await refresh();
    flash(tr('실행 방식을 저장했습니다.'));
  },
  delegation: async (form) => {
    rememberRequest(form);
    const draft = requestDraft();
    if (ui.requestSaveFailed)
      throw new Error(tr('요청 초안을 보관하지 못했습니다. 입력을 유지하고 다시 시도해 주세요.'));
    const testFiles =
      draft.mode === 'change'
        ? draft.testFiles
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    if (testFiles.length && !draft.allowTests)
      throw new Error(tr('지정한 테스트의 실행을 허용하거나 테스트 경로를 비워주세요.'));
    if (!data.runtime?.modelId || !['connected', 'ready'].includes(data.runtime.state))
      throw new Error(tr('먼저 계정과 모델 연결을 완료해 주세요.'));
    const task = await runtimeCall('start', {
      productId: product().id,
      goal: draft.goal,
      mode: draft.mode,
      testFiles,
      allowTests: !!draft.allowTests,
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
    flash(tr('작업을 맡겼습니다. 진행 단계와 필요한 판단을 여기에서 확인할 수 있습니다.'));
  },
  'change-apply': async (form, values) => {
    const task = data.tasks.find((t) => t.id === form.dataset.id),
      change = data.agentChanges.find((c) => c.id === task.changeSetId);
    try {
      await runtimeCall('applyChange', {
        id: task.id,
        revision: task.revision,
        artifactHash: change.artifactHash,
        acceptUnconfirmed: !!values.acceptUnconfirmed,
      });
      flash(tr('검토한 수정본을 반영했습니다. 결과와 기록을 이어서 정리합니다.'));
    } finally {
      settleForm(form);
      await refresh();
    }
  },
  'operation-policy': async (form, values) => {
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
    settleForm(form);
    await refresh();
    flash(tr('운영 범위를 저장했습니다. 다음 일정부터 이 범위로 진행합니다.'));
  },
  'runtime-model': async (form, values) => {
    await runtimeCall('configure', values);
    await refresh();
    flash(
      ui.requestOpen
        ? tr('연결을 준비했습니다. 보관한 요청을 확인한 뒤 맡겨주세요.')
        : tr('작업 모델을 저장했습니다.'),
    );
  },
  'runtime-manual': async (form, values) => {
    document.getElementById('oauth-code').value = '';
    await runtimeCall('manualCode', values);
    await refresh();
  },
  product: async (form, values) => {
    const p = await call('createProduct', values);
    await refresh();
    ui.productId = p.id;
    ui.taskId = null;
    ui.view = 'home';
    flash(tr('제품을 연결했습니다. 첫 작업을 맡겨보세요.'));
  },
  goal: async (form, values) => {
    const p = data.products.find((p) => p.id === form.dataset.id);
    await call('updateProduct', { id: p.id, revision: p.revision, goal: values.goal });
    await refresh();
    flash(tr('현재 목표를 저장했습니다.'));
  },
  decision: async (form, values) => {
    const t = data.tasks.find((t) => t.id === form.dataset.id);
    await call('resolveDecision', {
      id: t.id,
      revision: t.revision,
      option: Number(values.option),
    });
    await refresh();
    flash(
      t.targetTaskId
        ? tr('답변을 저장하고 연결된 작업의 재개를 예약했습니다.')
        : tr('방침과 적용 범위를 기록했습니다. 에이전트가 다음 조회에서 확인할 수 있습니다.'),
    );
  },
  'new-decision': async (form, values) => {
    const t = await call('requestDecision', {
      productId: values.productId,
      title: values.title,
      reason: values.reason,
      ...(values.targetTaskId
        ? {
            targetTaskId: values.targetTaskId,
            targetRevision: data.tasks.find((t) => t.id === values.targetTaskId).revision,
          }
        : {}),
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
    flash(tr('판단 요청을 저장했습니다.'));
  },
  work: async (form, values) => {
    const t = await call('reportWork', values);
    await refresh();
    ui.productId = t.productId;
    ui.taskId = t.id;
    ui.view = 'ops';
    ui.source = null;
    flash(tr('작업 결과와 근거를 기록했습니다.'));
  },
  'work-link': async (form, values) => {
    const parentId = values.parentTaskId || null;
    const result = await call('changeWorkLink', {
      id: ui.linkBase.id,
      revision: ui.linkBase.revision,
      parentTaskId: parentId,
      ...(parentId ? { parentRevision: ui.linkBase.parents[parentId] } : {}),
      reason: values.reason,
    });
    settleForm(form);
    await refresh();
    if (ui.draft) loadDraft(ui.portfolioId);
    const previous = ui.history.pop();
    if (previous) Object.assign(ui, previous);
    else {
      ui.view = 'ops';
      ui.taskId = result.task.id;
    }
    flash(
      tr(
        '원본을 보존하고 실행 연결을 정정했습니다. 초안의 영향과 직접 편집한 문장을 함께 확인하세요.',
      ),
    );
  },
  'record-review': async (form, values) => {
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
    flash(tr('적용 조건과 유효성을 저장했습니다. 과거 제공 버전은 유지됩니다.'));
  },
  record: async (form, values) => {
    await call('addRecord', values);
    await refresh();
    ui.productId = values.productId;
    ui.view = 'records';
    flash(tr('적용 조건과 출처를 함께 저장했습니다.'));
  },
  target: async (form, values) => {
    const p = await call('createPortfolio', {
      target: values.target,
      requirements: values.requirements,
      autoProductIds: values.autoSubscribe && product() ? [product().id] : [],
    });
    await refresh();
    loadDraft(p.id);
    ui.view = 'portfolio';
    ui.editing = true;
    flash(tr('대상별 초안을 만들었습니다.'));
  },
};
export function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  run(async () => {
    ui.message = '';
    const submitForm = form.dataset.form;
    if (Object.hasOwn(formActions, submitForm)) await formActions[submitForm](form, values);
    settleForm(form);
  });
}
