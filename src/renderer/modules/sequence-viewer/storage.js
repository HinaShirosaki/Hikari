import { escapeHtml } from '../tool-box/common.js';
import {
  assignFeatureLanes,
  buildFeatureLocationText,
  hashTypeToColor
} from './feature-model.js';
import {
  clamp,
  normalizeRecordName,
  normalizeSequenceText,
  normalizeTopology
} from './shared.js';

export function readStoragePathFromLocalState() {
  try {
    const raw = globalThis?.localStorage?.getItem?.('enana_state_v1');
    if (!raw) {
      return '';
    }
    const parsed = JSON.parse(raw);
    return String(parsed?.settings?.storagePath || '').trim();
  } catch {
    return '';
  }
}

function toGenbankDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const normalized = Number.isFinite(date.getTime()) ? date : new Date();
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const day = String(normalized.getDate()).padStart(2, '0');
  const month = months[normalized.getMonth()] || 'JAN';
  const year = String(normalized.getFullYear());
  return `${day}-${month}-${year}`;
}

function wrapGenbankLine(value, firstPrefix, continuationPrefix = firstPrefix, width = 80) {
  const text = String(value ?? '');
  if (!text.length) {
    return [firstPrefix];
  }

  const lines = [];
  let remaining = text;
  let prefix = firstPrefix;

  while (remaining.length) {
    const available = Math.max(1, width - prefix.length);
    if (remaining.length <= available) {
      lines.push(`${prefix}${remaining}`);
      break;
    }

    let splitAt = remaining.lastIndexOf(' ', available);
    if (splitAt <= 0 || splitAt < Math.floor(available * 0.35)) {
      splitAt = available;
    }

    const chunk = remaining.slice(0, splitAt);
    lines.push(`${prefix}${chunk}`);
    remaining = remaining.slice(splitAt).trimStart();
    prefix = continuationPrefix;
  }

  return lines;
}

function sanitizeGenbankToken(value, fallback = 'sequence', maxLength = 16) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .slice(0, maxLength);
  return cleaned || fallback;
}

function sanitizeGenbankFeatureType(type) {
  const cleaned = String(type || 'misc_feature')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .toLowerCase();
  return cleaned || 'misc_feature';
}

function sanitizeGenbankQualifierValue(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/"/g, '\'');
}

function buildGenbankFeatureLocation(feature, sequenceLength) {
  const strand = feature?.strand === -1 ? -1 : 1;
  const rawSegments = Array.isArray(feature?.segments) ? feature.segments : [];
  const segments = rawSegments
    .map((segment) => ({
      start: clamp(Math.round(Number(segment?.start) || 0), 0, sequenceLength),
      end: clamp(Math.round(Number(segment?.end) || 0), 0, sequenceLength)
    }))
    .filter((segment) => segment.end > segment.start);

  if (!segments.length) {
    return '';
  }

  const ordered = strand === -1 ? [...segments].reverse() : segments;
  const parts = ordered.map((segment) => `${segment.start + 1}..${segment.end}`);
  const location = parts.length === 1 ? parts[0] : `join(${parts.join(',')})`;
  return strand === -1 ? `complement(${location})` : location;
}

function formatGenbankOriginLines(sequence) {
  const lines = ['ORIGIN'];
  const lower = String(sequence || '').toLowerCase();

  for (let i = 0; i < lower.length; i += 60) {
    const chunk = lower.slice(i, i + 60);
    const groups = [];
    for (let j = 0; j < chunk.length; j += 10) {
      groups.push(chunk.slice(j, j + 10));
    }
    lines.push(`${String(i + 1).padStart(9, ' ')} ${groups.join(' ')}`);
  }

  return lines;
}

export function buildRecordGenbankText(record) {
  const sequence = normalizeSequenceText(record?.sequence || '');
  if (!sequence.length) {
    return '';
  }

  const topology = normalizeTopology(record?.topology || 'linear');
  const locusName = sanitizeGenbankToken(record?.name || 'sequence', 'sequence', 16);
  const dateStamp = toGenbankDate(new Date());
  const sourceFormat = String(record?.sourceFormat || '').trim().toUpperCase() || 'SEQUENCE_VIEWER';
  const definition = normalizeRecordName(record?.description || record?.name || '.', '.');
  const features = Array.isArray(record?.features) ? record.features : [];
  const lines = [
    `LOCUS       ${locusName.padEnd(16, ' ')}${String(sequence.length).padStart(11, ' ')} bp    DNA     ${topology.padEnd(8, ' ')} SYN ${dateStamp}`,
    ...wrapGenbankLine(definition, 'DEFINITION  ', '            '),
    ...wrapGenbankLine('.', 'ACCESSION   ', '            '),
    ...wrapGenbankLine('.', 'VERSION     ', '            '),
    'KEYWORDS    .',
    ...wrapGenbankLine('synthetic DNA construct', 'SOURCE      ', '            '),
    ...wrapGenbankLine('synthetic DNA construct', '  ORGANISM  ', '            '),
    '            .',
    ...wrapGenbankLine(`Exported from Sequence Viewer (${sourceFormat}).`, 'COMMENT     ', '            '),
    'FEATURES             Location/Qualifiers'
  ];

  features.forEach((feature) => {
    const location = buildGenbankFeatureLocation(feature, sequence.length);
    if (!location) {
      return;
    }
    const type = sanitizeGenbankFeatureType(feature?.type).slice(0, 16);
    const featurePrefix = `     ${type.padEnd(16, ' ')}`;
    const qualifierPrefix = '                     ';

    lines.push(...wrapGenbankLine(location, featurePrefix, qualifierPrefix));
    const qualifiers = [
      ['label', feature?.name || type],
      ['note', feature?.description || '']
    ];

    qualifiers.forEach(([key, rawValue]) => {
      const value = sanitizeGenbankQualifierValue(rawValue);
      if (!value) {
        return;
      }
      lines.push(...wrapGenbankLine(`/${key}="${value}"`, qualifierPrefix, qualifierPrefix));
    });
  });

  lines.push(...formatGenbankOriginLines(sequence));
  lines.push('//');
  return `${lines.join('\n')}\n`;
}

function ratioToCircularAngle(ratio) {
  return ((Math.max(0, ratio) * Math.PI * 2) - (Math.PI / 2));
}

function polarPoint(cx, cy, radius, theta) {
  return {
    x: cx + (radius * Math.cos(theta)),
    y: cy + (radius * Math.sin(theta))
  };
}

function buildCircularSegmentPath(cx, cy, innerRadius, outerRadius, startRatio, endRatio) {
  const safeStart = clamp(Number(startRatio) || 0, 0, 1);
  const safeEnd = clamp(Number(endRatio) || 0, 0, 1);
  const span = Math.max(0, safeEnd - safeStart);
  if (span <= 0) {
    return '';
  }

  const startTheta = ratioToCircularAngle(safeStart);
  const endTheta = ratioToCircularAngle(safeEnd);
  const outerStart = polarPoint(cx, cy, outerRadius, startTheta);
  const outerEnd = polarPoint(cx, cy, outerRadius, endTheta);
  const innerEnd = polarPoint(cx, cy, innerRadius, endTheta);
  const innerStart = polarPoint(cx, cy, innerRadius, startTheta);
  const largeArc = span > 0.5 ? 1 : 0;

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerRadius.toFixed(2)} ${outerRadius.toFixed(2)} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerRadius.toFixed(2)} ${innerRadius.toFixed(2)} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z'
  ].join(' ');
}

export function buildCircularPreviewHtmlDocument(record) {
  const sequence = normalizeSequenceText(record?.sequence || '');
  const sequenceLength = sequence.length;
  const rawFeatures = Array.isArray(record?.features) ? record.features : [];
  const previewFeatures = rawFeatures
    .filter((feature) => String(feature?.type || '').toLowerCase() !== 'restriction_site')
    .filter((feature) => Array.isArray(feature?.segments) && feature.segments.length);
  const layoutFeatures = assignFeatureLanes(previewFeatures);

  const cx = 400;
  const cy = 360;
  const laneStep = 14;
  const backboneInner = 192;
  const featureThickness = 10;
  const maxLane = Math.max(0, ...layoutFeatures.map((feature) => Number(feature.lane) || 0));
  const outerRadius = backboneInner + featureThickness + (Math.max(1, maxLane + 1) * laneStep) + 16;
  const tickPaths = [];
  const segmentPaths = [];

  const tickCount = sequenceLength > 5000 ? 20 : 12;
  for (let i = 0; i < tickCount; i += 1) {
    const ratio = i / tickCount;
    const theta = ratioToCircularAngle(ratio);
    const from = polarPoint(cx, cy, backboneInner - 8, theta);
    const to = polarPoint(cx, cy, backboneInner + 8, theta);
    tickPaths.push(`<line x1="${from.x.toFixed(2)}" y1="${from.y.toFixed(2)}" x2="${to.x.toFixed(2)}" y2="${to.y.toFixed(2)}" stroke="#8ca5c5" stroke-width="1"></line>`);
  }

  layoutFeatures.forEach((feature, index) => {
    const lane = Number(feature?.lane) || 0;
    const innerRadius = backboneInner + (lane * laneStep);
    const outerFeatureRadius = innerRadius + featureThickness;
    const colorKey = feature.type === 'restriction_site' ? `${feature.type}:${feature.name}` : feature.type;
    const fill = hashTypeToColor(colorKey);
    const title = `${feature.name || `feature_${index + 1}`} (${buildFeatureLocationText(feature, sequenceLength)})`;

    (Array.isArray(feature?.segments) ? feature.segments : []).forEach((segment) => {
      const start = clamp(Number(segment?.start) || 0, 0, sequenceLength);
      const end = clamp(Number(segment?.end) || 0, 0, sequenceLength);
      if (end <= start || !sequenceLength) {
        return;
      }
      const path = buildCircularSegmentPath(
        cx,
        cy,
        innerRadius,
        outerFeatureRadius,
        start / sequenceLength,
        end / sequenceLength
      );
      if (!path) {
        return;
      }
      segmentPaths.push(`<path d="${path}" fill="${fill}" stroke="#284a75" stroke-width="1.4"><title>${escapeHtml(title)}</title></path>`);
    });
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(record?.name || 'Sequence')}</title>
  <style>
    body { margin:0; padding:12px; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:#1e3553; background:#f5f8fc; }
    .card { border:1px solid #d4deec; border-radius:12px; background:#fff; padding:10px; }
    svg { width:100%; height:auto; max-height:740px; display:block; }
  </style>
</head>
<body>
  <div class="card">
    <svg viewBox="0 0 800 760" role="img" aria-label="Circular plasmid preview">
      <circle cx="${cx}" cy="${cy}" r="${(backboneInner - 6).toFixed(2)}" fill="#f8fbff" stroke="#dbe6f5" stroke-width="2"></circle>
      <circle cx="${cx}" cy="${cy}" r="${backboneInner.toFixed(2)}" fill="none" stroke="#96aed0" stroke-width="2.2"></circle>
      ${tickPaths.join('')}
      ${segmentPaths.join('')}
    </svg>
  </div>
</body>
</html>`;
}
