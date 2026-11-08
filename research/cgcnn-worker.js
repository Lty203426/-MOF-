/* cgcnn-worker.js — 在 Web Worker 里跑 CGCNN，避免主线程卡顿。 */
import { CgcnnEngine } from './cgcnn-engine.js';

const CACHE = 'mof-cgcnn-weights-v3';

async function cachedFetch(url) {
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit;
    const response = await fetch(url, { cache: 'force-cache' });
    if (response.ok) await cache.put(url, response.clone());
    return response;
  } catch {
    return fetch(url);
  }
}

let enginePromise = null;
function engineFor(base) {
  if (!enginePromise) enginePromise = CgcnnEngine.load(base, { fetch: cachedFetch });
  return enginePromise;
}

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type !== 'run') return;
  const { structure, models, base, tag } = message;
  try {
    const engine = await engineFor(base || './model/');
    await engine.loadEmbedding();
    self.postMessage({ type: 'status', tag, text: '构建周期邻接图…' });
    const graph = engine.buildGraph(structure);
    for (let i = 0; i < models.length; i++) {
      const id = models[i];
      self.postMessage({ type: 'status', tag, text: '正在推理 ' + id, index: i, total: models.length });
      const value = await engine.predict(id, graph);
      self.postMessage({ type: 'result', tag, modelId: id, value });
    }
    self.postMessage({ type: 'done', tag });
  } catch (error) {
    self.postMessage({ type: 'error', tag, message: error && error.message ? error.message : String(error) });
  }
};
