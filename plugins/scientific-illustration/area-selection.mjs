import { objectCorners } from './grouping.mjs';

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
export function regionSelection(document, canvas, polygon, { individual = false, getBounds = object => object } = {}) {
  if (polygon.length < 3) return [];
  const second = polygon.find(p => Math.hypot(p.x - polygon[0].x, p.y - polygon[0].y) > EPSILON);
  if (!second || !polygon.some(p => Math.abs(cross(polygon[0], second, p)) > EPSILON)) return [];
  const ids = new Set(document.objects.filter(object => object.canvas === canvas && object.visible
    && overlaps(polygon, objectCorners(getBounds(object)))).map(object => object.id));
  if (!individual) {
    for (const group of document.groups || []) {
      if (group.ids.some(id => ids.has(id))) group.ids.forEach(id => ids.add(id));
    }
  }
  return document.objects.filter(object => object.canvas === canvas && ids.has(object.id)).map(object => object.id);
}
