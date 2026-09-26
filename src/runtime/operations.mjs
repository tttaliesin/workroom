import { z } from 'zod';
import { sourceTree } from './change-files.mjs';
import { digest, relativeFile } from './files.mjs';

const pending = ['queued', 'running', 'stopping', 'waiting_auth', 'applying'];
const rank = { high: 0, normal: 1, low: 2 };
const defaults = {
  enabled: false,
  intervalMinutes: 60,
  maxDailyStarts: 4,
  allowChanges: false,
  testFiles: [],
  maxRepairs: 0,
  version: 0,
};
export class Operations {
  constructor(engine, { now = Date.now } = {}) {
    this.engine = engine;
    this.store = engine.store;
    this.now = now;
    this.busy = false;
    this.scanning = new Set();
  }
  policy(productId) {
    return (
      this.store.list('operation-policy').find((p) => p.productId === productId) || {
        ...defaults,
        productId,
      }
    );
  }
  day() {
    return new Date(this.now()).toLocaleDateString('sv-SE');
  }
  count(productId) {
    return this.store
      .list('task')
      .filter((t) => t.productId === productId && t.automation?.day === this.day()).length;
  }
  save(policy, patch) {
    const current = this.policy(policy.productId);
    const body = { ...current, ...patch };
    return current.id
      ? this.store.update('operation-policy', current.id, current.revision, body)
      : this.store.create('operation-policy', body);
  }
  async configure(input) {
    const value = z
      .object({
        productId: z.string().uuid(),
        version: z.number().int().min(0),
        enabled: z.boolean(),
        intervalMinutes: z.number().int().min(15).max(10080),
        maxDailyStarts: z.number().int().min(1).max(12),
        allowChanges: z.boolean(),
        testFiles: z.array(z.string().max(1024)).max(8),
        allowTests: z.boolean().optional(),
        maxRepairs: z.number().int().min(0).max(1),
      })
      .strict()
      .parse(input);
    this.store.get('product', value.productId);
    const old = this.policy(value.productId);
    if (old.version !== value.version)
      throw new Error('운영 설정이 바뀌었습니다. 최신 설정을 다시 확인하세요.');
    for (const file of value.testFiles) {
      relativeFile(file);
      if (!/\.(test|spec)\.(mjs|cjs|js)$/.test(file) || /[*?\[\]{}]/.test(file))
        throw new Error('실제 Node 테스트 파일 경로만 지정하세요.');
    }
    if (value.allowChanges && value.testFiles.length && !value.allowTests)
      throw new Error('자동 수정안의 지정 테스트 실행을 허용하세요.');
    const { allowTests, ...settings } = value;
    const saved = this.save(old, {
      ...settings,
      testFiles: [...new Set(value.testFiles.map(relativeFile))],
      version: old.version + 1,
      nextAt: new Date(this.now()).toISOString(),
      lastFingerprint: null,
      lastReason: value.enabled
        ? '다음 확인 시 현재 상태를 살핍니다.'
        : '지속 운영이 꺼져 있습니다.',
    });
    this.store.log(
      '운영 범위 저장',
      saved.productId,
      `v${saved.version} · ${saved.enabled ? '켬' : '끔'}`,
    );
    for (const t of this.store
      .list('task')
      .filter((t) => t.automation && t.productId === saved.productId && pending.includes(t.status)))
      await this.engine.stop({ id: t.id });
    for (const issue of this.store
      .list('operation-issue')
      .filter(
        (i) => i.productId === saved.productId && ['proposed', 'awaiting_scope'].includes(i.status),
      ))
      this.link(issue, { policyVersion: saved.version });
    return saved;
  }
  assertTask(task) {
    if (!task.automation) return;
    const p = this.policy(task.productId);
    if (p.version !== task.automation.policyVersion || (!p.enabled && !task.automation.manual))
      throw new Error('이 작업을 시작한 운영 범위가 변경되었습니다.');
    if (task.mode === 'change' && !p.allowChanges)
      throw new Error('자동 수정안 작성을 허용하지 않았습니다.');
  }
  readyReason(p) {
    if (this.engine.settings.paused) return '새 실행이 일시 정지되어 있습니다.';
    if (
      !this.engine.settings.modelId ||
      !['ready', 'connected'].includes(this.engine.broker.status.state)
    )
      return '계정과 모델 연결을 기다립니다.';
    if (this.count(p.productId) >= p.maxDailyStarts)
      return `오늘의 새 작업 한도 ${p.maxDailyStarts}개를 사용했습니다.`;
    return null;
  }
  async observe({ productId, manual = false }) {
    if (this.scanning.has(productId)) return null;
    let p = this.policy(productId);
    if (!p.enabled && !manual) return null;
    const product = this.store.get('product', productId),
      reason = this.readyReason(p);
    if (reason) {
      this.note(p, reason);
      if (manual) throw new Error(reason);
      return null;
    }
    if (
      this.store
        .list('task')
        .some(
          (t) =>
            t.productId === productId &&
            t.automation &&
            (pending.includes(t.status) || t.status === 'awaiting_apply'),
        )
    ) {
      this.note(p, '이전 운영 작업의 완료 또는 원본 반영을 기다립니다.');
      return null;
    }
    this.scanning.add(productId);
    try {
      const version = p.version,
        tree = await sourceTree(product.folder);
      p = this.policy(productId);
      if (p.version !== version || this.engine.closed || this.engine.settings.paused) return null;
      if (this.store.get('product', productId).revision !== product.revision) return null;
      const fingerprint = digest(JSON.stringify([tree.hash, product.revision, p.version]));
      const previous = this.store
        .list('operation-observation')
        .find((o) => o.productId === productId && o.manifest);
      const changed = [
        ...new Set([...Object.keys(tree.manifest), ...Object.keys(previous?.manifest || {})]),
      ]
        .filter((f) => tree.manifest[f] !== previous?.manifest?.[f])
        .slice(0, 80);
      const unchanged = !manual && p.lastFingerprint === fingerprint;
      const observation = this.store.create('operation-observation', {
        productId,
        fingerprint,
        manifest: tree.manifest,
        changed,
        omitted: tree.omitted,
        policyVersion: p.version,
        productRevision: product.revision,
        at: new Date(this.now()).toISOString(),
        status: unchanged ? 'unchanged' : 'observed',
        manual,
      });
      p = this.save(p, {
        lastAt: observation.at,
        nextAt: new Date(this.now() + p.intervalMinutes * 60000).toISOString(),
        lastFingerprint: fingerprint,
        lastObservationId: observation.id,
        lastReason: unchanged
          ? '파일과 목표 변화 없음 · 모델 호출 생략'
          : '변화를 확인해 운영 판단을 맡겼습니다.',
      });
      if (unchanged) {
        this.store.log('운영 관측 · 변화 없음', productId);
        return observation;
      }
      if (!Object.keys(tree.manifest).length) {
        this.note(p, '읽을 수 있는 소스가 없어 모델 호출을 생략했습니다.');
        return observation;
      }
      const task = this.engine.startManaged({
        productId,
        mode: 'operation',
        stage: 'coordinate',
        title: '제품 변화와 다음 작업 확인',
        goal: `현재 목표: ${product.goal || product.name}\n관측한 소스와 기존 문제를 확인하고 근거가 있는 다음 작업만 우선순위와 함께 제안하세요.`,
        automation: {
          policyVersion: p.version,
          manual,
          day: this.day(),
          observationId: observation.id,
        },
      });
      this.store.update('operation-observation', observation.id, observation.revision, {
        ...observation,
        taskId: task.id,
        status: 'evaluating',
      });
      this.store.log('운영 판단 시작', productId, task.id);
      return task;
    } catch (error) {
      this.save(this.policy(productId), {
        nextAt: new Date(this.now() + p.intervalMinutes * 60000).toISOString(),
      });
      this.note(this.policy(productId), `점검 보류: ${error.message}`);
      if (manual) throw error;
      return null;
    } finally {
      this.scanning.delete(productId);
    }
  }
  note(p, reason) {
    if (p.lastReason !== reason) {
      this.save(p, { lastReason: reason });
      this.store.log('운영 대기', p.productId, reason);
    }
  }
  handoff(task) {
    if (task.mode !== 'operation') return undefined;
    const o = this.store.get('operation-observation', task.automation.observationId);
    return {
      changed: o.changed,
      files: Object.keys(o.manifest).slice(0, 160),
      omitted: o.omitted,
      issues: this.store
        .list('operation-issue')
        .filter((i) => i.productId === task.productId)
        .slice(0, 40)
        .map(({ key, title, status, priority }) => ({ key, title, status, priority })),
      scope: this.policy(task.productId),
    };
  }
  materialize(task) {
    if (!task.outputs?.coordinate || task.status !== 'accepted') return;
    this.assertTask(task);
    const observation = this.store.get('operation-observation', task.automation.observationId);
    this.store.transaction(() => {
      for (const issue of task.outputs.coordinate.result.issues) {
        const old = this.store
          .list('operation-issue')
          .find((i) => i.productId === task.productId && i.key === issue.key);
        if (old) continue;
        this.store.create('operation-issue', {
          ...issue,
          productId: task.productId,
          operationTaskId: task.id,
          observationId: observation.id,
          status: 'proposed',
          policyVersion: task.automation.policyVersion,
        });
      }
      if (observation.status !== 'completed')
        this.store.update('operation-observation', observation.id, observation.revision, {
          ...observation,
          status: 'completed',
          taskId: task.id,
        });
      this.store.log('운영 판단 결과 저장', task.id, task.outputs.coordinate.result.summary);
    });
  }
  async act({ id, action }) {
    z.object({ id: z.string().uuid(), action: z.enum(['investigate', 'defer']) })
      .strict()
      .parse({ id, action });
    const issue = this.store.get('operation-issue', id);
    if (action === 'defer') {
      for (const t of this.store
        .list('task')
        .filter((t) => t.automation?.issueId === id && pending.includes(t.status)))
        await this.engine.stop({ id: t.id });
      this.store.update('operation-issue', id, issue.revision, { ...issue, status: 'deferred' });
      this.store.log('운영 문제 보류', id);
      return;
    }
    return this.dispatch(issue, true);
  }
  dispatch(issue, manual = false) {
    const p = this.policy(issue.productId);
    if (!manual && (!p.enabled || p.version !== issue.policyVersion)) return;
    const reason = this.readyReason(p);
    if (reason) {
      this.note(p, reason);
      if (manual) throw new Error(reason);
      return;
    }
    if (['deferred', 'completed'].includes(issue.status) && !manual) return;
    const existing = this.store
      .list('task')
      .find((t) => t.automation?.issueId === issue.id && t.mode === 'investigation');
    if (existing) {
      if (!issue.investigationId)
        this.link(issue, { investigationId: existing.id, status: 'investigating' });
      return existing;
    }
    const task = this.engine.start(
      { productId: issue.productId, goal: issue.goal },
      {
        title: issue.title,
        reason: `운영 판단: ${issue.reason}`,
        automation: { policyVersion: p.version, manual, day: this.day(), issueId: issue.id },
      },
    );
    this.link(issue, {
      investigationId: task.id,
      status: 'investigating',
      policyVersion: p.version,
    });
    return task;
  }
  link(issue, patch) {
    const current = this.store.get('operation-issue', issue.id);
    const saved = this.store.update('operation-issue', current.id, current.revision, {
      ...current,
      ...patch,
    });
    this.store.log('운영 문제 진행', issue.id, patch.status || '연결');
    return saved;
  }
  async reconcile() {
    const issues = this.store
      .list('operation-issue')
      .sort((a, b) => rank[a.priority] - rank[b.priority] || a.created.localeCompare(b.created));
    for (let issue of issues) {
      if (issue.status === 'proposed') {
        this.dispatch(issue);
        continue;
      }
      if (['deferred', 'completed'].includes(issue.status)) continue;
      const p = this.policy(issue.productId);
      if (issue.investigationId && !issue.changeTaskId) {
        const t = this.store.get('task', issue.investigationId);
        if (t.status !== 'accepted') continue;
        if (issue.action !== 'prepare_change' || !t.outputs.investigate?.result.findings.length) {
          this.link(issue, { status: 'completed' });
          continue;
        }
        if (!p.enabled || !p.allowChanges) {
          if (issue.status !== 'awaiting_scope') this.link(issue, { status: 'awaiting_scope' });
          continue;
        }
        if (p.version !== issue.policyVersion) continue;
        if (this.readyReason(p)) continue;
        if (
          this.store
            .list('task')
            .some(
              (x) =>
                x.productId === issue.productId &&
                x.mode === 'change' &&
                (pending.includes(x.status) || x.status === 'awaiting_apply'),
            )
        )
          continue;
        let next = this.store
          .list('task')
          .find((t) => t.automation?.issueId === issue.id && t.mode === 'change');
        if (!next)
          next = this.engine.start(
            {
              productId: issue.productId,
              goal: `${issue.goal}\n조사의 다음 제안: ${t.outputs.investigate.result.nextStep}`.slice(
                0,
                2000,
              ),
              mode: 'change',
              sourceTaskId: t.id,
              testFiles: p.testFiles,
              // configure() refuses a change policy with tests unless allowTests was given.
              allowTests: true,
            },
            {
              title: issue.title,
              reason: '검토된 조사에서 허용 범위 안의 수정안으로 연결',
              automation: {
                policyVersion: p.version,
                day: this.day(),
                issueId: issue.id,
                manual: false,
                repairs: 0,
              },
            },
          );
        issue = this.link(issue, { changeTaskId: next.id, status: 'preparing_change' });
      }
      if (issue.changeTaskId) {
        const t = this.store.get('task', issue.changeTaskId);
        if (t.status === 'accepted') {
          this.link(issue, { status: 'completed' });
          continue;
        }
        if (t.status === 'awaiting_apply' && issue.status !== 'awaiting_apply')
          this.link(issue, { status: 'awaiting_apply' });
        if (
          p.enabled &&
          p.version === issue.policyVersion &&
          ['check_failed', 'changes_requested'].includes(t.status) &&
          (t.automation.repairs || 0) < p.maxRepairs &&
          !this.engine.active.has(t.id) &&
          !this.engine.settings.paused
        ) {
          const updated = this.engine.updateTask(
            t,
            { automation: { ...t.automation, repairs: (t.automation.repairs || 0) + 1 } },
            '운영 보완 한도 사용',
          );
          this.engine.resume({ id: updated.id, revision: updated.revision });
        }
      }
    }
  }
  async tick() {
    if (this.busy || this.engine.closed) return;
    this.busy = true;
    try {
      if (this.engine.settings.paused) return;
      for (const task of this.store
        .list('task')
        .filter((t) => t.mode === 'operation' && t.status === 'accepted')) {
        const o = this.store.get('operation-observation', task.automation.observationId);
        if (o.status !== 'completed') {
          try {
            this.materialize(task);
          } catch {}
        }
      }
      for (const o of this.store
        .list('operation-observation')
        .filter((o) => o.status === 'evaluating' && o.taskId)) {
        const task = this.store.get('task', o.taskId);
        if (!pending.includes(task.status) && task.status !== 'accepted') {
          this.store.update('operation-observation', o.id, o.revision, {
            ...o,
            status: task.status,
            message: task.message,
          });
          this.note(
            this.policy(o.productId),
            task.message || '이전 판단이 중단됐습니다. 지금 확인으로 다시 요청할 수 있습니다.',
          );
        }
      }
      await this.reconcile();
      for (const p of this.store
        .list('operation-policy')
        .filter((p) => p.enabled && (!p.nextAt || Date.parse(p.nextAt) <= this.now())))
        await this.observe({ productId: p.productId });
      await this.engine.editor.tick();
    } finally {
      this.busy = false;
    }
  }
}
