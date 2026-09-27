import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store.mjs';
import { inspectFolder, normalizeFolder } from './inspection.mjs';
import { applyTaskToPortfolio, preserveEntryEdits } from './portfolio-sync.mjs';
import { WorkLinks } from './work-links.mjs';
import { projectWork } from './work-projection.mjs';
import { KnowledgeService } from './knowledge.mjs';
import { normalizeTemplate, portfolioTemplates } from '../shared/portfolio.mjs';

const text = (max = 4000) => z.string().trim().min(1).max(max);
const id = z.string().uuid();
export const schemas = {
  createProduct: z
    .object({ name: text(100), folder: text(2048), goal: z.string().trim().max(2000).default('') })
    .strict(),
  updateProduct: z
    .object({ id, revision: z.number().int().positive(), goal: z.string().trim().max(2000) })
    .strict(),
  inspect: z.object({ productId: id }).strict(),
  addRecord: z
    .object({
      productId: id,
      title: text(200),
      content: text(8000),
      scope: text(1000),
      source: text(1000),
    })
    .strict(),
  toggleRecord: z
    .object({ id, revision: z.number().int().positive(), active: z.boolean() })
    .strict(),
  requestDecision: z
    .object({
      productId: id,
      title: text(200),
      reason: text(4000),
      options: z
        .array(z.object({ label: text(160), effect: text(1200) }).strict())
        .min(2)
        .max(4),
    })
    .strict(),
  resolveDecision: z
    .object({ id, revision: z.number().int().positive(), option: z.number().int().min(0).max(3) })
    .strict(),
  deferDecision: z
    .object({ id, revision: z.number().int().positive(), deferred: z.boolean() })
    .strict(),
  reportWork: z
    .object({
      productId: id,
      title: text(200),
      summary: text(8000),
      evidence: text(8000),
      limitations: text(4000),
      contribution: text(3000),
      externalId: text(200).optional(),
      sourceVersion: z.number().int().positive().default(1),
      workTaskId: id.optional(),
      changedFiles: z
        .array(z.object({ path: text(2048), summary: text(2000) }).strict())
        .max(100)
        .default([]),
      checks: z
        .array(
          z
            .object({
              name: text(300),
              result: z.enum(['passed', 'failed', 'unconfirmed']),
              detail: text(2000),
            })
            .strict(),
        )
        .max(100)
        .default([]),
    })
    .strict(),
  createPortfolio: z
    .object({
      target: text(160),
      templateId: z.enum(portfolioTemplates).default('studio'),
      requirements: z.string().trim().max(5000).default(''),
      autoProductIds: z.array(id).max(100).default([]),
    })
    .strict(),
  savePortfolio: z
    .object({
      id,
      templateId: z.enum(portfolioTemplates).optional(),
      revision: z.number().int().positive(),
      intro: z.string().trim().max(2000),
      requirements: z.string().trim().max(5000),
      autoProductIds: z.array(id).max(100).optional(),
      entries: z
        .array(
          z
            .object({
              taskId: id,
              title: text(200),
              description: text(5000),
              contribution: text(3000),
            })
            .strict(),
        )
        .max(20),
    })
    .strict(),
  context: z.object({ productId: id, query: z.string().trim().max(500).default('') }).strict(),
};

export class Workroom {
  constructor(filename, { embedding = null } = {}) {
    this.store = new Store(filename);
    this.knowledge = new KnowledgeService(this.store, { embedding });
    this.busy = new Set();
    this.links = new WorkLinks(this.store);
  }
  changes() {
    return this.store.changeToken();
  }
  agentWork(input) {
    const { productId } = z.object({ productId: id }).strict().parse(input);
    this.store.get('product', productId);
    return {
      liveConnection: false,
      tasks: this.store
        .list('task')
        .filter((t) => t.productId === productId && t.kind === 'agent')
        .map(
          ({
            id,
            title,
            goal,
            mode,
            status,
            stage,
            verification,
            appliedAt,
            changeSetId,
            resultTaskId,
            updated,
            message,
          }) => ({
            id,
            title,
            goal,
            mode: mode || 'investigation',
            status,
            stage,
            verification,
            appliedAt,
            changeSetId,
            resultTaskId,
            updated,
            message,
          }),
        ),
      runs: this.store
        .list('agent-run')
        .filter((r) => r.productId === productId)
        .map(({ id, taskId, role, status, modelId, lastSeen, endedAt, turns, tokens }) => ({
          id,
          taskId,
          role,
          status,
          modelId,
          lastSeen,
          endedAt,
          turns,
          tokens,
        })),
    };
  }
  snapshot() {
    return {
      knowledgeIndex: this.knowledge.index?.status() || { enabled: false },
      operationPolicies: this.store.list('operation-policy'),
      operationObservations: this.store
        .list('operation-observation')
        .slice(0, 100)
        .map(({ manifest, ...o }) => o),
      operationIssues: this.store.list('operation-issue'),
      portfolioEdits: this.store.list('portfolio-edit'),
      changeToken: this.changes(),
      products: this.store.list('product'),
      tasks: this.store.list('task'),
      records: this.store.list('record'),
      portfolios: this.store.list('portfolio'),
      reports: this.store.list('work-report'),
      workLinks: this.store.list('work-link'),
      recordHistory: this.store.list('record-version'),
      contextUses: this.store.list('context-use').slice(0, 100),
      captureConnections: this.store.list('capture-connection'),
      audit: this.store.history(),
    };
  }
  changeWorkLink(input) {
    return this.links.changeLink(input);
  }
  reviewRecord(input) {
    return this.links.reviewRecord(input);
  }
  reviewPortfolioSource(input) {
    return this.links.reviewPortfolioSource(input);
  }
  setCodexCapture(input) {
    const { productId, enabled } = z
      .object({ productId: id, enabled: z.boolean() })
      .strict()
      .parse(input);
    return this.store.transaction(() => {
      const current = this.store.get('product', productId);
      const saved = this.store.update('product', current.id, current.revision, {
        ...current,
        codexCaptureEnabled: enabled,
      });
      this.store.log(enabled ? 'Codex 수집 켜기' : 'Codex 수집 끄기', productId, current.name);
      return saved;
    });
  }
  async createProduct(input) {
    const data = schemas.createProduct.parse(input);
    data.folder = await normalizeFolder(data.folder);
    return this.store.transaction(() => {
      if (
        this.store
          .list('product')
          .some((p) => path.resolve(p.folder).toLowerCase() === data.folder.toLowerCase())
      )
        throw new Error('이미 등록한 폴더입니다. 제품 목록에서 열어주세요.');
      const product = this.store.create('product', data);
      this.store.log('제품 등록', product.id, product.name);
      return product;
    });
  }
  updateProduct(input) {
    const data = schemas.updateProduct.parse(input);
    return this.store.transaction(() => {
      const old = this.store.get('product', data.id);
      const product = this.store.update('product', data.id, data.revision, {
        ...old,
        goal: data.goal,
      });
      this.store.log('제품 목표 수정', product.id, product.name);
      return product;
    });
  }
  async inspect(input) {
    const { productId } = schemas.inspect.parse(input);
    const product = this.store.get('product', productId);
    if (this.busy.has(productId))
      throw new Error('이 제품을 점검하고 있습니다. 잠시 후 결과를 확인하세요.');
    this.busy.add(productId);
    try {
      const result = await inspectFolder(product.folder);
      return this.store.transaction(() => {
        const task = this.store.create('task', {
          productId,
          kind: 'inspection',
          status: result.unconfirmed.length ? 'partial' : 'completed',
          title: '저장소 기본 점검',
          reason: '사용자가 등록한 폴더의 읽기 전용 점검',
          result,
          verification: 'observed',
          deployment: 'none',
        });
        const existing = this.store
          .list('record')
          .find((r) => r.productId === productId && r.key === 'repository-baseline');
        const body = {
          productId,
          key: 'repository-baseline',
          title: '최근 저장소 기본 상태',
          content: result.observations.map((x) => `${x.label}: ${x.value}`).join('\n'),
          scope: '이 제품의 저장소 기본 상태 확인',
          source: '앱의 읽기 전용 점검',
          sourceTaskId: task.id,
          provenance: 'observed',
          active: existing?.active ?? true,
        };
        if (existing) this.store.update('record', existing.id, existing.revision, body);
        else this.store.create('record', body);
        this.store.log('저장소 점검 완료', task.id, product.name);
        return task;
      });
    } finally {
      this.busy.delete(productId);
    }
  }
  addRecord(input, actor = 'user') {
    const data = schemas.addRecord.parse(input);
    this.store.get('product', data.productId);
    return this.store.transaction(() => {
      const record = this.store.create('record', {
        ...data,
        provenance: actor === 'mcp' ? 'reported' : 'user',
        active: true,
      });
      this.store.log('기록 추가', record.id, actor);
      return record;
    });
  }
  toggleRecord(input) {
    const data = schemas.toggleRecord.parse(input);
    return this.store.transaction(() => {
      const old = this.store.get('record', data.id);
      const record = this.store.update('record', data.id, data.revision, {
        ...old,
        active: data.active,
      });
      this.store.log(data.active ? '자동 참조 포함' : '자동 참조 제외', record.id, old.title);
      return record;
    });
  }
  requestDecision(input, actor = 'user') {
    const data = schemas.requestDecision.parse(input);
    this.store.get('product', data.productId);
    return this.store.transaction(() => {
      const task = this.store.create('task', {
        ...data,
        kind: 'decision',
        status: 'needs_decision',
        actor,
      });
      this.store.log('판단 요청', task.id, actor);
      return task;
    });
  }
  resolveDecision(input) {
    const data = schemas.resolveDecision.parse(input);
    return this.store.transaction(() => {
      const old = this.store.get('task', data.id);
      if (old.kind !== 'decision' || !['needs_decision', 'deferred'].includes(old.status))
        throw new Error('현재 상태에서는 결정할 수 없습니다.');
      const choice = old.options[data.option];
      if (!choice) throw new Error('유효한 선택지를 선택하세요.');
      const task = this.store.update('task', old.id, data.revision, {
        ...old,
        status: 'decided',
        selected: data.option,
        decidedAt: new Date().toISOString(),
      });
      this.store.create('record', {
        productId: old.productId,
        title: old.title,
        content: `${choice.label}\n${choice.effect}`,
        scope: old.reason,
        source: '사용자 결정',
        sourceTaskId: old.id,
        provenance: 'user',
        active: true,
      });
      this.store.log('방침 결정', old.id, choice.label);
      return task;
    });
  }
  deferDecision(input) {
    const data = schemas.deferDecision.parse(input);
    return this.store.transaction(() => {
      const old = this.store.get('task', data.id);
      if (old.kind !== 'decision' || !['needs_decision', 'deferred'].includes(old.status))
        throw new Error('현재 상태에서는 보류할 수 없습니다.');
      const task = this.store.update('task', old.id, data.revision, {
        ...old,
        status: data.deferred ? 'deferred' : 'needs_decision',
      });
      this.store.log(data.deferred ? '판단 보류' : '보류 해제', task.id);
      return task;
    });
  }
  reportWork(input, actor = 'user') {
    const data = schemas.reportWork.parse(input);
    this.store.get('product', data.productId);
    if (!data.externalId && data.sourceVersion !== 1)
      throw new Error('보고 갱신에는 같은 작업을 식별할 externalId가 필요합니다.');
    const reportHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    return this.store.transaction(() => {
      const old =
        data.externalId &&
        this.store
          .list('task')
          .find(
            (t) =>
              t.kind === 'work' &&
              t.productId === data.productId &&
              t.actor === actor &&
              t.externalId === data.externalId,
          );
      if (old) {
        if (data.sourceVersion < old.sourceVersion)
          throw new Error('이 작업의 더 최신 보고가 이미 저장되어 있습니다.');
        if (data.sourceVersion === old.sourceVersion) {
          if (old.reportHash === reportHash) return old;
          throw new Error(
            '같은 보고 버전에 다른 내용이 있습니다. 수정한 보고는 sourceVersion을 높여 보내세요.',
          );
        }
      }
      let parentTaskId = old?.parentTaskId || null;
      if (!old && data.workTaskId) {
        const parent = this.store.get('task', data.workTaskId);
        if (parent.kind !== 'work' || parent.productId !== data.productId || parent.parentTaskId)
          throw new Error('같은 제품의 독립된 작업에만 후속 보고를 연결할 수 있습니다.');
        parentTaskId = parent.id;
      }
      if (old) this.links.archiveReport(old);
      const body = {
        ...old,
        ...data,
        parentTaskId,
        reportHash,
        kind: 'work',
        status: 'reported',
        actor,
        verification: 'reported',
        deployment: 'unconfirmed',
      };
      const task = old
        ? this.store.update('task', old.id, old.revision, body)
        : this.store.create('task', body);
      this.links.archiveReport(task);
      if (parentTaskId) {
        const parent = this.store.get('task', parentTaskId);
        this.store.update('task', parent.id, parent.revision, {
          ...parent,
          connectionsUpdatedAt: new Date().toISOString(),
        });
      }
      const existing = old && this.store.list('record').find((r) => r.sourceTaskId === old.id);
      const record = {
        productId: data.productId,
        title: data.title,
        content: `${data.summary}\n근거: ${data.evidence}\n한계: ${data.limitations}`,
        scope: '이 제품의 관련 작업에만 참조',
        source:
          actor === 'pi'
            ? '내장 Pi의 소스 조사·근거 검토'
            : actor === 'mcp'
              ? 'MCP로 전달된 작업 보고'
              : actor === 'codex-hook'
                ? 'Codex 응답 종료 이벤트에서 수집'
                : '사용자 작업 보고',
        sourceTaskId: task.id,
        provenance: 'reported',
        active: existing?.active ?? true,
      };
      if (existing) {
        this.store.create('record-version', { recordId: existing.id, snapshot: existing });
        this.store.update(
          'record',
          existing.id,
          existing.revision,
          existing.edited
            ? {
                ...existing,
                validity: 'needs_review',
                validityReason:
                  '출처 보고가 갱신되었습니다. 직접 정한 내용과 조건을 새 근거에 맞춰 확인하세요.',
              }
            : { ...existing, ...record },
        );
      } else this.store.create('record', record);
      this.links.refreshPortfolios([parentTaskId || task.id]);
      this.store.log(old ? '작업 보고 갱신' : '작업 결과 보고', task.id, actor);
      return task;
    });
  }
  async context(input) {
    const { productId, query } = schemas.context.parse(input);
    const { product, records, retrieval } = await this.knowledge.query({ productId, query });
    if (records.length)
      this.store.transaction(() => {
        this.store.create('context-use', {
          productId,
          query,
          retrieval,
          records: records.map((r) => ({
            id: r.id,
            revision: r.revision,
            title: r.title,
            content: r.content,
            scope: r.scope,
          })),
        });
      });
    return {
      product,
      records,
      retrieval,
      note: `${retrieval.mode === 'hybrid' ? '단어·의미 검색을 함께 사용했습니다.' : '현재 단어 검색을 사용했습니다.'} 같은 제품의 활성·보류되지 않은 기록을 최대 8개 제공합니다. 연결된 파일 근거와 기록 버전을 조회 시 확인하고 제공 버전을 기록했습니다. 파일 근거가 없는 사용자 기록·외부 보고는 독립 검증된 사실이 아닙니다. 적용 조건과 출처를 확인하세요. 조회 이력은 실제 활용 확인이 아닙니다.`,
    };
  }
  createPortfolio(input) {
    const data = schemas.createPortfolio.parse(input);
    return this.store.transaction(() => {
      for (const productId of data.autoProductIds) this.store.get('product', productId);
      const portfolio = this.store.create('portfolio', {
        ...data,
        autoProductIds: [...new Set(data.autoProductIds)],
        intro: '',
        entries: [],
        exports: [],
        excludedTaskIds: [],
        entrySources: {},
        pendingTaskIds: [],
      });
      this.store.log('포트폴리오 대상 추가', portfolio.id, portfolio.target);
      return portfolio;
    });
  }
  savePortfolio(input) {
    const data = schemas.savePortfolio.parse(input);
    if (new Set(data.entries.map((x) => x.taskId)).size !== data.entries.length)
      throw new Error('같은 작업을 중복으로 넣을 수 없습니다.');
    return this.store.transaction(() => {
      const old = this.store.get('portfolio', data.id);
      for (const entry of data.entries) {
        const task = this.store.get('task', entry.taskId);
        if (task.kind !== 'work')
          throw new Error(
            '작업 결과 보고만 성과로 추가할 수 있습니다. 기본 점검은 성과가 아닙니다.',
          );
      }
      const autoProductIds = [...new Set(data.autoProductIds ?? old.autoProductIds ?? [])];
      for (const productId of autoProductIds) this.store.get('product', productId);
      const included = new Set(data.entries.map((x) => x.taskId));
      const excludedTaskIds = [
        ...new Set([
          ...(old.excludedTaskIds || []),
          ...old.entries.filter((x) => !included.has(x.taskId)).map((x) => x.taskId),
        ]),
      ].filter((id) => !included.has(id));
      let next = {
        ...old,
        templateId: data.templateId ?? normalizeTemplate(old.templateId),
        intro: data.intro,
        requirements: data.requirements,
        entries: data.entries,
        autoProductIds,
        excludedTaskIds,
        entrySources: preserveEntryEdits(old, data.entries),
        pendingTaskIds: (old.pendingTaskIds || []).filter(
          (id) =>
            !included.has(id) &&
            !excludedTaskIds.includes(id) &&
            autoProductIds.includes(this.store.get('task', id).productId),
        ),
      };
      const tasks = this.store.list('task');
      next.pendingTaskIds = next.pendingTaskIds.filter(
        (taskId) => !tasks.find((t) => t.id === taskId)?.parentTaskId,
      );
      for (const taskId of next.pendingTaskIds)
        next = applyTaskToPortfolio(next, projectWork(this.store.get('task', taskId), tasks));
      const saved = this.store.update('portfolio', old.id, data.revision, next);
      this.store.log('포트폴리오 초안 저장', saved.id, saved.target);
      return saved;
    });
  }
  prepareExport(idValue, revision) {
    const p = this.store.get('portfolio', id.parse(idValue));
    if (p.revision !== revision)
      throw new Error('초안이 변경되었습니다. 새로고침하고 다시 검토하세요.');
    if (p.entries.some((e) => p.entrySources?.[e.taskId]?.sourceConflict))
      throw new Error('실행 연결이 바뀐 사례가 있습니다. 문장과 현재 근거를 확인한 뒤 내보내세요.');
    if (!p.intro.trim() || !p.entries.length)
      throw new Error('소개와 작업 사례를 하나 이상 넣어주세요.');
    return {
      target: p.target,
      templateId: normalizeTemplate(p.templateId),
      intro: p.intro,
      entries: p.entries.map(({ title, description, contribution }) => ({
        title,
        description,
        contribution,
      })),
    };
  }
  recordExport(portfolioId, snapshot, filename) {
    return this.store.transaction(() => {
      const current = this.store.get('portfolio', portfolioId);
      const saved = this.store.update('portfolio', current.id, current.revision, {
        ...current,
        exports: [...current.exports, { at: new Date().toISOString(), filename, snapshot }].slice(
          -20,
        ),
      });
      this.store.log('HTML 내보내기', saved.id, filename);
      return saved;
    });
  }
  close() {
    this.knowledge.close();
    this.store.close();
  }
}
