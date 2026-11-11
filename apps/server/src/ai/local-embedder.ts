import { runtimePaths } from '../storage';
import { RAG_ENABLED, type Embedder } from './embeddings';

/**
 * Local sentence embeddings through Transformers.js (onnxruntime). Nothing leaves the machine and
 * there is no API cost. The model is downloaded once into `<data dir>/models` and cached there.
 *
 * The default model, paraphrase-multilingual-MiniLM-L12-v2, is 384-dimensional and handles
 * Portuguese and English (and ~50 other languages) without prompt prefixes. Loading is lazy: the
 * first retrieval or indexing job pays for it, and a failure (offline, unsupported platform) only
 * logs once and leaves the existing BM25 search in place.
 */

export const DEFAULT_RAG_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const DEFAULT_DIM = 384;

export interface LocalEmbedderOptions {
  /** Directory that holds the model cache. Defaults to `<DAGGERY_DATA_DIR>/models`. */
  modelsDir?: string;
  model?: string;
  dim?: number;
  log?: (message: string) => void;
}

/** A lazily initialized local embedder. The returned provider resolves to null when RAG is off or fails. */
export function localEmbedderProvider(options: LocalEmbedderOptions = {}): () => Promise<Embedder | null> {
  let cached: Promise<Embedder | null> | null = null;
  return () => {
    if (!cached) cached = loadEmbedder(options);
    return cached;
  };
}

async function loadEmbedder(options: LocalEmbedderOptions): Promise<Embedder | null> {
  if (!RAG_ENABLED()) return null;
  const log = options.log ?? ((message: string) => console.warn(message));
  const model = options.model ?? process.env.DAGGERY_RAG_MODEL ?? DEFAULT_RAG_MODEL;
  const dim = options.dim ?? DEFAULT_DIM;
  const modelsDir = options.modelsDir ?? runtimePaths().models;
  try {
    const transformers = await import('@huggingface/transformers');
    const { env, pipeline } = transformers;
    env.cacheDir = modelsDir;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    // q8 keeps the download near ~120 MB and the resident model small; the ONNX graph is a
    // quantized export shipped in the model repository.
    const extractor = await pipeline('feature-extraction', model, { dtype: 'q8' });
    const embedder: Embedder = {
      model: model + '@q8',
      dim,
      async embed(texts: string[]): Promise<Float32Array[]> {
        if (!texts.length) return [];
        const output = await extractor(texts, { pooling: 'mean', normalize: true });
        const rows = output.tolist() as unknown as number[][];
        return rows.map(row => Float32Array.from(row));
      },
    };
    return embedder;
  } catch (error) {
    log('The local embedding model could not be loaded (' + (error instanceof Error ? error.message : 'unknown error') + '). Semantic search falls back to BM25.');
    return null;
  }
}
