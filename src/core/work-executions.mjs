import { createHash } from 'node:crypto';
import { z } from 'zod';

export const executionSchema = z
  .object({
    client: z.enum(['codex', 'claude']),
    sessionId: z.string().trim().min(1).max(300).optional(),
    turnId: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export const executionLinkSchema = z
  .object({
    status: z.enum(['unlinked', 'pending', 'linked', 'conflict']),
    linkIds: z.array(z.string().uuid()),
    hookTaskIds: z.array(z.string().uuid()),
    structuredTaskIds: z.array(z.string().uuid()),
  })
  .strict();
export const emptyExecutionLink = () => ({
  status: 'unlinked',
  linkIds: [],
  hookTaskIds: [],
  structuredTaskIds: [],
});
export const executionKey = (productId, sessionId, turnId) =>
  createHash('sha256').update(`${productId}\0${sessionId}\0${turnId}`).digest('hex');

// Reconcile durable observations with report receipts. This never executes a command.
export class WorkExecutions {
  constructor(store, links) {
    Object.assign(this, { store, links });
  }
  receipt(requestId, task, reportHash, execution) {
    if (!requestId || this.store.list('work-receipt').some((r) => r.requestId === requestId))
      return;
    this.store.create('work-receipt', {
      requestId,
      taskId: task.id,
      productId: task.productId,
      reportHash,
      sourceVersion: task.sourceVersion,
      execution,
    });
  }
  observe(productId, event, requestId, reportHash) {
    const key = executionKey(productId, event.session_id, event.turn_id);
    this.store.transaction(() => {
      const old = this.store.list('execution-link').find((l) => l.key === key);
      const next = old || {
        key,
        productId,
        execution: { client: 'codex', sessionId: event.session_id, turnId: event.turn_id },
        provenance: 'codex-hook-observation',
        observations: [],
      };
      const previous = next.observations.find((o) => o.toolUseId === event.tool_use_id);
      if (previous) {
        if (previous.requestId !== requestId || previous.reportHash !== reportHash) {
          previous.conflict = true;
        } else return;
      } else {
        if (next.observations.length >= 200)
          throw new Error('Execution observation limit reached.');
        next.observations.push({
          requestId,
          reportHash,
          toolUseId: event.tool_use_id,
          status: 'pending',
        });
      }
      if (old) this.store.update('execution-link', old.id, old.revision, next);
      else this.store.create('execution-link', next);
    });
    this.reconcile();
    return this.store.list('execution-link').find((l) => l.key === key);
  }
  reconcile() {
    return this.store.transaction(() => {
      const links = this.store.list('execution-link');
      if (!links.length) return;
      const tasks = this.store.list('task');
      const receipts = this.store.list('work-receipt');
      const metadata = new Map(
        tasks.filter((t) => t.kind === 'work').map((t) => [t.id, emptyExecutionLink()]),
      );
      for (const link of links) {
        const observations = link.observations.map((observation) => {
          const { taskId: _taskId, operationStatus: _operationStatus, ...o } = observation;
          const op = this.store.operation(o.requestId);
          const receipt = receipts.find((r) => r.requestId === o.requestId);
          const task = receipt && tasks.find((t) => t.id === receipt.taskId);
          const otherExecution = links.some(
            (l) => l.key !== link.key && l.observations.some((v) => v.requestId === o.requestId),
          );
          const claim = receipt?.execution;
          if (
            o.conflict ||
            otherExecution ||
            (op &&
              (op.command !== 'core.reportWork' ||
                op.caller?.channel !== 'mcp' ||
                op.targets?.productId !== link.productId)) ||
            (receipt &&
              (receipt.productId !== link.productId ||
                receipt.reportHash !== o.reportHash ||
                task?.actor !== 'mcp')) ||
            (claim &&
              (claim.client !== 'codex' ||
                (claim.sessionId && claim.sessionId !== link.execution.sessionId) ||
                (claim.turnId && claim.turnId !== link.execution.turnId)))
          )
            return { ...o, status: 'conflict' };
          if (!op || ['accepted', 'running'].includes(op.status))
            return { ...o, status: 'pending' };
          if (!receipt || !task)
            return { ...o, status: op.effectMayHaveOccurred ? 'pending' : 'unmatched' };
          if (
            op.status === 'completed' &&
            (op.result?.id !== receipt.taskId || op.result?.reportHash !== receipt.reportHash)
          )
            return { ...o, status: 'conflict' };
          return { ...o, status: 'linked', taskId: task.id, operationStatus: op.status };
        });
        const capture = this.store.list('capture').find((c) => c.key === link.key);
        const hook =
          capture?.taskId && tasks.find((t) => t.id === capture.taskId && t.actor === 'codex-hook');
        const ids = [
          ...new Set(observations.filter((o) => o.status === 'linked').map((o) => o.taskId)),
        ];
        const next = { ...link, observations, hookTaskId: hook?.id || null, taskIds: ids };
        if (JSON.stringify(next) !== JSON.stringify(link))
          this.store.update('execution-link', link.id, link.revision, next);
        const observedTasks = observations
          .map(
            (o) =>
              receipts.find((r) => r.requestId === o.requestId && r.productId === link.productId)
                ?.taskId,
          )
          .filter((id) => metadata.has(id));
        for (const taskId of new Set([...ids, ...observedTasks, ...(hook ? [hook.id] : [])])) {
          const info = metadata.get(taskId);
          info.linkIds.push(link.id);
          if (hook && ids.includes(taskId)) info.hookTaskIds.push(hook.id);
          if (taskId === hook?.id) info.structuredTaskIds.push(...ids);
          const status = observations.some((o) => o.status === 'conflict')
            ? 'conflict'
            : ids.length
              ? 'linked'
              : 'pending';
          if (info.status !== 'conflict') info.status = status;
        }
      }
      const changed = [];
      for (const task of tasks.filter((t) => t.kind === 'work')) {
        const info = metadata.get(task.id);
        for (const key of ['linkIds', 'hookTaskIds', 'structuredTaskIds'])
          info[key] = [...new Set(info[key])].sort();
        if (JSON.stringify(task.executionLink || emptyExecutionLink()) === JSON.stringify(info))
          continue;
        this.store.update('task', task.id, task.revision, { ...task, executionLink: info });
        changed.push(task.parentTaskId || task.id);
      }
      if (changed.length) {
        this.links.refreshPortfolios([...new Set(changed)], { correction: true });
        this.store.log('실행 출처 연결 갱신', changed[0], String(changed.length));
      }
    });
  }
}
