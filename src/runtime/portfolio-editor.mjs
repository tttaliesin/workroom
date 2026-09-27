import { z } from 'zod';
import { digest } from './files.mjs';
import { projectWork } from '../core/work-projection.mjs';
import { redact } from './errors.mjs';

export class PortfolioEditor {
  constructor(engine) {
    this.engine = engine;
    this.store = engine.store;
  }
  sources(portfolio) {
    const tasks = this.store.list('task');
    const sources = [];
    let remaining = 32000;
    const terms = [
      ...new Set(
        `${portfolio.target} ${portfolio.requirements}`
          .toLowerCase()
          .match(/[\p{L}\p{N}+#.-]{2,}/gu) || [],
      ),
    ];
    const candidates = tasks
      .filter(
        (t) =>
          t.kind === 'work' &&
          !t.parentTaskId &&
          !portfolio.excludedTaskIds?.includes(t.id) &&
          (portfolio.autoProductIds?.includes(t.productId) ||
            portfolio.entries.some((e) => e.taskId === t.id)),
      )
      .map((t) => {
        const projected = projectWork(t, tasks);
        const haystack =
          `${projected.title} ${projected.summary} ${projected.contribution}`.toLowerCase();
        return {
          t,
          projected,
          score: terms.reduce((sum, term) => sum + Number(haystack.includes(term)), 0),
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.t.updated.localeCompare(a.t.updated) ||
          a.t.id.localeCompare(b.t.id),
      );
    for (const { t, projected: p } of candidates) {
      if (sources.length >= 30) break;
      const source = {
        id: t.id,
        revision: t.revision,
        productId: t.productId,
        title: p.title,
        summary: redact(p.summary).slice(0, 2000),
        contribution: redact(p.contribution).slice(0, 1000),
        limitations: redact(p.limitations).slice(0, 1200),
      };
      const length = JSON.stringify(source).length;
      if (length > remaining) continue;
      sources.push(source);
      remaining -= length;
    }
    return sources.sort((a, b) => a.id.localeCompare(b.id));
  }
  signature(p, sources = this.sources(p)) {
    return digest(
      JSON.stringify([
        p.target,
        p.requirements,
        p.jobSourceId,
        [...(p.autoProductIds || [])].sort(),
        [...(p.excludedTaskIds || [])].sort(),
        sources,
      ]),
    );
  }
  configure({ id, revision, enabled }) {
    z.object({ id: z.string().uuid(), revision: z.number().int(), enabled: z.boolean() })
      .strict()
      .parse({ id, revision, enabled });
    const p = this.store.get('portfolio', id);
    const next = this.store.update('portfolio', id, revision, { ...p, autoEdit: enabled });
    this.store.log('대상별 자동 편집 설정', id, enabled ? '켬' : '끔');
    if (!enabled)
      for (const t of this.store
        .list('task')
        .filter(
          (t) =>
            t.mode === 'portfolio' &&
            t.portfolioId === id &&
            t.automatic &&
            (['running', 'queued', 'waiting_auth'].includes(t.status) || t.retryAt),
        ))
        void this.engine.stop({ id: t.id });
    return next;
  }
  startsToday(portfolioId) {
    const day = this.engine.operations.day();
    return (
      this.store
        .list('portfolio-edit')
        .filter((e) => e.portfolioId === portfolioId && e.day === day).length +
      this.store
        .list('task')
        .filter((t) => t.portfolioId === portfolioId)
        .reduce((sum, t) => sum + (t.retryStarts || []).filter((d) => d === day).length, 0)
    );
  }
  request({ portfolioId, automatic = false }) {
    z.string().uuid().parse(portfolioId);
    const p = this.store.get('portfolio', portfolioId);
    if (automatic && !p.autoEdit) return null;
    if (this.engine.settings.paused || !this.engine.settings.modelId || !this.engine.canRun()) {
      if (automatic) return null;
      throw new Error('계정과 모델 연결, 새 실행 상태를 확인하세요.');
    }
    const active = this.store
      .list('task')
      .find(
        (t) =>
          t.mode === 'portfolio' &&
          t.portfolioId === portfolioId &&
          ['queued', 'running', 'stopping', 'waiting_auth'].includes(t.status),
      );
    if (active) return active;
    const sources = this.sources(p);
    if (!p.requirements.trim() || !sources.length) {
      if (automatic) return null;
      throw new Error('대상별 강조점과 연결된 작업 결과가 필요합니다.');
    }
    const signature = this.signature(p, sources);
    const edits = this.store.list('portfolio-edit').filter((e) => e.portfolioId === portfolioId);
    if (
      automatic &&
      (edits.some((e) => e.signature === signature) || this.startsToday(portfolioId) >= 2)
    )
      return null;
    const edit = this.store.create('portfolio-edit', {
      portfolioId,
      portfolioRevision: p.revision,
      target: p.target,
      requirements: p.requirements,
      sources,
      signature,
      status: 'writing',
      automatic,
      day: this.engine.operations.day(),
    });
    const task = this.engine.startManaged({
      productId: sources[0].productId,
      mode: 'portfolio',
      stage: 'curate',
      portfolioId,
      editId: edit.id,
      automatic,
      title: `${p.target} · 경험 정리`,
      goal: `대상: ${p.target}\n강조할 경험: ${p.requirements}\n제공된 실제 작업 결과에서 근거를 인용해 이 대상의 소개와 사례를 제안하세요.`,
    });
    this.store.update('portfolio-edit', edit.id, edit.revision, { ...edit, taskId: task.id });
    this.store.log('대상별 편집 시작', p.id, task.id);
    return task;
  }
  assertTask(task) {
    const p = this.store.get('portfolio', task.portfolioId),
      edit = this.store.get('portfolio-edit', task.editId);
    if (task.automatic && !p.autoEdit) throw new Error('자동 편집이 꺼졌습니다.');
    if (p.revision !== edit.portfolioRevision || this.signature(p) !== edit.signature)
      throw new Error('대상 초안이나 원본 보고가 바뀌었습니다. 새 기준으로 정리하세요.');
  }
  handoff(task) {
    const edit = this.store.get('portfolio-edit', task.editId);
    return { target: edit.target, requirements: edit.requirements, sources: edit.sources };
  }
  validate(task, run, result) {
    this.assertTask(task);
    const edit = this.store.get('portfolio-edit', task.editId);
    if (run.role === 'curate_review') {
      const proposal = task.outputs.curate.result;
      const required = new Set(
        [...proposal.introCitations, ...proposal.entries.flatMap((e) => e.citations)].map(
          (c) => c.taskId,
        ),
      );
      if (
        [...required].some((id) => !result.sourceTaskIds.includes(id)) ||
        result.sourceTaskIds.some((id) => !edit.sources.some((s) => s.id === id))
      )
        throw new Error('초안의 모든 출처를 별도로 확인해야 합니다.');
      return;
    }
    if (new Set(result.entries.map((e) => e.taskId)).size !== result.entries.length)
      throw new Error('같은 사례를 중복 선택했습니다.');
    for (const entry of result.entries)
      if (
        !edit.sources.some((s) => s.id === entry.taskId) ||
        !entry.citations.some((c) => c.taskId === entry.taskId)
      )
        throw new Error('이 사례의 원본 근거가 필요합니다.');
    for (const c of [...result.introCitations, ...result.entries.flatMap((e) => e.citations)]) {
      const source = edit.sources.find((s) => s.id === c.taskId && s.revision === c.revision);
      if (
        !source ||
        ![source.summary, source.contribution, source.limitations].some((text) =>
          text.includes(c.quote),
        )
      )
        throw new Error('원본 작업의 해당 버전에 없는 인용입니다.');
    }
  }
  transition(task, role, result) {
    return role === 'curate'
      ? { stage: 'curate_review', status: 'queued' }
      : {
          stage: 'curate_review',
          status: result.verdict === 'supported' ? 'accepted' : 'needs_review',
          message:
            result.verdict === 'supported'
              ? '대상별 초안과 별도 근거 검토를 저장했습니다.'
              : '초안에 보완할 주장이 있어 반영하지 않았습니다.',
        };
  }
  materialize(task) {
    if (task.mode !== 'portfolio') return;
    const edit = this.store.get('portfolio-edit', task.editId);
    if (['applied', 'proposed', 'needs_review', 'stale', 'failed', 'stopped'].includes(edit.status))
      return;
    if (!task.outputs.curate_review) {
      const terminal = [
        'failed',
        'stopped',
        'interrupted',
        'needs_review',
        'waiting_quota',
      ].includes(task.status);
      const p = this.store.get('portfolio', edit.portfolioId),
        stale = p.revision !== edit.portfolioRevision || this.signature(p) !== edit.signature;
      const status = terminal
        ? task.status === 'needs_review'
          ? stale
            ? 'stale'
            : 'needs_review'
          : task.status === 'stopped'
            ? 'stopped'
            : 'failed'
        : task.outputs.curate
          ? 'reviewing'
          : 'writing';
      if (status !== edit.status)
        this.store.update('portfolio-edit', edit.id, edit.revision, {
          ...edit,
          status,
          message: task.message,
          proposal: task.outputs.curate?.result,
        });
      return;
    }
    const saved = this.store.update('portfolio-edit', edit.id, edit.revision, {
      ...edit,
      proposal: task.outputs.curate.result,
      review: task.outputs.curate_review.result,
      status: task.status === 'accepted' ? 'proposed' : 'needs_review',
    });
    this.store.log('대상별 편집 결과', edit.portfolioId, saved.status);
    if (task.status === 'accepted' && task.automatic) {
      try {
        this.apply({ id: edit.id });
      } catch (error) {
        const current = this.store.get('portfolio-edit', edit.id);
        this.store.update('portfolio-edit', edit.id, current.revision, {
          ...current,
          status: 'stale',
          message: error.message,
        });
        this.store.log('초안 반영 보류', edit.portfolioId, error.message);
      }
    }
  }
  apply({ id }) {
    z.string().uuid().parse(id);
    let edit = this.store.get('portfolio-edit', id);
    if (edit.status !== 'proposed' || edit.review?.verdict !== 'supported')
      throw new Error('근거 검토를 통과한 제안만 반영할 수 있습니다.');
    const p = this.store.get('portfolio', edit.portfolioId);
    if (p.revision !== edit.portfolioRevision || this.signature(p) !== edit.signature)
      throw new Error('초안 또는 출처가 변경됐습니다. 현재 기준으로 다시 정리하세요.');
    return this.store.transaction(() => {
      const next = structuredClone(p),
        proposal = edit.proposal;
      if (!p.intro || p.intro === p.lastAgentIntro) {
        next.intro = proposal.intro;
        next.lastAgentIntro = proposal.intro;
      }
      next.entrySources ||= {};
      const selected = new Set(proposal.entries.map((e) => e.taskId));
      const omitted = p.entries
        .filter(
          (e) =>
            !selected.has(e.taskId) &&
            p.entrySources?.[e.taskId]?.automatic &&
            !p.entrySources[e.taskId].editedFields.length,
        )
        .map((e) => e.taskId);
      next.agentOmittedTaskIds = [
        ...new Set([...(p.agentOmittedTaskIds || []), ...omitted]),
      ].filter((id) => !selected.has(id));
      next.entries = next.entries.filter((e) => !omitted.includes(e.taskId));
      for (const entry of proposal.entries) {
        if (p.excludedTaskIds?.includes(entry.taskId)) continue;
        const index = next.entries.findIndex((e) => e.taskId === entry.taskId),
          source = p.entrySources?.[entry.taskId];
        const publicEntry = Object.fromEntries(
          ['taskId', 'title', 'description', 'contribution'].map((k) => [k, entry[k]]),
        );
        if (index < 0) {
          if (next.entries.length >= 20) continue;
          next.entries.push(publicEntry);
          next.entrySources[entry.taskId] = {
            automatic: true,
            editedFields: [],
            agentEdited: true,
          };
        } else if (source?.automatic) {
          for (const key of ['title', 'description', 'contribution'])
            if (!source.editedFields.includes(key)) next.entries[index][key] = entry[key];
          next.entrySources[entry.taskId] = { ...source, agentEdited: true };
          if (!source.editedFields.length) delete next.entrySources[entry.taskId].sourceConflict;
        }
        if (next.entrySources[entry.taskId])
          next.entrySources[entry.taskId] = {
            ...next.entrySources[entry.taskId],
            selectionReason: entry.reason,
            citations: entry.citations,
            editId: edit.id,
          };
      }
      const saved = this.store.update('portfolio', p.id, p.revision, next);
      edit = this.store.update('portfolio-edit', edit.id, edit.revision, {
        ...edit,
        status: 'applied',
        appliedPortfolioRevision: saved.revision,
        appliedAt: new Date().toISOString(),
      });
      this.store.log('대상별 초안 반영', p.id, '사용자 편집·순서·제외 보존');
      return edit;
    });
  }
  async tick() {
    for (const task of this.store.list('task').filter((t) => t.mode === 'portfolio'))
      this.materialize(task);
    for (const p of this.store.list('portfolio').filter((p) => p.autoEdit))
      this.request({ portfolioId: p.id, automatic: true });
  }
}
