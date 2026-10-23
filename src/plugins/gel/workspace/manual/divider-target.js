import { normalizeManualOverrides } from '../shared.js';

// Measure the grab zone on screen so downscaled images are just as easy to edit.
const DIVIDER_GRAB_RADIUS = 12;

export function findLaneDividerNearPointer({ runtime, canvas, event }) {
  if (!runtime.currentImage) return null;
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height || event.clientX < bounds.left || event.clientX > bounds.right
    || event.clientY < bounds.top || event.clientY > bounds.bottom) return null;
  const segmentation = normalizeManualOverrides(runtime.manualOverrides).laneSegmentation;
  const boundaries = [segmentation.gelLeft, ...segmentation.dividers, segmentation.gelRight].filter(Number.isFinite);
  let target = null;
  let distance = Infinity;
  for (const x of boundaries) {
    const nextDistance = Math.abs(event.clientX - bounds.left - (x + .5) / runtime.currentImage.width * bounds.width);
    if (nextDistance <= DIVIDER_GRAB_RADIUS && nextDistance < distance) { target = x; distance = nextDistance; }
  }
  return target;
}
