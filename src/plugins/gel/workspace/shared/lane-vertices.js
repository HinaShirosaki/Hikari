// A lane's four corner points: the key order they are stored in, and how a stored
// point is read back as a number pair.
export const LANE_VERTEX_KEYS = Object.freeze(['topLeft', 'topRight', 'bottomRight', 'bottomLeft']);
export function normalizeOptionalPixel(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
}

export function normalizeVertexPoint(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y))
  };
}
