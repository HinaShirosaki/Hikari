import { escapeHtml } from '../../../../lib/html.js';
import { getContrastTextColor } from '../../feature-model.js';
import { fixed, partitionFeatures, primerAnchors } from './geometry.js';
import { LINEAR_ABOVE_BAR_CHAR_PX, LINEAR_ABOVE_BAR_ROWS, LINEAR_ABOVE_BAR_ROW_HEIGHT, LINEAR_AXIS_Y, LINEAR_BAND_HEIGHT, LINEAR_FIRST_BAND_GAP, LINEAR_LANE_GAP, LINEAR_MIN_SPAN_PX, LINEAR_ON_BAR_CHAR_PX, LINEAR_PRIMER_HEAD_PX, LINEAR_PRIMER_MIN_SPAN_PX, LINEAR_PRIMER_ROW_OFFSET, LINEAR_TOP_MARGIN, LINEAR_TRACK_X0, LINEAR_TRACK_X1, LINEAR_VIEWBOX_HEIGHT, LINEAR_VIEWBOX_WIDTH, TICK_COUNT } from './map-constants.js';

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

// Linear counterpart of the Plan B glyph: a hairline on its own row just above
// the axis, with the same barbed half-head.
function buildLinearPrimerGlyph(primer, sequenceLength, y, isActive) {
  const minSpan = (LINEAR_PRIMER_MIN_SPAN_PX * sequenceLength) / (LINEAR_TRACK_X1 - LINEAR_TRACK_X0);
  const anchors = primerAnchors(primer, minSpan);
  if (!anchors) {
    return null;
  }
  const tailX = linearX(anchors.tail, sequenceLength);
  const leadX = linearX(anchors.lead, sequenceLength);
  const direction = primer.strand === -1 ? -1 : 1;
  const tipX = leadX + (LINEAR_PRIMER_HEAD_PX * direction);
  return {
    markup: `
      <g class="vector-map__primer${isActive ? ' vector-map__primer--active' : ''}" data-feature-index="${primer.index}" tabindex="0" role="button" aria-label="${escapeHtml(primer.title)}">
        <line class="vector-map__primer-shaft" x1="${fixed(tailX)}" y1="${fixed(y)}" x2="${fixed(leadX)}" y2="${fixed(y)}" stroke="${primer.color}"></line>
        <path class="vector-map__primer-head" d="M ${fixed(tipX)} ${fixed(y)} L ${fixed(leadX)} ${fixed(y - (LINEAR_PRIMER_HEAD_PX * 0.58))} L ${fixed(leadX)} ${fixed(y)} Z" fill="${primer.color}"></path>
      </g>
    `,
    centre: (tailX + leadX) / 2
  };
}

function buildLinearMapSvg(record, options = {}) {
  const sequenceLength = Math.max(1, Number(record?.sequence?.length) || 0);
  const features = Array.isArray(options?.features) ? options.features : [];
  const selectedIndex = Number.isFinite(Number(options?.selectedFeatureIndex))
    ? Number(options.selectedFeatureIndex)
    : -1;
  const { laidOut, primers } = partitionFeatures(features, sequenceLength);
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

    // A label has to sit on an actual segment: centring across a spliced
    // feature's whole range drops the text into the intron gap, and an
    // origin-crossing feature's range spans the whole record, which parks its
    // label mid-map with no band under it. Measure the widest single segment.
    const widest = feature.segments.reduce((best, segment) => {
      const segmentX1 = linearX(segment.start, sequenceLength);
      const segmentX2 = linearX(segment.end, sequenceLength);
      const width = segmentX2 - segmentX1;
      return (!best || width > best.width)
        ? { width, centre: (segmentX1 + segmentX2) / 2 }
        : best;
    }, null);
    if (!widest) {
      return;
    }
    const fitsOnBar = widest.width >= ((feature.name.length * LINEAR_ON_BAR_CHAR_PX) + 10)
      && bandHeight >= 12;

    if (fitsOnBar) {
      labelEntries.push({ feature, onBar: true, x: widest.centre, y: mid });
      return;
    }
    labelEntries.push({
      feature,
      onBar: false,
      x: Math.min(Math.max(widest.centre, LINEAR_TRACK_X0), LINEAR_TRACK_X1),
      top,
      halfWidth: ((feature.name.length * LINEAR_ABOVE_BAR_CHAR_PX) / 2) + 3
    });
  });

  const primerRowY = LINEAR_AXIS_Y - LINEAR_PRIMER_ROW_OFFSET;
  primers.forEach((primer) => {
    const glyph = buildLinearPrimerGlyph(primer, sequenceLength, primerRowY, primer.index === selectedIndex);
    if (!glyph) {
      return;
    }
    bandMarkup.push(glyph.markup);
    labelEntries.push({
      feature: primer,
      onBar: false,
      x: Math.min(Math.max(glyph.centre, LINEAR_TRACK_X0), LINEAR_TRACK_X1),
      // the barb rises above the row, so the label needs clearance over it
      top: primerRowY - LINEAR_PRIMER_HEAD_PX,
      halfWidth: ((primer.name.length * LINEAR_ABOVE_BAR_CHAR_PX) / 2) + 3
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

export {
  buildLinearMapSvg
};
