import { randomUUID } from 'node:crypto';

export const knowledgeChunkVersion = 'context-passages-v2';
const contextStride = 290;
function contextChunkCount(record) {
  return Math.ceil((record.content || record.title).length / contextStride);
}
function recordChunks(record) {
  const prefix = `${record.title.slice(0, 80)}\n${record.scope.slice(0, 80)}\n`;
  const content = record.content || record.title;
  const chunks = [];
  for (let start = 0; start < content.length; start += contextStride)
    chunks.push(prefix + content.slice(start, start + 350));
  // Context chunks come first. Sentence passages supplement them without
  // repeating a broad title/scope that can dilute a specific cross-language hit.
  const passages = content
    .split(/\n+|(?<=[.!?。])\s+/u)
    .map((text) => text.trim())
    .filter(Boolean);
  for (const passage of passages) {
    for (let start = 0; start < passage.length; start += 240) {
      const text = passage.slice(start, start + 280);
      // Braces, fence markers and tiny fragments have no useful independent
      // meaning. They remain searchable through context and lexical retrieval.
      if ((text.match(/[\p{L}\p{N}]/gu) || []).length >= 24) chunks.push(text);
    }
  }
  return chunks;
}
function unitVector(vector, dimensions) {
  if (!Array.isArray(vector) || vector.length !== dimensions || !vector.every(Number.isFinite))
    throw new Error('invalid embedding');
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || !norm) throw new Error('empty embedding');
  return vector.map((value) => value / norm);
}

export class KnowledgeIndex {
  constructor(store, embedding, { now = Date.now, leaseMs = 300000, rerankMs = 1500 } = {}) {
    this.store = store;
    this.embedding = embedding;
    this.now = now;
    this.leaseMs = leaseMs;
    this.owner = randomUUID();
    this.closed = false;
    this.rerankMs = rerankMs;
    this.vectorCache = new Map();
    this.store.transaction(() => {
      const previous = store.db
        .prepare('SELECT model_id FROM knowledge_index_state WHERE id=1')
        .get();
      if (previous?.model_id === embedding.id) return;
      store.db
        .prepare(
          'INSERT INTO knowledge_index_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET model_id=excluded.model_id',
        )
        .run(embedding.id);
      store.db.exec(`DELETE FROM knowledge_vectors;
        UPDATE knowledge_jobs SET state='pending',attempts=0,next_attempt=0,owner=NULL,lease_until=0,last_error=NULL;`);
    });
  }
  currentModel() {
    return (
      this.store.db.prepare('SELECT model_id FROM knowledge_index_state WHERE id=1').get()
        ?.model_id === this.embedding.id
    );
  }
  claim() {
    return this.store.transaction(() => {
      if (!this.currentModel()) return null;
      const now = this.now();
      // One indexing request across app/MCP processes also avoids simultaneous first downloads.
      if (
        this.store.db
          .prepare("SELECT 1 FROM knowledge_jobs WHERE state='running' AND lease_until>? LIMIT 1")
          .get(now)
      )
        return null;
      const job = this.store.db
        .prepare(
          `SELECT * FROM knowledge_jobs WHERE
        (state IN ('pending','retry') AND next_attempt<=?) OR (state='running' AND lease_until<=?)
        ORDER BY next_attempt,source_id LIMIT 1`,
        )
        .get(now, now);
      if (!job) return null;
      this.store.db
        .prepare(
          "UPDATE knowledge_jobs SET state='running',owner=?,lease_until=?,attempts=attempts+1 WHERE source_id=?",
        )
        .run(this.owner, now + this.leaseMs, job.source_id);
      return { ...job, attempts: job.attempts + 1 };
    });
  }
  owns(job) {
    const current = this.store.db
      .prepare('SELECT * FROM knowledge_jobs WHERE source_id=?')
      .get(job.source_id);
    return (
      this.currentModel() &&
      current?.owner === this.owner &&
      current.state === 'running' &&
      current.source_revision === job.source_revision &&
      current.lease_until > this.now()
    );
  }
  async process(job) {
    try {
      const record = this.store.find('record', job.source_id);
      const shouldEmbed =
        job.operation === 'upsert' &&
        record?.revision === job.source_revision &&
        record.productId === job.product_id &&
        record.active &&
        record.validity !== 'needs_review';
      const vectors = shouldEmbed
        ? (await this.embedding.embed(recordChunks(record))).map((v) =>
            unitVector(v, this.embedding.dimensions),
          )
        : [];
      if (shouldEmbed && vectors.length !== recordChunks(record).length)
        throw new Error('incomplete embedding');
      if (this.closed) return;
      this.store.transaction(() => {
        if (!this.owns(job)) return;
        const current = this.store.find('record', job.source_id);
        if (
          shouldEmbed &&
          (!current ||
            current.revision !== job.source_revision ||
            current.productId !== job.product_id ||
            !current.active ||
            current.validity === 'needs_review')
        )
          return;
        this.store.db.prepare('DELETE FROM knowledge_vectors WHERE source_id=?').run(job.source_id);
        const insert = this.store.db.prepare('INSERT INTO knowledge_vectors VALUES(?,?,?,?,?,?)');
        vectors.forEach((vector, chunk) =>
          insert.run(
            job.source_id,
            job.product_id,
            job.source_revision,
            this.embedding.id,
            chunk,
            JSON.stringify(vector),
          ),
        );
        this.store.db
          .prepare(
            "UPDATE knowledge_jobs SET state='done',owner=NULL,lease_until=0,last_error=NULL WHERE source_id=?",
          )
          .run(job.source_id);
      });
    } catch {
      if (this.closed) return;
      this.store.transaction(() => {
        if (!this.owns(job)) return;
        this.store.db
          .prepare(
            "UPDATE knowledge_jobs SET state='retry',owner=NULL,lease_until=0,next_attempt=?,last_error='embedding_unavailable' WHERE source_id=?",
          )
          .run(this.now() + Math.min(300000, 1000 * 2 ** Math.min(job.attempts, 8)), job.source_id);
      });
    }
  }
  async drain(maxJobs = 4) {
    if (this.closed || this.running) return 0;
    this.running = true;
    let count = 0;
    try {
      while (!this.closed && count < maxJobs) {
        const job = this.claim();
        if (!job) break;
        await this.process(job);
        count++;
      }
    } finally {
      this.running = false;
    }
    return count;
  }
  start() {
    if (this.timer || this.closed) return;
    const tick = () => {
      void this.drain().catch(() => {});
    };
    this.timer = setInterval(tick, 2000);
    this.timer.unref();
    tick();
  }
  async search(productId, query, records) {
    if (this.closed || !this.currentModel()) return { scores: new Map(), mode: 'lexical' };
    const sources = new Map(records.map((r) => [r.id, r]));
    const vectors = this.store.db
      .prepare('SELECT * FROM knowledge_vectors WHERE product_id=? AND model_id=?')
      .all(productId, this.embedding.id)
      .filter((v) => sources.get(v.source_id)?.revision === v.source_revision);
    if (!vectors.length) return { scores: new Map(), mode: 'lexical' };
    let timer;
    try {
      const result = await Promise.race([
        this.embedding.embed([query]),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('query timeout')), 2500);
        }),
      ]);
      if (this.closed || !this.currentModel()) return { scores: new Map(), mode: 'lexical' };
      const q = unitVector(result[0], this.embedding.dimensions);
      const matches = new Map();
      for (const row of vectors) {
        const key = `${row.source_id}:${row.source_revision}:${row.chunk}`;
        let cached = this.vectorCache.get(key);
        if (!cached || cached.json !== row.vector) {
          cached = {
            json: row.vector,
            vector: unitVector(JSON.parse(row.vector), this.embedding.dimensions),
          };
          if (this.vectorCache.size >= 2048)
            this.vectorCache.delete(this.vectorCache.keys().next().value);
          this.vectorCache.set(key, cached);
        }
        const v = cached.vector;
        const score = q.reduce((sum, value, i) => sum + value * v[i], 0);
        const match = matches.get(row.source_id) || {
          context: -1,
          passage: -1,
          best: -1,
          chunk: 0,
        };
        if (score > match.best) {
          match.best = score;
          match.chunk = row.chunk;
        }
        const part =
          row.chunk < contextChunkCount(sources.get(row.source_id)) ? 'context' : 'passage';
        match[part] = Math.max(match[part], score);
        matches.set(row.source_id, match);
      }
      const scores = new Map();
      const passages = new Map();
      for (const [id, { context, passage }] of matches) {
        // A passage can strengthen a context match, but never replace it with
        // an uncorroborated maximum or lower an already strong context score.
        const score = Math.max(context, (context + passage) / 2);
        if (score >= 0.35) scores.set(id, score);
      }
      // Lexical admission can also retain a record with a weak vector score;
      // give the reranker its best passage without relaxing semantic admission.
      for (const id of matches.keys())
        passages.set(id, recordChunks(sources.get(id))[matches.get(id).chunk]);
      return { scores, passages, mode: 'hybrid' };
    } catch {
      return { scores: new Map(), mode: 'lexical' };
    } finally {
      clearTimeout(timer);
    }
  }
  async rerank(query, records, passages = new Map()) {
    if (
      this.closed ||
      !this.currentModel() ||
      !this.embedding.rerank ||
      this.embedding.rerankEnabled === false ||
      records.length < 2
    )
      return null;
    const candidates = records.slice(0, 24);
    let timer;
    try {
      const scores = await Promise.race([
        this.embedding.rerank(
          query,
          candidates.map((r) => `${r.title}\n${passages.get(r.id) || r.content.slice(0, 1600)}`),
        ),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('rerank timeout')), this.rerankMs);
        }),
      ]);
      if (
        this.closed ||
        !this.currentModel() ||
        !Array.isArray(scores) ||
        scores.length !== candidates.length ||
        !scores.every(Number.isFinite)
      )
        return null;
      return candidates
        .map((r, i) => ({ id: r.id, score: scores[i] }))
        .sort((a, b) => b.score - a.score)
        .map((r) => r.id);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  status() {
    const counts = Object.fromEntries(
      this.store.db
        .prepare('SELECT state,COUNT(*) AS count FROM knowledge_jobs GROUP BY state')
        .all()
        .map((r) => [r.state, r.count]),
    );
    return {
      enabled: true,
      model: this.embedding.id,
      pending: (counts.pending || 0) + (counts.running || 0),
      retrying: counts.retry || 0,
    };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.vectorCache.clear();
    clearInterval(this.timer);
    this.store.db
      .prepare(
        "UPDATE knowledge_jobs SET state='pending',owner=NULL,lease_until=0 WHERE owner=? AND state='running'",
      )
      .run(this.owner);
    this.embedding.close?.();
  }
}
