import { selectionLayoutUnits } from './alignment.mjs';

// Measure once per gesture. A group is one reference; hidden components and
// the moving selection never attract it. Text uses the same bounds as handles.
export function smartGuideTargets(state, ids, getBounds = object => object) {
  const selected = new Set(ids), canvas = state.objects.find(object => selected.has(object.id))?.canvas;
  const objects = state.objects.filter(object => object.canvas === canvas && !selected.has(object.id)
    && object.visible !== false && object.opacity !== 0);
  return selectionLayoutUnits({ ...state, objects }, objects.map(object => object.id), getBounds)
    .map(unit => unit.bounds);
}

const dimensions = { x: ['width', 'y', 'height'], y: ['height', 'x', 'width'] };
const end = (box, axis, size) => box[axis] + box[size];
const overlap = (a, b, axis, size) => Math.min(end(a, axis, size), end(b, axis, size)) - Math.max(a[axis], b[axis]);
const separation = (a, b, axis, size) => Math.max(0, -overlap(a, b, axis, size));

function alignmentCandidates(box, targets, canvas, axis, near) {
  const [size, cross, crossSize] = dimensions[axis], candidates = [];
  const add = (value, factor, reference, distance = 0) => candidates.push({
    kind: 'alignment', delta: value - box[axis] - box[size] * factor, value, reference, distance
  });
  // Canvas edges match the corresponding edge; canvas centers match centers.
  for (const factor of [0, .5, 1]) add(canvas[size] * factor, factor, { [cross]: 0, [crossSize]: canvas[crossSize] });
  for (const target of targets) {
    const distance = separation(box, target, cross, crossSize);
    if (distance > near) continue;
    for (const factor of [0, .5, 1]) {
      // Match centers to centers, and either edge to another edge.
      for (const targetFactor of factor === .5 ? [.5] : [0, 1]) {
        add(target[axis] + target[size] * targetFactor, factor, target, distance);
      }
    }
  }
  return candidates;
}

function spacingCandidates(box, targets, axis, near, tolerance) {
  const [size, cross, crossSize] = dimensions[axis];
  // Compare adjacent neighbors in the same row/column, then reject placements
  // that collide with another component in that lane.
  const lane = targets.filter(target => overlap(box, target, cross, crossSize) > 0)
    .sort((a, b) => a[axis] - b[axis]);
  const candidates = [];
  const add = (target, a, b, placement) => {
    if (Math.abs(target - box[axis]) > tolerance) return;
    // Do not extend a pattern into another component in the same lane.
    if (lane.some(item => Math.min(target + box[size], end(item, axis, size)) - Math.max(target, item[axis]) > 1e-8)) return;
    candidates.push({ kind: 'spacing', delta: target - box[axis], a, b, placement, distance: 0 });
  };
  for (let index = 1; index < lane.length; index++) {
    const a = lane[index - 1], b = lane[index], gap = b[axis] - end(a, axis, size);
    if (gap < 0 || gap > near || overlap(a, b, cross, crossSize) <= 0) continue;
    add(a[axis] - gap - box[size], a, b, 'before');
    if (gap >= box[size]) add((end(a, axis, size) + b[axis] - box[size]) / 2, a, b, 'between');
    add(end(b, axis, size) + gap, a, b, 'after');
  }
  return candidates;
}

function spacingGuide(candidate, box, axis, scale, canvas) {
  const [size, cross, crossSize] = dimensions[axis], { a, b, placement } = candidate;
  const ordered = placement === 'before' ? [box, a, b] : placement === 'between' ? [a, box, b] : [a, b, box];
  return { kind: 'spacing', axis,
    cross: Math.min(canvas[crossSize] - 8 / scale, Math.max(...ordered.map(item => end(item, cross, crossSize))) + 14 / scale),
    segments: ordered.slice(1).map((item, index) => ({ from: end(ordered[index], axis, size), to: item[axis] })) };
}

// Deltas always start at pointer-down geometry, so leaving the threshold
// releases the magnet without accumulating rounding or dragging drift.
export function snapTranslation(bounds, targets, canvas, dx, dy, { scale = 1, disabled = false, axis = null } = {}) {
  if (disabled) return { dx, dy, guides: [] };
  scale = Math.max(.01, scale);
  const tolerance = 6 / scale, near = 240 / scale;
  const moved = { ...bounds, x: bounds.x + dx, y: bounds.y + dy }, chosen = {};
  const axes = axis === 'x' || axis === 'y' ? [axis] : ['x', 'y'];
  for (const axis of axes) {
    const candidates = [...alignmentCandidates(moved, targets, canvas, axis, near), ...spacingCandidates(moved, targets, axis, near, tolerance)]
      .filter(candidate => Math.abs(candidate.delta) <= tolerance);
    candidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta)
      || (a.kind === 'spacing' ? 0 : 1) - (b.kind === 'spacing' ? 0 : 1) || a.distance - b.distance);
    chosen[axis] = candidates[0];
  }
  const snapped = { ...moved, x: moved.x + (chosen.x?.delta || 0), y: moved.y + (chosen.y?.delta || 0) };
  const guides = [];
  for (const axis of axes) {
    const candidate = chosen[axis];
    if (!candidate) continue;
    const [, cross, crossSize] = dimensions[axis];
    const lines = new Map();
    // Show every coincident edge/center, including a canvas center shared with
    // nearby components, rather than only the first winning reference.
    for (const match of alignmentCandidates(snapped, targets, canvas, axis, near)) {
      if (Math.abs(match.delta) > .01 / scale) continue;
      const key = Math.round(match.value * scale * 100), previous = lines.get(key);
      const from = Math.min(snapped[cross], match.reference[cross]) - 8 / scale;
      const to = Math.max(end(snapped, cross, crossSize), end(match.reference, cross, crossSize)) + 8 / scale;
      lines.set(key, { kind: 'alignment', axis, value: match.value,
        from: Math.max(0, Math.min(previous?.from ?? from, from)),
        to: Math.min(canvas[crossSize], Math.max(previous?.to ?? to, to)) });
    }
    guides.push(...lines.values());
    if (candidate.kind === 'spacing') guides.push(spacingGuide(candidate, snapped, axis, scale, canvas));
  }
  return { dx: dx + (chosen.x?.delta || 0), dy: dy + (chosen.y?.delta || 0), guides };
}
