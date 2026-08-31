import { escapeHtml } from '../../../../lib/html.js';
import { featureLabelBase, fixed, partitionFeatures, polar, primerAnchors } from './geometry.js';
import { CIRCULAR_VIEWBOX_MIN, CIRCULAR_VIEWBOX_SIZE, LABEL_COLUMN_X, LABEL_LINE_HEIGHT, LABEL_PAD, MIN_ARC_FRACTION, PRIMER_HEAD_PX, PRIMER_MIN_SPAN_PX, PRIMER_RING_GAP, RADIUS, RING_GAP, RING_WIDTH, TAU, TICK_COUNT } from './map-constants.js';

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

// Plan B glyph: hairline shaft with a barbed half-head, so it reads as an oligo
// rather than a region. Shaft runs to the head's base so the two never separate.
function buildCircularPrimerGlyph(primer, radius, sequenceLength, isActive) {
  const minSpan = (PRIMER_MIN_SPAN_PX * sequenceLength) / (TAU * radius);
  const anchors = primerAnchors(primer, minSpan);
  if (!anchors) {
    return '';
  }
  const { tail, lead } = anchors;
  const from = Math.min(tail, lead);
  const to = Math.max(tail, lead);
  const largeArc = (to - from) / sequenceLength > 0.5 ? 1 : 0;
  const start = polar(radius, from, sequenceLength);
  const end = polar(radius, to, sequenceLength);

  const point = polar(radius, lead, sequenceLength);
  const theta = (TAU * lead) / sequenceLength;
  const tangent = { x: Math.cos(theta), y: Math.sin(theta) };
  const radial = { x: Math.sin(theta), y: -Math.cos(theta) };
  const direction = primer.strand === -1 ? -1 : 1;
  const tip = {
    x: point.x + (tangent.x * PRIMER_HEAD_PX * direction),
    y: point.y + (tangent.y * PRIMER_HEAD_PX * direction)
  };
  const barb = {
    x: point.x + (radial.x * PRIMER_HEAD_PX * 0.58),
    y: point.y + (radial.y * PRIMER_HEAD_PX * 0.58)
  };

  return `
    <g class="vector-map__primer${isActive ? ' vector-map__primer--active' : ''}" data-feature-index="${primer.index}" tabindex="0" role="button" aria-label="${escapeHtml(primer.title)}">
      <path class="vector-map__primer-shaft" d="M ${fixed(start.x)} ${fixed(start.y)} A ${fixed(radius)} ${fixed(radius)} 0 ${largeArc} 1 ${fixed(end.x)} ${fixed(end.y)}" fill="none" stroke="${primer.color}"></path>
      <path class="vector-map__primer-head" d="M ${fixed(tip.x)} ${fixed(tip.y)} L ${fixed(barb.x)} ${fixed(barb.y)} L ${fixed(point.x)} ${fixed(point.y)} Z" fill="${primer.color}"></path>
    </g>
  `;
}

function buildCircularMapSvg(record, options = {}) {
  const sequenceLength = Math.max(1, Number(record?.sequence?.length) || 0);
  const features = Array.isArray(options?.features) ? options.features : [];
  const selectedIndex = Number.isFinite(Number(options?.selectedFeatureIndex))
    ? Number(options.selectedFeatureIndex)
    : -1;
  const { laidOut, primers } = partitionFeatures(features, sequenceLength);
  const laneCount = Math.max(1, laidOut.reduce((max, feature) => Math.max(max, feature.lane + 1), 1));
  const primerRadius = RADIUS + RING_GAP + (laneCount * (RING_WIDTH + 5)) + PRIMER_RING_GAP;

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

    const labelBase = featureLabelBase(feature, sequenceLength);
    if (labelBase === null) {
      return;
    }
    const anchor = polar(outerRadius + 6, labelBase, sequenceLength);
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

  primers.forEach((primer) => {
    arcMarkup.push(buildCircularPrimerGlyph(primer, primerRadius, sequenceLength, primer.index === selectedIndex));
    const anchors = primerAnchors(primer, (PRIMER_MIN_SPAN_PX * sequenceLength) / (TAU * primerRadius));
    if (!anchors) {
      return;
    }
    const anchor = polar(primerRadius + 4, (anchors.tail + anchors.lead) / 2, sequenceLength);
    labelEntries.push({
      index: primer.index,
      color: primer.color,
      title: primer.title,
      name: primer.name,
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

export {
  buildCircularMapSvg
};
