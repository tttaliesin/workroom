import { call, flash, refresh, rememberRequest, run, runtimeCall } from './controller.js';
import { data, loadDraft, persistRequests, product, requestDraft, ui } from './state.js';
const formActions = {
  delegation: async (form) => {
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
    flash('작업을 맡겼습니다. 진행 단계와 필요한 판단을 여기에서 확인할 수 있습니다.');
  },
  'change-start': async (form, values) => {
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
      allowTests: !!values.allowTests,
    });
    await refresh();
    ui.taskId = task.id;
    ui.view = 'ops';
    flash(
      '분리된 수정안 작성을 맡겼습니다. 작업 폴더에 반영하기 전에 변경과 검사 결과를 확인할 수 있습니다.',
    );
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
      flash('검토한 수정본을 반영했습니다. 결과와 기록을 이어서 정리합니다.');
    } finally {
      ui.formDirty = false;
      ui.resetForm = true;
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
    ui.formDirty = false;
    ui.resetForm = true;
    await refresh();
    flash('운영 범위를 저장했습니다. 다음 일정부터 이 범위로 진행합니다.');
  },
  'runtime-model': async (form, values) => {
    await runtimeCall('configure', values);
    await refresh();
    flash(
      ui.requestOpen
        ? '연결을 준비했습니다. 보관한 요청을 확인한 뒤 맡겨주세요.'
        : '작업 모델을 저장했습니다.',
    );
  },
  'runtime-manual': async (form, values) => {
    document.getElementById('oauth-code').value = '';
    await runtimeCall('manualCode', values);
    await refresh();
  },
  'agent-start': async (form, values) => {
    const task = await runtimeCall('start', { productId: product().id, goal: values.goal });
    await refresh();
    ui.taskId = task.id;
    ui.view = 'ops';
    flash('조사를 맡겼습니다. 단계별 진행과 근거가 여기에 쌓입니다.');
  },
  product: async (form, values) => {
    const p = await call('createProduct', values);
    await refresh();
    ui.productId = p.id;
    ui.taskId = null;
    ui.view = 'home';
    flash('제품을 연결했습니다. 첫 작업을 맡겨보세요.');
  },
  goal: async (form, values) => {
    const p = data.products.find((p) => p.id === form.dataset.id);
    await call('updateProduct', { id: p.id, revision: p.revision, goal: values.goal });
    await refresh();
    flash('현재 목표를 저장했습니다.');
  },
  decision: async (form, values) => {
    const t = data.tasks.find((t) => t.id === form.dataset.id);
    await call('resolveDecision', {
      id: t.id,
      revision: t.revision,
      option: Number(values.option),
    });
    await refresh();
    flash('방침과 적용 범위를 기록했습니다. 에이전트가 다음 조회에서 확인할 수 있습니다.');
  },
  'new-decision': async (form, values) => {
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
  },
  work: async (form, values) => {
    const t = await call('reportWork', values);
    await refresh();
    ui.productId = t.productId;
    ui.taskId = t.id;
    ui.view = 'ops';
    ui.source = null;
    flash('작업 결과와 근거를 기록했습니다.');
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
    flash('적용 조건과 유효성을 저장했습니다. 과거 제공 버전은 유지됩니다.');
  },
  record: async (form, values) => {
    await call('addRecord', values);
    await refresh();
    ui.productId = values.productId;
    ui.view = 'records';
    flash('적용 조건과 출처를 함께 저장했습니다.');
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
    flash('대상별 초안을 만들었습니다.');
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
    ui.formDirty = false;
  });
}
