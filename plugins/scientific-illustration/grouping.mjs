// Group membership never changes the coordinate system or the paint order.
// Components retain their own geometry, artwork and editable text.
import { RESIZE_HANDLES } from './geometry.mjs';

export function selectionBounds(objects) {
  if (!objects.length) return null;
  const points = objects.flatMap(object => {
    const angle = object.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const cx = object.x + object.width / 2, cy = object.y + object.height / 2;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({
      x: cx + x * object.width / 2 * cos - y * object.height / 2 * sin,
      y: cy + x * object.width / 2 * sin + y * object.height / 2 * cos
    }));
  });
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
  return { x, y, width: Math.max(...points.map(point => point.x)) - x,
    height: Math.max(...points.map(point => point.y)) - y, rotation: 0 };
}

function scaleLimits(objects) {
  return {
    min: Math.max(...objects.map(o => Math.max(1 / o.width, 1 / o.height, o.type === 'text' ? 4 / o.fontSize : 0))),
    max: Math.min(...objects.map(o => Math.min(8000 / o.width, 8000 / o.height, o.type === 'text' ? 300 / o.fontSize : Infinity)))
  };
}

export function transformSelection(objects, patch) {
  if (!objects.length) throw new Error('Select at least one component.');
  if (new Set(objects.map(o => o.canvas)).size !== 1) throw new Error('A selection must be on one canvas.');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)
    || Object.keys(patch).some(key => !['x', 'y', 'width', 'height'].includes(key))) throw new Error('Group transforms support x, y, width and height. Edit rotation and styling on individual components.');
  for (const [key, value] of Object.entries(patch)) {
    if (!Number.isFinite(value) || (['width', 'height'].includes(key) && value <= 0)) throw new Error(`${key} must be a finite ${['width', 'height'].includes(key) ? 'positive ' : ''}number.`);
  }
  const box = selectionBounds(objects);
  const scale = patch.width !== undefined ? patch.width / box.width : patch.height !== undefined ? patch.height / box.height : 1;
  if (patch.width !== undefined && patch.height !== undefined
    && Math.abs(patch.height / box.height - scale) > 1e-8 * Math.max(1, scale)) throw new Error('Resize groups proportionally: set width or height, or both with the same scale.');
  const limits = scaleLimits(objects);
  if (scale < limits.min - 1e-10 || scale > limits.max + 1e-10) throw new Error('Group resize exceeds a component size or text font limit.');
  return objects.map(object => ({ ...object,
    x: (patch.x ?? box.x) + (object.x - box.x) * scale,
    y: (patch.y ?? box.y) + (object.y - box.y) * scale,
    width: Math.max(1, Math.min(8000, object.width * scale)), height: Math.max(1, Math.min(8000, object.height * scale)),
    ...(object.type === 'text' ? { fontSize: Math.max(4, Math.min(300, object.fontSize * scale)) } : {})
  }));
}

export function resizeSelection(objects, direction, dx, dy) {
  const box = selectionBounds(objects), [horizontal, vertical] = RESIZE_HANDLES[direction];
  const factor = horizontal && vertical
    ? 1 + (horizontal * dx * box.width + vertical * dy * box.height) / (box.width ** 2 + box.height ** 2)
    : 1 + (horizontal ? horizontal * dx / box.width : vertical * dy / box.height);
  const limits = scaleLimits(objects), scale = Math.max(limits.min, Math.min(limits.max, factor));
  const width = box.width * scale, height = box.height * scale;
  return { x: box.x + (horizontal - 1) * (width - box.width) / 2,
    y: box.y + (vertical - 1) * (height - box.height) / 2, width, height };
}
