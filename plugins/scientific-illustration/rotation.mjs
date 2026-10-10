import { selectionBounds } from './grouping.mjs';

export function angleDelta(from, to) {
  return ((to - from + 180) % 360 + 360) % 360 - 180;
}

export function rotateComponents(objects, degrees, pivot) {
  if (!objects.length || new Set(objects.map(object => object.canvas)).size !== 1) throw new Error('Rotate components on one canvas.');
  if (!Number.isFinite(degrees)) throw new Error('Rotation must be a finite number.');
  const box = selectionBounds(objects);
  const center = pivot ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) throw new Error('Rotation needs a finite pivot.');
  const delta = angleDelta(0, degrees);
  if (Math.abs(delta) < 1e-10) return objects.map(object => ({ ...object }));
  const radians = delta * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  return objects.map(object => {
    const dx = object.x + object.width / 2 - center.x, dy = object.y + object.height / 2 - center.y;
    return { ...object, x: center.x + dx * cos - dy * sin - object.width / 2,
      y: center.y + dx * sin + dy * cos - object.height / 2,
      rotation: angleDelta(0, object.rotation + delta) };
  });
}
