import { buildCircularMapSvg } from './sequence-map/circular-map.js';
import { getMapKind } from './sequence-map/geometry.js';
import { buildLinearMapSvg } from './sequence-map/linear-map.js';
import { CIRCULAR_VIEWBOX_MIN, CIRCULAR_VIEWBOX_SIZE, LINEAR_TRACK_X0, LINEAR_TRACK_X1, LINEAR_VIEWBOX_HEIGHT, LINEAR_VIEWBOX_WIDTH, TAU } from './sequence-map/map-constants.js';

/**
 * Convert a pointer position over a rendered map into a base offset.
 * Pure geometry (takes a rect, not an element) so it is testable without a DOM
 * and independent of how the SVG was mounted -- including at any zoom or scroll
 */
export function resolveBaseFromPoint(rect, clientX, clientY, sequenceLength, kind = 'circular') {
  const width = Number(rect?.width) || 0;
  const height = Number(rect?.height) || 0;
  const length = Math.max(1, Math.round(Number(sequenceLength) || 0));
  if (width <= 0 || height <= 0) {
    return null;
  }

  const isLinear = kind === 'linear';
  const viewWidth = isLinear ? LINEAR_VIEWBOX_WIDTH : CIRCULAR_VIEWBOX_SIZE;
  const viewHeight = isLinear ? LINEAR_VIEWBOX_HEIGHT : CIRCULAR_VIEWBOX_SIZE;
  const minX = isLinear ? 0 : CIRCULAR_VIEWBOX_MIN;
  const minY = isLinear ? 0 : CIRCULAR_VIEWBOX_MIN;

  // preserveAspectRatio="xMidYMid meet": uniform scale, centred letterboxing.
  const scale = Math.min(width / viewWidth, height / viewHeight);
  const originX = (Number(rect.left) || 0) + ((width - (viewWidth * scale)) / 2);
  const originY = (Number(rect.top) || 0) + ((height - (viewHeight * scale)) / 2);
  const x = (((Number(clientX) || 0) - originX) / scale) + minX;
  const y = (((Number(clientY) || 0) - originY) / scale) + minY;

  if (isLinear) {
    const ratio = (x - LINEAR_TRACK_X0) / (LINEAR_TRACK_X1 - LINEAR_TRACK_X0);
    return Math.min(length, Math.max(0, Math.round(ratio * length)));
  }

  if (x === 0 && y === 0) {
    return null;
  }
  const angle = Math.atan2(x, -y);
  const normalized = angle < 0 ? angle + TAU : angle;
  return Math.min(length, Math.max(0, Math.round((normalized / TAU) * length)));
}

export function buildSequenceMapSvg(record, options = {}) {
  if (!Number(record?.sequence?.length)) {
    return '<p class="small-note">No sequence available to map.</p>';
  }
  return getMapKind(record) === 'circular'
    ? buildCircularMapSvg(record, options)
    : buildLinearMapSvg(record, options);
}

export { getMapKind, clampMapZoom } from './sequence-map/geometry.js';
