import { escapeHtml } from '../../../lib/html.js';
import {
  assignFeatureLanes,
  buildFeatureLocationText,
  getContrastTextColor,
  hashTypeToColor
} from '../feature-model.js';
import { normalizeTopology } from '../shared.js';

// Sequence map rendering, shared by the Vector Builder workspace and the
// library preview. Emits inline SVG carrying data-feature-index hooks, so the
// same markup serves as a static preview and as an interactive editing surface.
//
// Circular records get a plasmid ring; everything else gets a linear track --
// drawing a linear construct as a closed circle would assert a junction that
// does not exist.

const TAU = Math.PI * 2;

// --- circular geometry -------------------------------------------------------
const RADIUS = 250;
const RING_GAP = 14;
const RING_WIDTH = 18;
const LABEL_PAD = 168;
const LABEL_LINE_HEIGHT = 17;
const LABEL_COLUMN_X = RADIUS + 74;
const TICK_COUNT = 8;
const CIRCULAR_VIEWBOX_SIZE = 2 * (RADIUS + LABEL_PAD);
const CIRCULAR_VIEWBOX_MIN = -(RADIUS + LABEL_PAD);
// Below this fraction of the sequence a feature arc collapses to an unclickable
// sliver, so short features are padded out to stay selectable.
const MIN_ARC_FRACTION = 0.0022;

// --- linear geometry ---------------------------------------------------------
// A fixed viewBox in both modes keeps pointer->base inversion a pure function of
// the rendered rect, with no need to read layout back off the DOM.
const LINEAR_VIEWBOX_WIDTH = 1200;
const LINEAR_VIEWBOX_HEIGHT = 360;
const LINEAR_TRACK_X0 = 90;
const LINEAR_TRACK_X1 = 1110;
const LINEAR_AXIS_Y = 300;
const LINEAR_TOP_MARGIN = 64;
const LINEAR_BAND_HEIGHT = 20;
const LINEAR_LANE_GAP = 8;
const LINEAR_FIRST_BAND_GAP = 30;
const LINEAR_ON_BAR_CHAR_PX = 6.4;
const LINEAR_ABOVE_BAR_CHAR_PX = 6.8;
const LINEAR_ABOVE_BAR_ROWS = 3;
const LINEAR_ABOVE_BAR_ROW_HEIGHT = 12;
const LINEAR_MIN_SPAN_PX = 3;

// Zoom scales the SVG's layout box; 1 is "fit the pane", so there is nothing
// useful below it. The cap keeps a single gesture from scrolling into a
// thousand-fold blank field.
const MIN_MAP_ZOOM = 1;
const MAX_MAP_ZOOM = 12;

export function getMapKind(record) {
  return normalizeTopology(record?.topology) === 'circular' ? 'circular' : 'linear';
}

export function clampMapZoom(value) {
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) {
    return MIN_MAP_ZOOM;
  }
  return Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, zoom));
}

function fixed(value) {
  return (Number(value) || 0).toFixed(2);
}

function polar(radius, base, sequenceLength) {
  const theta = (TAU * base) / Math.max(1, sequenceLength);
  return {
    x: radius * Math.sin(theta),
    y: -radius * Math.cos(theta)
  };
}

function getFeatureOverallRange(feature, sequenceLength) {
  const segments = Array.isArray(feature?.segments) ? feature.segments : [];
  if (!segments.length) {
    return null;
  }
  const start = Math.max(0, Math.min(...segments.map((segment) => Number(segment?.start) || 0)));
  const end = Math.min(sequenceLength, Math.max(...segments.map((segment) => Number(segment?.end) || 0)));
  return end > start ? { start, end } : null;
}

function normalizeSegments(feature, sequenceLength) {
  return (Array.isArray(feature?.segments) ? feature.segments : [])
    .map((segment) => ({
      start: Math.max(0, Number(segment?.start) || 0),
      end: Math.min(sequenceLength, Number(segment?.end) || 0)
    }))
    .filter((segment) => segment.end > segment.start);
}

function describeFeature(feature, index, sequenceLength) {
  const colorKey = feature.type === 'restriction_site' ? `${feature.type}:${feature.name}` : feature.type;
  return {
    index,
    color: hashTypeToColor(colorKey),
    strand: Number(feature.strand) === -1 ? -1 : (Number(feature.strand) === 1 ? 1 : 0),
    name: String(feature.name || feature.type || 'feature'),
    title: `${feature.name || 'feature'} (${buildFeatureLocationText(feature, sequenceLength)})`,
    lane: Math.max(0, Number(feature.lane) || 0),
    segments: normalizeSegments(feature, sequenceLength)
  };
}

// =============================== circular ====================================

// Clockwise ring band, leading edge tapered into an arrowhead so strand
// direction reads at a glance.
function buildArcBandPath(startBase, endBase, innerRadius, outerRadius, sequenceLength, strand) {
  const span = Math.max(endBase - startBase, sequenceLength * MIN_ARC_FRACTION);
  const from = startBase;
  const to = startBase + span;
  const midRadius = (innerRadius + outerRadius) / 2;
  const tip = Math.min(span / 2, sequenceLength * 0.009);
  const largeArc = span / sequenceLength > 0.5 ? 1 : 0;

  if (strand === -1) {
    const bodyStart = from + tip;
    const outerBodyStart = polar(outerRadius, bodyStart, sequenceLength);
    const outerEnd = polar(outerRadius, to, sequenceLength);
    const innerEnd = polar(innerRadius, to, sequenceLength);
    const innerBodyStart = polar(innerRadius, bodyStart, sequenceLength);
    const point = polar(midRadius, from, sequenceLength);
    return [
      `M ${fixed(outerBodyStart.x)} ${fixed(outerBodyStart.y)}`,
      `A ${fixed(outerRadius)} ${fixed(outerRadius)} 0 ${largeArc} 1 ${fixed(outerEnd.x)} ${fixed(outerEnd.y)}`,
      `L ${fixed(innerEnd.x)} ${fixed(innerEnd.y)}`,
      `A ${fixed(innerRadius)} ${fixed(innerRadius)} 0 ${largeArc} 0 ${fixed(innerBodyStart.x)} ${fixed(innerBodyStart.y)}`,
      `L ${fixed(point.x)} ${fixed(point.y)}`,
      'Z'
    ].join(' ');
  }

  const bodyEnd = to - tip;
  const outerStart = polar(outerRadius, from, sequenceLength);
  const outerBodyEnd = polar(outerRadius, bodyEnd, sequenceLength);
  const point = polar(midRadius, to, sequenceLength);
  const innerBodyEnd = polar(innerRadius, bodyEnd, sequenceLength);
  const innerStart = polar(innerRadius, from, sequenceLength);
  return [
    `M ${fixed(outerStart.x)} ${fixed(outerStart.y)}`,
    `A ${fixed(outerRadius)} ${fixed(outerRadius)} 0 ${largeArc} 1 ${fixed(outerBodyEnd.x)} ${fixed(outerBodyEnd.y)}`,
    `L ${fixed(point.x)} ${fixed(point.y)}`,
    `L ${fixed(innerBodyEnd.x)} ${fixed(innerBodyEnd.y)}`,
    `A ${fixed(innerRadius)} ${fixed(innerRadius)} 0 ${largeArc} 0 ${fixed(innerStart.x)} ${fixed(innerStart.y)}`,
    'Z'
  ].join(' ');
}

function buildPlainArcPath(startBase, endBase, innerRadius, outerRadius, sequenceLength) {
  const span = Math.max(endBase - startBase, sequenceLength * MIN_ARC_FRACTION);
  const to = startBase + span;
  const largeArc = span / sequenceLength > 0.5 ? 1 : 0;
  const outerStart = polar(outerRadius, startBase, sequenceLength);
  const outerEnd = polar(outerRadius, to, sequenceLength);
  const innerEnd = polar(innerRadius, to, sequenceLength);
  const innerStart = polar(innerRadius, startBase, sequenceLength);
  return [
    `M ${fixed(outerStart.x)} ${fixed(outerStart.y)}`,
    `A ${fixed(outerRadius)} ${fixed(outerRadius)} 0 ${largeArc} 1 ${fixed(outerEnd.x)} ${fixed(outerEnd.y)}`,
    `L ${fixed(innerEnd.x)} ${fixed(innerEnd.y)}`,
    `A ${fixed(innerRadius)} ${fixed(innerRadius)} 0 ${largeArc} 0 ${fixed(innerStart.x)} ${fixed(innerStart.y)}`,
    'Z'
  ].join(' ');
}

// Two label columns pushed apart so stacked callouts never overlap, then
// re-centred if the column overflows the viewBox.
function layoutLabelColumn(entries) {
  const ordered = [...entries].sort((left, right) => left.desiredY - right.desiredY);
  let cursor = Number.NEGATIVE_INFINITY;
  ordered.forEach((entry) => {
    entry.y = Math.max(entry.desiredY, cursor + LABEL_LINE_HEIGHT);
    cursor = entry.y;
  });

  const limit = RADIUS + LABEL_PAD - LABEL_LINE_HEIGHT;
  const overflow = cursor - limit;
  if (overflow > 0) {
    ordered.forEach((entry) => {
      entry.y -= overflow;
    });
  }
  return ordered;
}

function renderCircularTicks(sequenceLength) {
  const marks = [];
  for (let index = 0; index < TICK_COUNT; index += 1) {
    const base = Math.round((sequenceLength * index) / TICK_COUNT);
    const inner = polar(RADIUS - 9, base, sequenceLength);
    const outer = polar(RADIUS, base, sequenceLength);
    const label = polar(RADIUS - 24, base, sequenceLength);
    marks.push(`
      <line class="vector-map__tick" x1="${fixed(inner.x)}" y1="${fixed(inner.y)}" x2="${fixed(outer.x)}" y2="${fixed(outer.y)}"></line>
      <text class="vector-map__tick-label" x="${fixed(label.x)}" y="${fixed(label.y)}" text-anchor="middle" dominant-baseline="middle">${(base + 1).toLocaleString()}</text>
    `);
  }
  return marks.join('');
}

function renderCircularSelection(selection, sequenceLength) {
  if (!selection) {
    return '';
  }
  const start = Math.max(0, Number(selection.start) || 0);
  const end = Math.min(sequenceLength, Number(selection.end) || 0);

  if (end <= start) {
    const point = polar(RADIUS + 4, start, sequenceLength);
    const origin = polar(RADIUS - 30, start, sequenceLength);
    return `<line class="vector-map__caret" x1="${fixed(origin.x)}" y1="${fixed(origin.y)}" x2="${fixed(point.x)}" y2="${fixed(point.y)}"></line>`;
  }
  return `<path class="vector-map__selection" d="${buildPlainArcPath(start, end, RADIUS - 7, RADIUS + 7, sequenceLength)}"></path>`;
}

function buildCircularMapSvg(record, options = {}) {
  const sequenceLength = Math.max(1, Number(record?.sequence?.length) || 0);
  const features = Array.isArray(options?.features) ? options.features : [];
  const selectedIndex = Number.isFinite(Number(options?.selectedFeatureIndex))
    ? Number(options.selectedFeatureIndex)
    : -1;
  const laidOut = assignFeatureLanes(features).map((feature, index) => describeFeature(feature, index, sequenceLength));

  const arcMarkup = [];
  const labelEntries = [];
  laidOut.forEach((feature) => {
    const innerRadius = RADIUS + RING_GAP + (feature.lane * (RING_WIDTH + 5));
    const outerRadius = innerRadius + RING_WIDTH;
    feature.segments.forEach((segment) => {
      arcMarkup.push(`
        <path
          class="vector-map__feature${feature.index === selectedIndex ? ' vector-map__feature--active' : ''}"
          data-feature-index="${feature.index}"
          tabindex="0"
          role="button"
          d="${buildArcBandPath(segment.start, segment.end, innerRadius, outerRadius, sequenceLength, feature.strand)}"
          fill="${feature.color}"
          aria-label="${escapeHtml(feature.title)}"
        ></path>
      `);
    });

    const range = getFeatureOverallRange(feature, sequenceLength);
    if (!range) {
      return;
    }
    const anchor = polar(outerRadius + 6, (range.start + range.end) / 2, sequenceLength);
    labelEntries.push({
      index: feature.index,
      color: feature.color,
      title: feature.title,
      name: feature.name,
      anchorX: anchor.x,
      anchorY: anchor.y,
      desiredY: anchor.y,
      side: anchor.x >= 0 ? 'right' : 'left'
    });
  });

  const labelMarkup = [
    layoutLabelColumn(labelEntries.filter((entry) => entry.side === 'right')),
    layoutLabelColumn(labelEntries.filter((entry) => entry.side === 'left'))
  ].flat().map((entry) => {
    const isRight = entry.side === 'right';
    const textX = isRight ? LABEL_COLUMN_X : -LABEL_COLUMN_X;
    const elbowX = isRight ? LABEL_COLUMN_X - 8 : -(LABEL_COLUMN_X - 8);
    const activeClass = entry.index === selectedIndex ? ' vector-map__label--active' : '';
    return `
      <g class="vector-map__label${activeClass}" data-feature-index="${entry.index}" tabindex="0" role="button" aria-label="${escapeHtml(entry.title)}">
        <polyline class="vector-map__leader" points="${fixed(entry.anchorX)},${fixed(entry.anchorY)} ${fixed(elbowX)},${fixed(entry.y)} ${fixed(textX)},${fixed(entry.y)}"></polyline>
        <text class="vector-map__label-text" x="${fixed(textX)}" y="${fixed(entry.y)}" text-anchor="${isRight ? 'start' : 'end'}" fill="${entry.color}" dominant-baseline="middle">${escapeHtml(entry.name)}</text>
      </g>
    `;
  }).join('');

  const name = String(record?.name || 'Sequence');
  return `
    <svg
      class="vector-map vector-map--circular"
      data-map-kind="circular"
      viewBox="${CIRCULAR_VIEWBOX_MIN} ${CIRCULAR_VIEWBOX_MIN} ${CIRCULAR_VIEWBOX_SIZE} ${CIRCULAR_VIEWBOX_SIZE}"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="${escapeHtml(`${name} circular plasmid map`)}"
    >
      <circle class="vector-map__backbone" cx="0" cy="0" r="${RADIUS}"></circle>
      ${renderCircularTicks(sequenceLength)}
      ${renderCircularSelection(options?.selection, sequenceLength)}
      ${arcMarkup.join('')}
      ${labelMarkup}
      <text class="vector-map__title" x="0" y="-10" text-anchor="middle">${escapeHtml(name)}</text>
      <text class="vector-map__subtitle" x="0" y="14" text-anchor="middle">${sequenceLength.toLocaleString()} bp</text>
      <text class="vector-map__subtitle" x="0" y="34" text-anchor="middle">circular</text>
    </svg>
  `;
}

// ================================ linear =====================================

function linearX(base, sequenceLength) {
  const ratio = Math.min(1, Math.max(0, (Number(base) || 0) / Math.max(1, sequenceLength)));
  return LINEAR_TRACK_X0 + (ratio * (LINEAR_TRACK_X1 - LINEAR_TRACK_X0));
}

// Lanes compress rather than overflow the fixed viewBox on densely annotated
// records.
function linearLaneMetrics(laneCount) {
  const available = LINEAR_AXIS_Y - LINEAR_FIRST_BAND_GAP - LINEAR_TOP_MARGIN;
  const naturalStep = LINEAR_BAND_HEIGHT + LINEAR_LANE_GAP;
  const step = Math.max(6, Math.min(naturalStep, available / Math.max(1, laneCount)));
  return { step, bandHeight: Math.max(4, step - LINEAR_LANE_GAP) };
}

function buildLinearBandPath(x1, x2, top, bottom, strand) {
  const width = Math.max(LINEAR_MIN_SPAN_PX, x2 - x1);
  const right = x1 + width;
  const mid = (top + bottom) / 2;
  const tip = Math.min(8, width / 2);

  if (strand === -1) {
    return `M ${fixed(right)} ${fixed(top)} L ${fixed(x1 + tip)} ${fixed(top)} L ${fixed(x1)} ${fixed(mid)} L ${fixed(x1 + tip)} ${fixed(bottom)} L ${fixed(right)} ${fixed(bottom)} Z`;
  }
  if (strand === 1) {
    return `M ${fixed(x1)} ${fixed(top)} L ${fixed(right - tip)} ${fixed(top)} L ${fixed(right)} ${fixed(mid)} L ${fixed(right - tip)} ${fixed(bottom)} L ${fixed(x1)} ${fixed(bottom)} Z`;
  }
  return `M ${fixed(x1)} ${fixed(top)} L ${fixed(right)} ${fixed(top)} L ${fixed(right)} ${fixed(bottom)} L ${fixed(x1)} ${fixed(bottom)} Z`;
}

function renderLinearTicks(sequenceLength) {
  const marks = [];
  for (let index = 0; index <= TICK_COUNT; index += 1) {
    const base = Math.round((sequenceLength * index) / TICK_COUNT);
    const x = linearX(base, sequenceLength);
    marks.push(`
      <line class="vector-map__tick" x1="${fixed(x)}" y1="${LINEAR_AXIS_Y}" x2="${fixed(x)}" y2="${LINEAR_AXIS_Y + 8}"></line>
      <text class="vector-map__tick-label" x="${fixed(x)}" y="${LINEAR_AXIS_Y + 22}" text-anchor="middle" dominant-baseline="middle">${Math.min(sequenceLength, base + 1).toLocaleString()}</text>
    `);
  }
  return marks.join('');
}

// The range marker rides on the axis, the way the circular map's marker rides
// on the backbone ring. Spanning the full track height instead would box the
// features in and read as a selection box drawn around them.
function renderLinearSelection(selection, sequenceLength) {
  if (!selection) {
    return '';
  }
  const start = Math.max(0, Number(selection.start) || 0);
  const end = Math.min(sequenceLength, Number(selection.end) || 0);
  const x1 = linearX(start, sequenceLength);

  if (end <= start) {
    return `<line class="vector-map__caret" x1="${fixed(x1)}" y1="${LINEAR_AXIS_Y - 16}" x2="${fixed(x1)}" y2="${LINEAR_AXIS_Y + 8}"></line>`;
  }
  const x2 = linearX(end, sequenceLength);
  return `<rect class="vector-map__selection" x="${fixed(x1)}" y="${LINEAR_AXIS_Y - 7}" width="${fixed(Math.max(2, x2 - x1))}" height="14"></rect>`;
}

// Above-bar names are laid out left to right and bumped up a row whenever they
// would run into the previous one, so short adjacent features stay readable
// instead of overprinting each other.
function layoutAboveBarLabels(entries) {
  const rowRightEdges = new Array(LINEAR_ABOVE_BAR_ROWS).fill(Number.NEGATIVE_INFINITY);
  entries
    .filter((entry) => !entry.onBar)
    .sort((left, right) => left.x - right.x)
    .forEach((entry) => {
      const left = entry.x - entry.halfWidth;
      let row = rowRightEdges.findIndex((edge) => left >= edge);
      if (row < 0) {
        // Every row is occupied at this x; take the one that clears soonest.
        row = rowRightEdges.indexOf(Math.min(...rowRightEdges));
      }
      rowRightEdges[row] = entry.x + entry.halfWidth;
      entry.y = entry.top - 5 - (row * LINEAR_ABOVE_BAR_ROW_HEIGHT);
    });
}

function buildLinearMapSvg(record, options = {}) {
  const sequenceLength = Math.max(1, Number(record?.sequence?.length) || 0);
  const features = Array.isArray(options?.features) ? options.features : [];
  const selectedIndex = Number.isFinite(Number(options?.selectedFeatureIndex))
    ? Number(options.selectedFeatureIndex)
    : -1;
  const laidOut = assignFeatureLanes(features).map((feature, index) => describeFeature(feature, index, sequenceLength));
  const laneCount = Math.max(1, laidOut.reduce((max, feature) => Math.max(max, feature.lane + 1), 1));
  const { step, bandHeight } = linearLaneMetrics(laneCount);
  const laneTop = (lane) => LINEAR_AXIS_Y - LINEAR_FIRST_BAND_GAP - bandHeight - (lane * step);

  const bandMarkup = [];
  const labelMarkup = [];
  const labelEntries = [];

  laidOut.forEach((feature) => {
    const top = laneTop(feature.lane);
    const bottom = top + bandHeight;
    const mid = (top + bottom) / 2;
    const activeClass = feature.index === selectedIndex ? ' vector-map__feature--active' : '';

    // Dashed connectors bridge joined segments so a spliced feature reads as one.
    for (let seg = 0; seg < feature.segments.length - 1; seg += 1) {
      const gapStart = linearX(feature.segments[seg].end, sequenceLength);
      const gapEnd = linearX(feature.segments[seg + 1].start, sequenceLength);
      if (gapEnd - gapStart > 0.5) {
        bandMarkup.push(`<line class="vector-map__intron" x1="${fixed(gapStart)}" y1="${fixed(mid)}" x2="${fixed(gapEnd)}" y2="${fixed(mid)}" stroke="${feature.color}"></line>`);
      }
    }

    feature.segments.forEach((segment) => {
      bandMarkup.push(`
        <path
          class="vector-map__feature${activeClass}"
          data-feature-index="${feature.index}"
          tabindex="0"
          role="button"
          d="${buildLinearBandPath(linearX(segment.start, sequenceLength), linearX(segment.end, sequenceLength), top, bottom, feature.strand)}"
          fill="${feature.color}"
          aria-label="${escapeHtml(feature.title)}"
        ></path>
      `);
    });

    const range = getFeatureOverallRange(feature, sequenceLength);
    if (!range) {
      return;
    }
    // An on-bar label has to sit on an actual segment: centring across a spliced
    // feature's whole range drops the on-bar text into the intron gap, where it
    // is invisible. Measure the widest single segment instead.
    const widest = feature.segments.reduce((best, segment) => {
      const segmentX1 = linearX(segment.start, sequenceLength);
      const segmentX2 = linearX(segment.end, sequenceLength);
      const width = segmentX2 - segmentX1;
      return (!best || width > best.width)
        ? { width, centre: (segmentX1 + segmentX2) / 2 }
        : best;
    }, null);
    const fitsOnBar = Boolean(widest)
      && widest.width >= ((feature.name.length * LINEAR_ON_BAR_CHAR_PX) + 10)
      && bandHeight >= 12;

    if (fitsOnBar) {
      labelEntries.push({ feature, onBar: true, x: widest.centre, y: mid });
      return;
    }
    labelEntries.push({
      feature,
      onBar: false,
      x: Math.min(
        Math.max((linearX(range.start, sequenceLength) + linearX(range.end, sequenceLength)) / 2, LINEAR_TRACK_X0),
        LINEAR_TRACK_X1
      ),
      top,
      halfWidth: ((feature.name.length * LINEAR_ABOVE_BAR_CHAR_PX) / 2) + 3
    });
  });

  layoutAboveBarLabels(labelEntries);
  labelEntries.forEach((entry) => {
    const activeClass = entry.feature.index === selectedIndex ? ' vector-map__label--active' : '';
    labelMarkup.push(`
      <g class="vector-map__label${activeClass}" data-feature-index="${entry.feature.index}" tabindex="0" role="button" aria-label="${escapeHtml(entry.feature.title)}">
        <text
          class="vector-map__label-text${entry.onBar ? ' vector-map__label-text--on-bar' : ''}"
          x="${fixed(entry.x)}"
          y="${fixed(entry.y)}"
          text-anchor="middle"
          dominant-baseline="${entry.onBar ? 'middle' : 'auto'}"
          fill="${entry.onBar ? getContrastTextColor(entry.feature.color) : entry.feature.color}"
        >${escapeHtml(entry.feature.name)}</text>
      </g>
    `);
  });

  const name = String(record?.name || 'Sequence');
  return `
    <svg
      class="vector-map vector-map--linear"
      data-map-kind="linear"
      viewBox="0 0 ${LINEAR_VIEWBOX_WIDTH} ${LINEAR_VIEWBOX_HEIGHT}"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="${escapeHtml(`${name} linear sequence map`)}"
    >
      <text class="vector-map__title" x="${LINEAR_VIEWBOX_WIDTH / 2}" y="20" text-anchor="middle">${escapeHtml(name)}</text>
      <text class="vector-map__subtitle" x="${LINEAR_VIEWBOX_WIDTH / 2}" y="${LINEAR_AXIS_Y + 46}" text-anchor="middle">${sequenceLength.toLocaleString()} bp linear</text>
      ${renderLinearSelection(options?.selection, sequenceLength)}
      <line class="vector-map__backbone" x1="${LINEAR_TRACK_X0}" y1="${LINEAR_AXIS_Y}" x2="${LINEAR_TRACK_X1}" y2="${LINEAR_AXIS_Y}"></line>
      ${renderLinearTicks(sequenceLength)}
      ${bandMarkup.join('')}
      ${labelMarkup.join('')}
    </svg>
  `;
}

// ================================ shared =====================================

/**
 * Convert a pointer position over a rendered map into a base offset.
 * Pure geometry (takes a rect, not an element) so it is testable without a DOM
 * and independent of how the SVG was mounted -- including at any zoom or scroll
 * offset, since the rect reflects both and the viewBox never changes.
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
