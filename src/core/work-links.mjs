import { z } from 'zod';
import { applyTaskToPortfolio, entryFromTask } from './portfolio-sync.mjs';
import { projectWork, sourceReports, isExecutionEvidence } from './work-projection.mjs';

const id = z.string().uuid();
const revision = z.number().int().positive();
export const linkSchema = z
  .object({
    id,
    revision,
    parentTaskId: id.nullable(),
    parentRevision: revision.optional(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const recordReviewSchema = z
  .object({
    id,
    revision,
    content: z.string().trim().min(1).max(8000),
    scope: z.string().trim().min(1).max(1000),
    validity: z.enum(['valid', 'needs_review']),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const sourceReviewSchema = z
  .object({ id, revision, taskId: id, mode: z.enum(['keep', 'regenerate']) })
  .strict();

export class WorkLinks {
  constructor(store) {
    this.store = store;
  }
  archiveReport(task) {
    if (
      this.store
        .list('work-report')
        .some((r) => r.taskId === task.id && r.sourceVersion === (task.sourceVersion || 1))
    )
      return;
    const { parentTaskId, linkReason, portfolioHold, ...snapshot } = task;
    this.store.create('work-report', {
      taskId: task.id,
      productId: task.productId,
      sourceVersion: task.sourceVersion || 1,
      snapshot,
    });
  }
  refreshPortfolios(ids, { correction = false, allowNew = true } = {}) {
    const tasks = this.store.list('task');
    for (const p of this.store.list('portfolio')) {
      let next = structuredClone(p);
      const redundant = (id) => {
        const task = tasks.find((t) => t.id === id);
        return !!task && (!!task.parentTaskId || isExecutionEvidence(task, tasks));
      };
      // Free duplicate automatic slots before inserting their structured replacements.
      const ordered = [...new Set(ids.filter(Boolean))].sort(
        (a, b) => Number(redundant(b)) - Number(redundant(a)),
      );
      for (const taskId of ordered) {
        const raw = tasks.find((t) => t.id === taskId);
        if (!raw) continue;
        const source = next.entrySources?.[taskId];
        const index = next.entries.findIndex((e) => e.taskId === taskId);
        if (correction && index >= 0 && (!source?.automatic || source.editedFields?.length)) {
          next.entrySources ||= {};
          next.entrySources[taskId] = {
            ...(source || {
              automatic: false,
              editedFields: ['title', 'description', 'contribution'],
            }),
            sourceConflict: {
              reason: '실행 연결이 바뀌었습니다. 직접 쓴 문장을 현재 근거와 다시 확인하세요.',
              at: new Date().toISOString(),
            },
          };
        }
        if (raw.parentTaskId || isExecutionEvidence(raw, tasks)) {
          if (
            index >= 0 &&
            source?.automatic &&
            !source.editedFields.length &&
            !source.agentEdited
          ) {
            next.entries.splice(index, 1);
            delete next.entrySources[taskId];
          }
          next.pendingTaskIds = (next.pendingTaskIds || []).filter((x) => x !== taskId);
          continue;
        }
        const projected = projectWork(raw, tasks);
        if (index >= 0) {
          // Refresh existing generated fields even after a subscription is turned off
          // when the user explicitly corrects their source connections.
          if (correction && source?.automatic) {
            const candidate = entryFromTask(projected);
            for (const field of ['title', 'description', 'contribution'])
              if (!source.editedFields.includes(field))
                next.entries[index][field] = candidate[field];
          } else next = applyTaskToPortfolio(next, projected);
        } else if (allowNew && !raw.portfolioHold) next = applyTaskToPortfolio(next, projected);
      }
      if (JSON.stringify(next) !== JSON.stringify(p)) {
        this.store.update('portfolio', p.id, p.revision, next);
        this.store.log(
          correction ? '실행 연결 정정을 초안에 반영' : '작업 보고를 초안에 반영',
          p.id,
        );
      }
    }
  }
  changeLink(input) {
    const d = linkSchema.parse(input);
    return this.store.transaction(() => {
      const task = this.store.get('task', d.id);
      if (task.kind !== 'work' || task.revision !== d.revision)
        throw new Error('작업이 변경되었습니다. 연결할 내용을 다시 확인하세요.');
      if ((task.parentTaskId || null) === d.parentTaskId && !isExecutionEvidence(task))
        throw new Error('이미 같은 작업에 연결되어 있습니다.');
      if (this.store.list('task').some((t) => t.parentTaskId === task.id))
        throw new Error('연결된 실행이 있는 작업입니다. 먼저 하위 실행의 연결을 정리하세요.');
      if (d.parentTaskId) {
        const parent = this.store.get('task', d.parentTaskId);
        if (
          parent.id === task.id ||
          parent.kind !== 'work' ||
          parent.productId !== task.productId ||
          parent.parentTaskId
        )
          throw new Error('같은 제품의 독립된 작업만 연결 대상으로 선택할 수 있습니다.');
        if (parent.revision !== d.parentRevision)
          throw new Error('대상 작업이 변경되었습니다. 다시 확인하세요.');
      }
      this.archiveReport(task);
      const saved = this.store.update('task', task.id, task.revision, {
        ...task,
        parentTaskId: d.parentTaskId,
        linkReason: d.reason,
        portfolioHold: !d.parentTaskId,
      });
      // Increment affected problem revisions so concurrent reviews cannot use stale graphs.
      for (const parentId of new Set([task.parentTaskId, d.parentTaskId].filter(Boolean))) {
        const parent = this.store.get('task', parentId);
        this.store.update('task', parent.id, parent.revision, {
          ...parent,
          connectionsUpdatedAt: new Date().toISOString(),
        });
      }
      const change = this.store.create('work-link', {
        taskId: task.id,
        productId: task.productId,
        fromTaskId: task.parentTaskId || null,
        toTaskId: d.parentTaskId,
        reason: d.reason,
      });
      this.refreshPortfolios([task.id, task.parentTaskId, d.parentTaskId], {
        correction: true,
        allowNew: false,
      });
      this.store.log(
        d.parentTaskId ? '실행을 문제에 연결' : '실행을 별도 작업으로 분리',
        task.id,
        d.reason,
      );
      return { task: saved, change };
    });
  }
  reviewRecord(input) {
    const d = recordReviewSchema.parse(input);
    return this.store.transaction(() => {
      const old = this.store.get('record', d.id);
      if (old.revision !== d.revision)
        throw new Error('기록이 바뀌었습니다. 현재 조건을 다시 확인하세요.');
      this.store.create('record-version', { recordId: old.id, snapshot: old });
      const saved = this.store.update('record', old.id, d.revision, {
        ...old,
        content: d.content,
        scope: d.scope,
        validity: d.validity,
        validityReason: d.reason,
        edited: true,
      });
      this.store.log(
        d.validity === 'needs_review' ? '참조 절차 보류' : '참조 조건 수정',
        old.id,
        d.reason,
      );
      return saved;
    });
  }
  reviewPortfolioSource(input) {
    const d = sourceReviewSchema.parse(input);
    return this.store.transaction(() => {
      const p = this.store.get('portfolio', d.id);
      if (p.revision !== d.revision)
        throw new Error('초안이 바뀌었습니다. 현재 문장과 근거를 다시 확인하세요.');
      const index = p.entries.findIndex((e) => e.taskId === d.taskId);
      if (index < 0 || !p.entrySources?.[d.taskId]?.sourceConflict)
        throw new Error('다시 확인할 연결 변경이 없습니다.');
      const task = this.store.get('task', d.taskId);
      const next = structuredClone(p);
      if (d.mode === 'regenerate') {
        next.entries[index] = entryFromTask(projectWork(task, this.store.list('task')));
        next.entrySources[d.taskId] = { automatic: true, editedFields: [] };
      } else delete next.entrySources[d.taskId].sourceConflict;
      next.entrySources[d.taskId].reviewedReports = sourceReports(task, this.store.list('task'));
      const saved = this.store.update('portfolio', p.id, p.revision, next);
      this.store.log(
        '초안과 변경된 근거 확인',
        p.id,
        d.mode === 'keep' ? '직접 쓴 문장 유지' : '현재 근거의 문장 사용',
      );
      return saved;
    });
  }
}
