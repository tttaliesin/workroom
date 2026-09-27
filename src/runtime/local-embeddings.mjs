import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { knowledgeChunkVersion } from '../core/knowledge-index.mjs';

export const embeddingModel = {
  name: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  revision: '2c4055b12046f11709e9df2c122e59ffbdc2f900',
  dimensions: 384,
};
class InferenceWorker {
  constructor(directory, offline) {
    this.directory = directory;
    this.offline = offline;
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
  }
  open() {
    if (this.worker) return;
    const worker = new Worker(new URL('./embedding-worker.mjs', import.meta.url), {
      workerData: {
        ...embeddingModel,
        cacheDir: path.resolve(this.directory),
        offline: this.offline,
      },
    });
    this.worker = worker;
    worker.on('message', (message) => {
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(message.id);
      if (message.error) {
        this.retryAfter = Date.now() + 30000;
        request.reject(new Error('local embedding unavailable'));
      } else request.resolve(message.result);
      if (!this.pending.size) worker.unref();
    });
    const failed = () => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.retryAfter = Date.now() + 30000;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('local embedding worker stopped'));
      }
      this.pending.clear();
      void worker.terminate();
    };
    worker.on('error', failed);
    worker.on('exit', failed);
    worker.unref();
  }
  request(payload) {
    if (this.closed) return Promise.reject(new Error('local embedding closed'));
    if (Date.now() < (this.retryAfter || 0) || this.pending.size >= 8)
      return Promise.reject(new Error('local embedding temporarily unavailable'));
    this.open();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Kill timed-out inference/download work so retry cannot accumulate workers.
        void this.worker?.terminate();
      }, 180000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.ref();
      this.worker.postMessage({ id, ...payload });
    });
  }
  close() {
    this.closed = true;
    void this.worker?.terminate();
  }
}
export class LocalEmbeddings {
  constructor(directory, { offline = false, rerank = true } = {}) {
    this.id = `${embeddingModel.name}@${embeddingModel.revision}:hf4.3.0:q8:mean:256:batch1:${knowledgeChunkVersion}`;
    this.dimensions = embeddingModel.dimensions;
    this.rerankEnabled = rerank;
    // Independent lazy workers: downloading or failing the optional reranker
    // must not block query embeddings or the durable indexing queue.
    this.embeddings = new InferenceWorker(directory, offline);
    this.reranking = new InferenceWorker(directory, offline);
  }
  embed(texts) {
    return this.embeddings.request({ type: 'embed', texts });
  }
  rerank(query, texts) {
    if (!this.rerankEnabled) return Promise.reject(new Error('reranking disabled'));
    // Do not queue expensive reranks behind a download or a timed-out request.
    if (this.reranking.pending.size) return Promise.reject(new Error('reranking busy'));
    return this.reranking.request({ type: 'rerank', query, texts });
  }
  close() {
    this.embeddings.close();
    this.reranking.close();
  }
}
export function runtimeEmbeddings(directory) {
  if (
    process.env.WORKROOM_SEMANTIC_SEARCH === '0' ||
    (process.env.WORKROOM_HEADLESS === '1' && process.env.WORKROOM_SEMANTIC_SEARCH !== '1')
  )
    return null;
  return new LocalEmbeddings(process.env.WORKROOM_MODEL_CACHE || path.join(directory, 'models'), {
    offline: process.env.WORKROOM_MODELS_OFFLINE === '1',
    rerank: process.env.WORKROOM_RERANK !== '0',
  });
}
