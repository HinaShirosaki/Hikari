import { componentSvgSource } from './artwork.mjs';

// Keep decoded artwork across selection redraws and moves. Sampling one source
// pixel avoids retaining a full RGBA copy of every large generated component.
export function createArtworkHitTester() {
  const cache = new Map();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = false;

  function prepare(objects) {
    const active = new Set();
    for (const object of objects) {
      if (!object.visible || object.opacity <= 0 || object.type === 'text') continue;
      active.add(object.id);
      const key = object.type === 'raster' ? object.dataUrl
        : JSON.stringify([object.svg, object.width, object.height, object.fill, object.stroke, object.strokeWidth]);
      if (cache.get(object.id)?.key === key) continue;
      const image = new Image(), entry = { key, image, ready: false };
      image.onload = () => { entry.ready = true; };
      image.src = object.type === 'raster' ? object.dataUrl
        : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(componentSvgSource(object))}`;
      cache.set(object.id, entry);
    }
    for (const id of cache.keys()) if (!active.has(id)) cache.delete(id);
  }

  function painted(object, group, event) {
    if (!object || !object.visible || object.opacity <= 0) return false;
    // Text keeps its tight typographic target, including spaces between glyphs.
    if (object.type === 'text') return true;
    const entry = cache.get(object.id), matrix = group.getScreenCTM();
    if (!entry?.ready || !matrix) return false;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    if (point.x < 0 || point.y < 0 || point.x >= object.width || point.y >= object.height) return false;
    const { image } = entry;
    const x = Math.floor(point.x / object.width * image.naturalWidth);
    const y = Math.floor(point.y / object.height * image.naturalHeight);
    context.clearRect(0, 0, 1, 1);
    context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[3] > 0;
  }

  function hit(stage, objects, event, { handles = true } = {}) {
    const seen = new Set(), byId = new Map(objects.map(object => [object.id, object]));
    // DOM order preserves the actual stacking and SVG transforms at any zoom.
    for (const node of document.elementsFromPoint(event.clientX, event.clientY)) {
      if (!stage.contains(node)) continue;
      const target = node.closest('[data-object-id], [data-resize-id], [data-rotate-id], [data-move-id]');
      if (!target || seen.has(target)) continue;
      seen.add(target);
      if (target.dataset.objectId) {
        if (painted(byId.get(target.dataset.objectId), target, event)) return target;
      } else if (handles) return target;
    }
    return null;
  }

  return { prepare, hit };
}
