import { escapeHtml } from './common.js';

const PLANNOTATE_TYPE_STYLES = {
  rep_origin: { fillColor: '#4e7fff', lineColor: '#000000' },
  origin_of_replication: { fillColor: '#4e7fff', lineColor: '#000000' },
  promoter: { fillColor: '#f6a35e', lineColor: '#000000' },
  cds: { fillColor: '#479f71', lineColor: '#000000' },
  misc_feature: { fillColor: '#808080', lineColor: '#000000' },
  primer_bind: { fillColor: '#ffffff', lineColor: '#000000' },
  terminator: { fillColor: '#c97064', lineColor: '#000000' },
  ncrna: { fillColor: '#e8dab2', lineColor: '#000000' },
  rna: { fillColor: '#e8dab2', lineColor: '#000000' }
};

const PLANNOTATE_FALLBACK_COLORS = [
  '#4e7fff',
  '#f6a35e',
  '#479f71',
  '#808080',
  '#c97064',
  '#e8dab2',
  '#8eb6ff',
  '#a3b1bf',
  '#8dc5a5',
  '#f1c086'
];

const PLANNOTATE_ORIENTED_TYPES = new Set([
  'cds',
  'exon',
  'gene',
  'intron',
  'mat_peptide',
  'mobile_element',
  'mrna',
  'ncrna',
  'orit',
  'polya_site',
  'protein_bind',
  'promoter',
  '35_signal',
  '10_signal',
  'rbs',
  'terminator',
  'trna',
  'swissprot',
  'origin_of_replication'
]);

function normalizePlannotateType(type) {
  return String(type || 'misc_feature')
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function hashString(value) {
  let hash = 0;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getPlannotateTypeStyle(type, fragment = false) {
  const normalized = normalizePlannotateType(type);
  const baseStyle = PLANNOTATE_TYPE_STYLES[normalized] || {
    fillColor: PLANNOTATE_FALLBACK_COLORS[hashString(normalized) % PLANNOTATE_FALLBACK_COLORS.length],
    lineColor: '#000000'
  };

  if (!fragment) {
    return baseStyle;
  }

  return {
    fillColor: '#ffffff',
    lineColor: baseStyle.fillColor === '#ffffff' ? baseStyle.lineColor : baseStyle.fillColor
  };
}

function getPlannotateTypeColor(type) {
  return getPlannotateTypeStyle(type, false).fillColor;
}

function hasPlannotateOrientation(type) {
  return PLANNOTATE_ORIENTED_TYPES.has(normalizePlannotateType(type));
}

export function getPlannotateSegments(hit, sequenceLength, topology = 'circular') {
  if (!sequenceLength) {
    return [];
  }

  const qstart = Math.max(0, Math.min(sequenceLength, Number(hit.qstart) || 0));
  const qendRaw = Number(hit.qend);
  const qend = qendRaw === 0
    ? sequenceLength
    : Math.max(0, Math.min(sequenceLength, qendRaw || 0));

  if (topology === 'linear') {
    const left = Math.min(qstart, qend);
    const right = Math.max(qstart, qend);
    return right > left ? [{ start: left, end: right }] : [];
  }

  const wrapsOrigin = Boolean(hit.crossesOrigin) || qend < qstart;
  if (!wrapsOrigin) {
    return qend > qstart ? [{ start: qstart, end: qend }] : [];
  }

  const segments = [];
  if (sequenceLength > qstart) {
    segments.push({ start: qstart, end: sequenceLength });
  }
  if (qend > 0) {
    segments.push({ start: 0, end: qend });
  }

  if (!segments.length && qstart === 0 && qend === 0) {
    segments.push({ start: 0, end: sequenceLength });
  }

  return segments;
}

export function formatPlannotateLocation(hit, sequenceLength) {
  const start = hit.qstart + 1;
  const end = hit.qend === 0 ? sequenceLength : hit.qend;
  if (!hit.crossesOrigin) {
    return `${start}..${end}`;
  }
  return `${start}..${sequenceLength}, 1..${end}`;
}

function formatPlannotateHoverInfo(hit, sequenceLength) {
  const location = formatPlannotateLocation(hit, sequenceLength);
  const strand = hit.sframe === -1 ? '-' : '+';
  const identity = Number.isFinite(hit.pident) ? `${hit.pident.toFixed(2)}%` : 'n/a';
  const coverage = Number.isFinite(hit.percmatch) ? `${hit.percmatch.toFixed(2)}%` : 'n/a';
  return `${hit.Feature} | ${hit.Type} | ${location} | Strand ${strand} | Identity ${identity} | Coverage ${coverage}`;
}

function ratioToCircularAngle(ratio) {
  return (ratio * Math.PI * 2) - (Math.PI / 2);
}

function polarPoint(cx, cy, radius, theta) {
  return {
    x: cx + (radius * Math.cos(theta)),
    y: cy + (radius * Math.sin(theta))
  };
}

function makePlannotateDonutSegmentPath(cx, cy, innerRadius, outerRadius, startRatio, endRatio) {
  if (endRatio <= startRatio) {
    return '';
  }

  const twoPi = Math.PI * 2;
  const startAngle = ratioToCircularAngle(startRatio);
  let delta = (endRatio - startRatio) * twoPi;
  if (delta >= twoPi) {
    delta = twoPi - 1e-4;
  }
  const endAngle = startAngle + delta;
  const largeArcFlag = delta > Math.PI ? 1 : 0;

  const outerStart = polarPoint(cx, cy, outerRadius, startAngle);
  const outerEnd = polarPoint(cx, cy, outerRadius, endAngle);
  const innerStart = polarPoint(cx, cy, innerRadius, startAngle);
  const innerEnd = polarPoint(cx, cy, innerRadius, endAngle);

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerRadius.toFixed(2)} ${outerRadius.toFixed(2)} 0 ${largeArcFlag} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerRadius.toFixed(2)} ${innerRadius.toFixed(2)} 0 ${largeArcFlag} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z'
  ].join(' ');
}

function makePlannotateLabelAnchor(theta) {
  const x = Math.cos(theta);
  const y = Math.sin(theta);
  if (x > 0.35) {
    return { anchor: 'start', dy: 4 };
  }
  if (x < -0.35) {
    return { anchor: 'end', dy: 4 };
  }
  return { anchor: 'middle', dy: y > 0 ? 14 : -6 };
}

function shortenPlannotateLabel(text, maxLength = 26) {
  const clean = String(text || '').trim();
  if (clean.length <= maxLength) {
    return clean;
  }
  if (maxLength <= 3) {
    return clean.slice(0, maxLength);
  }
  return `${clean.slice(0, maxLength - 3)}...`;
}

function assignPlannotateCircularLevels(hits, sequenceLength) {
  const records = hits
    .map((hit) => ({
      hit,
      segments: getPlannotateSegments(hit, sequenceLength, 'circular')
        .filter((segment) => segment.end > segment.start)
        .sort((a, b) => a.start - b.start)
    }))
    .filter((item) => item.segments.length)
    .sort((a, b) => {
      if (a.segments[0].start !== b.segments[0].start) {
        return a.segments[0].start - b.segments[0].start;
      }
      const aLen = a.segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
      const bLen = b.segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
      return bLen - aLen;
    });

  const levelIntervals = [];
  records.forEach((record) => {
    let level = 0;
    while (true) {
      if (!levelIntervals[level]) {
        levelIntervals[level] = [];
        break;
      }
      const overlaps = record.segments.some((segment) => levelIntervals[level].some((existing) => (
        segment.start < existing.end && existing.start < segment.end
      )));
      if (!overlaps) {
        break;
      }
      level += 1;
    }

    record.level = level;
    levelIntervals[level].push(...record.segments.map((segment) => ({ ...segment })));
  });

  return records;
}

function computePlannotateTickValues(sequenceLength) {
  const approxChunk = Math.round((Math.floor(sequenceLength / 5) / 500)) * 500;
  const chunkSize = approxChunk > 0 ? approxChunk : 500;
  const ticks = [];
  for (let bp = 0; bp < sequenceLength - (chunkSize / 2); bp += chunkSize) {
    ticks.push(bp === 0 ? 1 : bp);
  }
  return ticks;
}

export function renderPlannotateCircularMap(result) {
  const sequenceLength = result.sequenceLength;
  const hits = result.hits || [];
  if (!sequenceLength || !hits.length) {
    return '';
  }

  const cx = 400;
  const cy = 400;
  const backboneRadius = 205;
  const featureHalfThickness = 17;
  const levelStep = 40;
  const tickValues = computePlannotateTickValues(sequenceLength);
  const records = assignPlannotateCircularLevels(hits, sequenceLength);

  const ticks = tickValues.map((bp) => {
    const ratio = bp / sequenceLength;
    const theta = ratioToCircularAngle(ratio);
    const lineStart = polarPoint(cx, cy, backboneRadius - 6, theta);
    const lineEnd = polarPoint(cx, cy, backboneRadius - 22, theta);
    const labelPoint = polarPoint(cx, cy, backboneRadius - 40, theta);
    const anchor = makePlannotateLabelAnchor(theta);
    return `
      <line x1="${lineStart.x.toFixed(2)}" y1="${lineStart.y.toFixed(2)}" x2="${lineEnd.x.toFixed(2)}" y2="${lineEnd.y.toFixed(2)}" />
      <text x="${labelPoint.x.toFixed(2)}" y="${(labelPoint.y + anchor.dy).toFixed(2)}" text-anchor="${anchor.anchor}">${bp.toLocaleString()}</text>
    `;
  }).join('');

  const featurePaths = [];
  const connectorLines = [];
  const labels = [];

  records.forEach((record) => {
    const { hit, segments, level } = record;
    const style = getPlannotateTypeStyle(hit.Type, Boolean(hit.fragment));
    const title = escapeHtml(`${hit.Feature} (${formatPlannotateLocation(hit, sequenceLength)})`);
    const hoverInfo = escapeHtml(formatPlannotateHoverInfo(hit, sequenceLength));
    const levelRadius = backboneRadius + (level * levelStep);
    const innerRadius = Math.max(10, levelRadius - featureHalfThickness);
    const outerRadius = levelRadius + featureHalfThickness;

    segments.forEach((segment) => {
      const startRatio = segment.start / sequenceLength;
      const endRatio = segment.end / sequenceLength;
      const path = makePlannotateDonutSegmentPath(cx, cy, innerRadius, outerRadius, startRatio, endRatio);
      if (!path) {
        return;
      }
      featurePaths.push(`
        <path
          class="plannotate-circular-hit plannotate-hover-target"
          data-hit-info="${hoverInfo}"
          d="${path}"
          fill="${style.fillColor}"
          stroke="${style.lineColor}"
          stroke-width="2.4"
          stroke-linejoin="round"
        >
          <title>${title}</title>
        </path>
      `);
    });

    const mainSegment = [...segments].sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    if (!mainSegment) {
      return;
    }

    const midBp = (mainSegment.start + mainSegment.end) / 2;
    const midTheta = ratioToCircularAngle(midBp / sequenceLength);
    const lineStart = polarPoint(cx, cy, outerRadius, midTheta);
    const lineEnd = polarPoint(cx, cy, outerRadius + 30, midTheta);
    const textPoint = polarPoint(cx, cy, outerRadius + 36, midTheta);
    const textAnchor = makePlannotateLabelAnchor(midTheta);
    const labelColor = style.fillColor === '#ffffff' ? style.lineColor : style.fillColor;
    const labelText = escapeHtml(shortenPlannotateLabel(hit.Feature || 'feature'));

    connectorLines.push(`
      <line
        x1="${lineStart.x.toFixed(2)}"
        y1="${lineStart.y.toFixed(2)}"
        x2="${lineEnd.x.toFixed(2)}"
        y2="${lineEnd.y.toFixed(2)}"
        stroke="${labelColor}"
      />
    `);

    labels.push(`
      <text
        class="plannotate-hover-target"
        data-hit-info="${hoverInfo}"
        x="${textPoint.x.toFixed(2)}"
        y="${(textPoint.y + textAnchor.dy).toFixed(2)}"
        text-anchor="${textAnchor.anchor}"
        fill="${labelColor}"
      >${labelText}</text>
    `);

    if (hasPlannotateOrientation(hit.Type)) {
      const forward = Number(hit.sframe) !== -1;
      const tipBp = forward ? mainSegment.end : mainSegment.start;
      const tipTheta = ratioToCircularAngle(tipBp / sequenceLength);
      const offset = forward ? -0.11 : 0.11;
      const tip = polarPoint(cx, cy, levelRadius, tipTheta);
      const baseOuter = polarPoint(cx, cy, outerRadius + 1.5, tipTheta + offset);
      const baseInner = polarPoint(cx, cy, innerRadius - 1.5, tipTheta + offset);
      featurePaths.push(`
        <path
          class="plannotate-circular-hit plannotate-hover-target"
          data-hit-info="${hoverInfo}"
          d="M ${baseOuter.x.toFixed(2)} ${baseOuter.y.toFixed(2)} L ${tip.x.toFixed(2)} ${tip.y.toFixed(2)} L ${baseInner.x.toFixed(2)} ${baseInner.y.toFixed(2)} Z"
          fill="${style.fillColor}"
          stroke="${style.lineColor}"
          stroke-width="2.1"
          stroke-linejoin="round"
        >
          <title>${title}</title>
        </path>
      `);
    }
  });

  return `
    <div class="plannotate-map-shell">
      <div class="plannotate-panzoom-viewport" data-panzoom="true">
        <div class="plannotate-panzoom-content">
          <svg class="plannotate-circular-map" viewBox="0 0 800 800" role="img" aria-label="Circular plasmid map">
            <circle class="plannotate-circular-backdrop" cx="${cx}" cy="${cy}" r="${backboneRadius}" />
            <g class="plannotate-circular-axis">${ticks}</g>
            <g class="plannotate-circular-features">${featurePaths.join('')}</g>
            <g class="plannotate-circular-connectors">${connectorLines.join('')}</g>
            <g class="plannotate-circular-labels plannotate-hover-target">${labels.join('')}</g>
            <text class="plannotate-circular-center" x="${cx}" y="${cy - 6}">${sequenceLength.toLocaleString()} bp</text>
            <text class="plannotate-circular-center-sub" x="${cx}" y="${cy + 18}">${hits.length} features</text>
          </svg>
        </div>
      </div>
    </div>
  `;
}

export function renderPlannotateLinearMap(result) {
  const sequenceLength = result.sequenceLength;
  const hits = result.hits || [];
  if (!sequenceLength || !hits.length) {
    return '';
  }

  const sorted = hits
    .map((hit) => ({
      hit,
      segments: getPlannotateSegments(hit, sequenceLength, 'linear')
    }))
    .filter((item) => item.segments.length)
    .sort((a, b) => a.segments[0].start - b.segments[0].start);

  const lanes = [];
  sorted.forEach((item) => {
    const firstSegment = item.segments[0];
    let laneIndex = lanes.findIndex((lane) => firstSegment.start >= lane);
    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push(firstSegment.end);
    } else {
      lanes[laneIndex] = firstSegment.end;
    }
    item.laneIndex = laneIndex;
  });

  const laneCount = Math.max(1, lanes.length);
  const laneHeightPx = 22;
  const railHeight = Math.max(32, (laneCount * laneHeightPx) + 10);
  const laneLabels = [0, 0.25, 0.5, 0.75, 1].map((ratio) => `
    <span style="left:${(ratio * 100).toFixed(2)}%">${Math.round(sequenceLength * ratio).toLocaleString()}</span>
  `).join('');

  const bars = sorted.map((item) => {
    const style = getPlannotateTypeStyle(item.hit.Type, Boolean(item.hit.fragment));
    const rowTop = 6 + (item.laneIndex * laneHeightPx);
    const title = escapeHtml(`${item.hit.Feature} (${formatPlannotateLocation(item.hit, sequenceLength)})`);
    const hoverInfo = escapeHtml(formatPlannotateHoverInfo(item.hit, sequenceLength));
    return item.segments.map((segment) => {
      const left = (segment.start / sequenceLength) * 100;
      const width = Math.max(0.35, ((segment.end - segment.start) / sequenceLength) * 100);
      return `
        <span
          class="plannotate-linear-hit plannotate-hover-target"
          style="left:${left.toFixed(4)}%;width:${width.toFixed(4)}%;top:${rowTop}px;background:${style.fillColor};border:2px solid ${style.lineColor};"
          title="${title}"
          data-hit-info="${hoverInfo}"
        ></span>
      `;
    }).join('');
  }).join('');

  return `
    <div class="plannotate-map-shell">
      <div class="plannotate-panzoom-viewport" data-panzoom="true">
        <div class="plannotate-panzoom-content">
          <div class="plannotate-linear-map" style="height:${railHeight}px;">
            <div class="plannotate-linear-track">${bars}</div>
          </div>
          <div class="plannotate-linear-axis">${laneLabels}</div>
        </div>
      </div>
    </div>
  `;
}

export function renderPlannotateLegend(hits) {
  const counts = new Map();
  hits.forEach((hit) => {
    const type = String(hit.Type || 'misc_feature');
    counts.set(type, (counts.get(type) || 0) + 1);
  });

  if (!counts.size) {
    return '';
  }

  const items = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `
      <span class="plannotate-legend-item">
        <span class="plannotate-legend-swatch" style="background:${getPlannotateTypeColor(type)};"></span>
        ${escapeHtml(type)} (${count})
      </span>
    `)
    .join('');

  return `<div class="plannotate-legend">${items}</div>`;
}

export function sanitizePlannotateRecordName(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 16);
  return cleaned || 'plasmid';
}

export function buildPlannotateSequenceViewerPayload(result, recordName) {
  const sequence = String(result?.sequence || '');
  const sequenceLength = Number(result?.sequenceLength) || sequence.length;
  const topology = result?.topology === 'linear' ? 'linear' : 'circular';
  const hits = Array.isArray(result?.hits) ? result.hits : [];

  const features = hits.map((hit, index) => ({
    id: `plannotate_${index + 1}`,
    name: String(hit.Feature || `feature_${index + 1}`),
    type: String(hit.Type || 'misc_feature'),
    strand: hit.sframe === -1 ? -1 : 1,
    description: String(hit.Description || ''),
    source: 'plannotate',
    location: formatPlannotateLocation(hit, sequenceLength),
    identity: Number.isFinite(hit.pident) ? Number(hit.pident) : null,
    coverage: Number.isFinite(hit.percmatch) ? Number(hit.percmatch) : null,
    mode: String(hit.matchMode || ''),
    segments: getPlannotateSegments(hit, sequenceLength, topology)
  }));

  return {
    name: sanitizePlannotateRecordName(recordName || 'plasmid'),
    sequence,
    topology,
    source: 'plannotate',
    features
  };
}
