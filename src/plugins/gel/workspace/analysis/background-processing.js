import { createPreprocessingCache, normalizeEnhancementSettings } from './image-processing.js';

export function createBackgroundPreprocessor({ workerFactory = () => new Worker(new URL('./processing-worker.js', import.meta.url), { type: 'module' }) } = {}) {
  let worker = null, active = null, sequence = 0, imageSequence = 0, disposed = false, fallback = false, timer = null;
  const imageIds = new WeakMap(), sentImages = new Map(), cache = new Map(), queue = [];
  const local = createPreprocessingCache();
  let lastStats = null;
  const imageId = gray => {
    if (!imageIds.has(gray)) imageIds.set(gray, ++imageSequence);
    return imageIds.get(gray);
  };
  const key = (gray, width, height, settings) => `${imageId(gray)}:${width}:${height}:${settings.denoiseStrength}:${settings.contrastBoost}`;
  function peek(gray, width, height, settings) {
    const entry = cache.get(imageId(gray));
    return entry?.key === key(gray, width, height, normalizeEnhancementSettings(settings)) ? entry.result : null;
  }
  function complete(job, result, stats) {
    if (disposed || active !== job) return;
    clearTimeout(timer); timer = null;
    if (result) {
      cache.delete(job.imageId); cache.set(job.imageId, { key: job.key, result });
      if (cache.size > 2) cache.delete(cache.keys().next().value);
      lastStats = stats;
    }
    active = null; job.resolve(result); pump();
  }
  function useFallback() {
    if (disposed) return;
    clearTimeout(timer); timer = null;
    worker?.terminate(); worker = null; fallback = true; sentImages.clear();
    if (active) { queue.unshift(active); active = null; }
    pump();
  }
  function pump() {
    if (disposed || active || !queue.length) return;
    active = queue.shift();
    const job = active;
    if (fallback) {
      timer = setTimeout(() => {
        if (disposed || active !== job) return;
        try {
          const start = performance.now();
          const result = local(job.gray, job.width, job.height, job.settings);
          complete(job, result, { backend: 'js-main-fallback', computeMs: performance.now() - start });
        } catch (error) { active = null; job.reject(error); pump(); }
      }, 0);
      return;
    }
    try {
      if (!worker) {
        worker = workerFactory();
        worker.onmessage = ({ data }) => {
          if (!active || data.id !== active.id || disposed) return;
          const current = active;
          if (data.error) {
            clearTimeout(timer); active = null; current.reject(new Error(data.error)); pump(); return;
          }
          const { previewRgba, width, height, ...result } = data.result;
          result.previewImageData = new ImageData(previewRgba, width, height);
          complete(current, result, data.stats);
        };
        worker.onerror = event => { event.preventDefault?.(); useFallback(); };
      }
      const pixels = sentImages.has(job.imageId) ? null : new Float32Array(job.gray);
      sentImages.delete(job.imageId); sentImages.set(job.imageId, true);
      if (sentImages.size > 2) sentImages.delete(sentImages.keys().next().value);
      worker.postMessage({ id: job.id, imageId: job.imageId, gray: pixels, width: job.width, height: job.height, settings: job.settings }, pixels ? [pixels.buffer] : []);
      timer = setTimeout(useFallback, 15000);
    } catch { useFallback(); }
  }
  function request(gray, width, height, rawSettings, { latestOnly = false } = {}) {
    if (disposed) return Promise.resolve(null);
    const settings = normalizeEnhancementSettings(rawSettings), jobKey = key(gray, width, height, settings);
    const found = peek(gray, width, height, settings);
    if (found) return Promise.resolve(found);
    const existing = [active, ...queue].find(job => job?.key === jobKey);
    if (existing) { existing.replaceable &&= latestOnly; return existing.promise; }
    const job = { id: ++sequence, key: jobKey, imageId: imageId(gray), gray, width, height, settings, replaceable: latestOnly };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    // While one calculation runs, keep only the latest queued slider position
    // for each editor image. Export/Stack consumers keep their own exact jobs.
    const prior = latestOnly ? queue.findIndex(item => item.imageId === job.imageId && item.replaceable) : -1;
    if (prior >= 0) queue.splice(prior, 1)[0].resolve(null);
    queue.push(job); pump(); return job.promise;
  }
  return { request, peek, getStats: () => lastStats,
    cancelEditorPending() {
      for (let index = queue.length - 1; index >= 0; index--) if (queue[index].replaceable) queue.splice(index, 1)[0].resolve(null);
    },
    destroy() {
      disposed = true; clearTimeout(timer); worker?.terminate();
      active?.resolve(null); queue.forEach(job => job.resolve(null));
      active = null; queue.length = 0; cache.clear(); sentImages.clear(); local.clear();
    } };
}
