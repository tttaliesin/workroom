// A wake and its task transition commit together. Only the desktop instance executes wakes.
export class Recovery {
  constructor(engine, now = Date.now) {
    this.engine = engine;
    this.store = engine.store;
    this.now = now;
  }
  failure(task, failure, runId) {
    const retries = task.recoveryRetries || 0;
    const eligible =
      task.recoveryVersion === 1 &&
      (task.automation || task.automatic) &&
      ['network', 'transient'].includes(failure.code) &&
      retries < 2;
    const retryAt = eligible ? this.now() + [30000, 120000][retries] : null;
    if (retryAt)
      this.store.queueWake(
        `retry:${task.id}:${runId}`,
        'retry',
        task.id,
        { runId, productRevision: task.productRevision },
        retryAt,
      );
    return { failure, failedRunId: runId, retryAt };
  }
  tick() {
    const e = this.engine;
    if (e.closed || e.settings.paused) return;
    for (const wake of this.store.pendingWakes(this.now())) {
      if (wake.type === 'decision') {
        this.decision(wake);
        continue;
      }
      if (wake.type !== 'retry') continue;
      const task = this.store.find('task', wake.target_id);
      if (!task || task.failedRunId !== wake.payload.runId || task.status !== 'failed') {
        this.store.finishWake(wake.operation_key, 'superseded');
        continue;
      }
      if (e.active.has(task.id) || !e.canRun()) continue;
      try {
        e.operations.assertTask(task);
        if (task.mode === 'portfolio') e.editor.assertTask(task);
        if (this.store.get('product', task.productId).revision !== wake.payload.productRevision)
          throw new Error('제품 목표나 범위가 바뀌었습니다.');
      } catch (error) {
        e.updateTask(task, { status: 'needs_review', retryAt: null, message: error.message });
        this.store.finishWake(wake.operation_key, 'superseded');
        continue;
      }
      if (task.automation && e.operations.readyReason(e.operations.policy(task.productId)))
        continue;
      if (task.automatic && e.editor.startsToday(task.portfolioId) >= 2) continue;
      this.store.transaction(() => {
        e.resume({ id: task.id, revision: task.revision }, { recovery: true });
        this.store.finishWake(wake.operation_key);
      });
    }
  }
  decision(wake) {
    const e = this.engine,
      task = this.store.find('task', wake.target_id);
    if (
      !task ||
      task.status !== 'waiting_decision' ||
      task.decisionId !== wake.payload.decisionId
    ) {
      this.store.finishWake(wake.operation_key, 'superseded');
      return;
    }
    if (e.active.has(task.id)) return;
    if (task.automation && e.operations.readyReason(e.operations.policy(task.productId))) return;
    this.store.transaction(() => {
      const decision = this.store.get('task', task.decisionId);
      try {
        e.operations.assertTask(task);
        if (task.mode === 'portfolio') e.editor.assertTask(task);
        if (
          decision.status !== 'decided' ||
          this.store.get('product', task.productId).revision !== wake.payload.productRevision
        )
          throw new Error('판단 이후 제품 범위가 바뀌었습니다.');
        const ready = e.updateTask(task, {
          status: task.resumeStatus,
          decisionAnswer: { id: decision.id, ...decision.options[decision.selected] },
        });
        e.resume({ id: ready.id, revision: ready.revision }, { decision: true });
        this.store.finishWake(wake.operation_key);
      } catch (error) {
        e.updateTask(this.store.get('task', task.id), {
          status: 'needs_review',
          message: error.message,
        });
        this.store.finishWake(wake.operation_key, 'superseded');
      }
    });
  }
}
