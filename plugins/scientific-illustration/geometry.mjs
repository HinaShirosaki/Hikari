export const RESIZE_HANDLES = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0],
  se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0]
};

export function resizeAnchor(box, direction) {
  const [horizontal, vertical] = RESIZE_HANDLES[direction];
  const angle = box.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: box.x + box.width / 2 - horizontal * box.width / 2 * cos + vertical * box.height / 2 * sin,
    y: box.y + box.height / 2 - horizontal * box.width / 2 * sin - vertical * box.height / 2 * cos };
}

// Handles resize the object's box. Typography stays fixed for text, including
// when Shift preserves the box's proportions.
export function resizeObject(object, direction, dx, dy, box = object, keepRatio = false) {
  const [horizontal, vertical] = RESIZE_HANDLES[direction];
  const angle = object.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
  // Project a corner drag onto its original diagonal. Edge drags scale
  // from their active axis, keeping the opposite edge midpoint fixed.
  const factor = horizontal && vertical
    ? 1 + (horizontal * localX * box.width + vertical * localY * box.height) / (box.width ** 2 + box.height ** 2)
    : 1 + (horizontal ? horizontal * localX / box.width : vertical * localY / box.height);
  let size;
  if (keepRatio) {
    // One clamped scale, so neither dimension can stop at a limit alone.
    const scale = Math.min(8000 / object.width, 8000 / object.height, Math.max(1 / object.width, 1 / object.height, factor));
    size = { width: object.width * scale, height: object.height * scale };
  } else {
    size = {
      width: horizontal ? Math.min(8000, Math.max(1, object.width + horizontal * localX)) : object.width,
      height: vertical ? Math.min(8000, Math.max(1, object.height + vertical * localY)) : object.height
    };
  }
  const { width, height } = size;
  const dw = width - object.width, dh = height - object.height;
  // Move the rotated center by half the actual size change, keeping the
  // opposite edge/corner fixed even when a dimension reaches its limit.
  return { ...size,
    x: object.x + (horizontal * dw * cos - vertical * dh * sin - dw) / 2,
    y: object.y + (horizontal * dw * sin + vertical * dh * cos - dh) / 2 };
}

export function resizeCursor(direction, rotation) {
  const [x, y] = RESIZE_HANDLES[direction];
  const angle = Math.atan2(y, x) * 180 / Math.PI + rotation;
  const index = ((Math.round(angle / 45) % 4) + 4) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][index];
}

// Group membership never changes the coordinate system or the paint order.
// Components retain their own geometry, artwork and editable text.

export function objectCorners(object) {
  const angle = object.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const cx = object.x + object.width / 2, cy = object.y + object.height / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({
    x: cx + x * object.width / 2 * cos - y * object.height / 2 * sin,
    y: cy + x * object.width / 2 * sin + y * object.height / 2 * cos
  }));
}

export function selectionBounds(objects) {
  if (!objects.length) return null;
  const points = objects.flatMap(objectCorners);
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

export function resizeSelection(objects, direction, dx, dy, box = selectionBounds(objects)) {
  const original = selectionBounds(objects), [horizontal, vertical] = RESIZE_HANDLES[direction];
  const factor = horizontal && vertical
    ? 1 + (horizontal * dx * box.width + vertical * dy * box.height) / (box.width ** 2 + box.height ** 2)
    : 1 + (horizontal ? horizontal * dx / box.width : vertical * dy / box.height);
  const limits = scaleLimits(objects), scale = Math.max(limits.min, Math.min(limits.max, factor));
  const width = box.width * scale, height = box.height * scale;
  return { x: box.x + (horizontal - 1) * (width - box.width) / 2 + (original.x - box.x) * scale,
    y: box.y + (vertical - 1) * (height - box.height) / 2 + (original.y - box.y) * scale,
    width: original.width * scale, height: original.height * scale };
}

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

const EPSILON = 1e-7;
const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const onSegment = (a, b, p) => Math.abs(cross(a, b, p)) <= EPSILON
  && p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON
  && p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;

function contains(polygon, p) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (onSegment(a, b, p)) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function intersects(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return ((abC > EPSILON && abD < -EPSILON || abC < -EPSILON && abD > EPSILON)
    && (cdA > EPSILON && cdB < -EPSILON || cdA < -EPSILON && cdB > EPSILON))
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function overlaps(a, b) {
  if (a.some(p => contains(b, p)) || b.some(p => contains(a, p))) return true;
  return a.some((p, i) => b.some((q, j) => intersects(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])));
}

export function rectanglePoints(start, end) {
  return [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }];
}

// The region and the component boxes use canvas coordinates. Even-odd fill
// matches the visible lasso, including concave and self-crossing paths.
export function regionSelection(document, canvas, polygon, { individual = false, editingGroupId = '', getBounds = object => object } = {}) {
  if (polygon.length < 3) return [];
  const second = polygon.find(p => Math.hypot(p.x - polygon[0].x, p.y - polygon[0].y) > EPSILON);
  if (!second || !polygon.some(p => Math.abs(cross(polygon[0], second, p)) > EPSILON)) return [];
  const ids = new Set(document.objects.filter(object => object.canvas === canvas && object.visible
    && overlaps(polygon, objectCorners(getBounds(object)))).map(object => object.id));
  if (!individual) {
    for (const group of document.groups || []) {
      if (group.id !== editingGroupId && group.ids.some(id => ids.has(id))) group.ids.forEach(id => ids.add(id));
    }
  }
  return document.objects.filter(object => object.canvas === canvas && ids.has(object.id)).map(object => object.id);
}

// A complete group is one layout item; individually selected members stay
// independent. Measure editing bounds, but translate the authored geometry.
export function selectionLayoutUnits(state, ids, getBounds = object => object) {
  const selected = new Set(ids), objects = (state?.objects || []).filter(object => selected.has(object.id));
  const groups = (state?.groups || []).filter(group => group.ids.every(id => selected.has(id)));
  const used = new Set(), units = [];
  for (const object of objects) {
    if (used.has(object.id)) continue;
    const group = groups.find(group => group.ids.includes(object.id));
    const members = group ? objects.filter(member => group.ids.includes(member.id)) : [object];
    members.forEach(member => used.add(member.id));
    units.push({ objects: members, bounds: selectionBounds(members.map(getBounds)) });
  }
  return units;
}

export function alignmentOperations(state, ids, action, getBounds = object => object) {
  const actions = ['left', 'right', 'top', 'bottom', 'horizontal-center', 'vertical-center',
    'distribute-horizontal', 'distribute-vertical'];
  if (!actions.includes(action)) throw new Error('Unknown alignment action.');
  const units = selectionLayoutUnits(state, ids, getBounds), distribute = action.startsWith('distribute-');
  if (units.length < (distribute ? 3 : 2)) return [];
  const horizontal = ['left', 'right', 'horizontal-center', 'distribute-horizontal'].includes(action);
  const axis = horizontal ? 'x' : 'y', size = horizontal ? 'width' : 'height';
  const start = Math.min(...units.map(unit => unit.bounds[axis]));
  const end = Math.max(...units.map(unit => unit.bounds[axis] + unit.bounds[size]));
  const operations = [];
  function translate(unit, target) {
    const delta = target - unit.bounds[axis];
    if (Math.abs(delta) < 1e-9) return;
    for (const object of unit.objects) operations.push({ op: 'update', id: object.id, patch: { [axis]: object[axis] + delta } });
  }
  if (distribute) {
    const ordered = [...units].sort((a, b) => a.bounds[axis] - b.bounds[axis]);
    const first = ordered[0].bounds, last = ordered.at(-1).bounds;
    const gap = (last[axis] + last[size] - first[axis] - ordered.reduce((sum, unit) => sum + unit.bounds[size], 0)) / (ordered.length - 1);
    let target = first[axis];
    ordered.forEach((unit, index) => {
      // Keep both outer items exactly fixed, including floating-point geometry.
      if (index && index < ordered.length - 1) translate(unit, target);
      target += unit.bounds[size] + gap;
    });
  } else {
    for (const unit of units) {
      const target = ['left', 'top'].includes(action) ? start
        : ['right', 'bottom'].includes(action) ? end - unit.bounds[size]
          : (start + end - unit.bounds[size]) / 2;
      translate(unit, target);
    }
  }
  return operations;
}

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
