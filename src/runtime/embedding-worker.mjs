import { parentPort, workerData } from 'node:worker_threads';
import { rerankingModel } from './reranking-model.mjs';

let extractor;
let reranker;
async function loadReranker() {
  const { AutoTokenizer, AutoModelForSequenceClassification, env } =
    await import('@huggingface/transformers');
  env.allowLocalModels = workerData.offline;
  env.localModelPath = workerData.cacheDir;
  const options = {
    revision: rerankingModel.revision,
    cache_dir: workerData.cacheDir,
    local_files_only: workerData.offline,
  };
  const tokenizer = await AutoTokenizer.from_pretrained(rerankingModel.name, options);
  const model = await AutoModelForSequenceClassification.from_pretrained(rerankingModel.name, {
    ...options,
    model_file_name: rerankingModel.modelFile,
    dtype: 'fp32',
    device: 'cpu',
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  });
  return { tokenizer, model };
}
async function load() {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = workerData.offline;
  env.localModelPath = workerData.cacheDir;
  return pipeline('feature-extraction', workerData.name, {
    revision: workerData.revision,
    dtype: 'q8',
    device: 'cpu',
    cache_dir: workerData.cacheDir,
    local_files_only: workerData.offline,
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  });
}
let queue = Promise.resolve();
parentPort.on('message', (message) => {
  queue = queue.then(async () => {
    try {
      if (message.type === 'rerank') {
        const { tokenizer, model } = await (reranker ||= loadReranker());
        const scores = [];
        for (const text of message.texts) {
          const inputs = tokenizer([message.query], {
            text_pair: [text],
            padding: true,
            truncation: true,
            max_length: 512,
          });
          const output = await model(inputs);
          scores.push(Number(output.logits.data[0]));
        }
        parentPort.postMessage({ id: message.id, result: scores });
        return;
      }
      extractor ||= load();
      const pipe = await extractor;
      const vectors = [];
      // Quantized inference varies with other texts in the same batch. Embed
      // each text alone so adding passages cannot perturb existing vectors.
      for (let i = 0; i < message.texts.length; i++) {
        const output = await pipe([message.texts[i]], {
          pooling: 'mean',
          normalize: true,
          truncation: true,
          max_length: 256,
        });
        vectors.push(...output.tolist());
      }
      parentPort.postMessage({ id: message.id, result: vectors });
    } catch {
      if (message.type === 'rerank') reranker = null;
      else extractor = null;
      parentPort.postMessage({ id: message.id, error: 'embedding_unavailable' });
    }
  });
});
