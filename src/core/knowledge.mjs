import { readProductFile } from '../runtime/files.mjs';
import { KnowledgeIndex } from './knowledge-index.mjs';
import { queryTerms, rankKnowledge } from './knowledge-ranking.mjs';

const eligible = (record, productId) =>
  record.productId === productId && record.active && record.validity !== 'needs_review';
const limit = 8;

export class KnowledgeService {
  constructor(store, { readFile = readProductFile, embedding = null } = {}) {
    this.store = store;
    this.readFile = readFile;
    this.index = embedding ? new KnowledgeIndex(store, embedding) : null;
  }
  close() {
    this.index?.close();
  }
  async validate(record, product) {
    const references = [];
    if (record.sourceTaskId) {
      const source = this.store.find('task', record.sourceTaskId);
      references.push({ kind: 'task', id: record.sourceTaskId, revision: source?.revision });
      if (!source || source.productId !== product.id) return { valid: false, references };
    }
    const evidenceIds = record.evidenceIds ?? [];
    if (!Array.isArray(evidenceIds)) return { valid: false, references };
    for (const id of new Set(evidenceIds)) {
      if (typeof id !== 'string') return { valid: false, references };
      const evidence = this.store.find('agent-evidence', id);
      references.push({ kind: 'agent-evidence', id, revision: evidence?.revision });
      if (
        !evidence ||
        evidence.productId !== product.id ||
        (record.runtimeTaskId && evidence.taskId !== record.runtimeTaskId)
      )
        return { valid: false, references };
      try {
        const file = await this.readFile(product.folder, evidence.path);
        if (file.hash !== evidence.hash) return { valid: false, references };
      } catch {
        return { valid: false, references };
      }
    }
    return { valid: true, references };
  }
  async query({ productId, query = '' }) {
    const product = this.store.get('product', productId);
    const sourceRecords = this.store.list('record').filter((record) => eligible(record, productId));
    let scores = new Map();
    let mode = 'lexical';
    let passages;
    if (this.index && queryTerms(query).length) {
      const semantic = await this.index.search(productId, query, sourceRecords);
      mode = semantic.mode;
      scores = semantic.scores;
      passages = semantic.passages;
    }
    const ranked = rankKnowledge(sourceRecords, query, scores);
    let checked = [];
    // Do not cap candidates before validation: invalid sources must not crowd out
    // valid records. No database write transaction is held across filesystem I/O.
    for (const record of ranked)
      checked.push({ record, ...(await this.validate(record, product)) });

    // Bound expensive pair scoring after evidence checks. Unscored candidates
    // remain available, and the final transaction still fences concurrent edits.
    const reranked =
      queryTerms(query).length > 2
        ? await this.index?.rerank?.(
            query,
            checked.filter((r) => r.valid).map((r) => r.record),
            passages,
          )
        : null;
    if (reranked) {
      const order = new Map(reranked.map((id, i) => [id, i]));
      checked = checked.sort(
        (a, b) => (order.get(a.record.id) ?? Infinity) - (order.get(b.record.id) ?? Infinity),
      );
    }

    return this.store.transaction(() => {
      if (this.store.get('product', productId).revision !== product.revision)
        throw new Error('조회 중 제품 범위가 변경되었습니다. 다시 조회하세요.');
      const records = [];
      for (const { record, valid, references } of checked) {
        const current = this.store.find('record', record.id);
        // A concurrent edit, exclusion or source update wins over this read.
        if (!current || current.revision !== record.revision || !eligible(current, productId))
          continue;
        if (
          references.some(
            ({ kind, id, revision }) => this.store.find(kind, id)?.revision !== revision,
          )
        )
          continue;
        if (!valid) {
          this.store.create('record-version', { recordId: current.id, snapshot: current });
          this.store.update('record', current.id, current.revision, {
            ...current,
            validity: 'needs_review',
            validityReason:
              '인용한 근거가 변경·삭제되었거나 현재 제품 범위에서 확인되지 않아 자동 제공을 보류했습니다.',
          });
          this.store.log('지식 근거 변경', current.id);
        } else if (records.length < limit) records.push(current);
      }
      return { product, records, retrieval: { mode, reranked: Boolean(reranked) } };
    });
  }
}
