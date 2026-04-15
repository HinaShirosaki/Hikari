import { escapeHtml } from '../tool-box/common.js';
import {
  assignFeatureLanes,
  buildFeatureLocationText,
  getContrastTextColor,
  hashTypeToColor
} from './feature-model.js';
import { clamp, normalizeRecordName, normalizeSequenceText } from './shared.js';

// Minimal circular preview port inspired by:
// https://github.com/Edinburgh-Genome-Foundry/DnaFeaturesViewer (MIT)
// Enana only keeps the standalone HTML/SVG plasmid-preview path.

const BACKBONE_RADIUS = 240;
const BACKBONE_WIDTH = 14;
const FEATURE_START_GAP = 18;
const FEATURE_BAND_WIDTH = 18;
const FEATURE_LANE_GAP = 12;
const LABEL_BASE_GAP = 58;
const LABEL_LEVEL_GAP = 32;
const LABEL_FONT_SIZE = 15;
const LABEL_LINE_HEIGHT = 18;
const LABEL_CHAR_WIDTH = 7.4;
const LABEL_MAX_LINE_LENGTH = 20;
const LABEL_MAX_LENGTH = 60;
const MIN_VIEWBOX_RADIUS = 470;
const VIEWBOX_PADDING = 72;

function parseHexColor(color) {
  const normalized = String(color || '').trim();
  const match = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }

  const raw = match[1];
  if (raw.length === 3) {
    return {
      r: Number.parseInt(`${raw[0]}${raw[0]}`, 16),
      g: Number.parseInt(`${raw[1]}${raw[1]}`, 16),
      b: Number.parseInt(`${raw[2]}${raw[2]}`, 16)
    };
  }

  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16)
  };
}

function formatHexColor({ r, g, b }) {
  return `#${[r, g, b].map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function mixHexColors(color, target, amount = 0.5) {
  const sourceRgb = parseHexColor(color);
  const targetRgb = parseHexColor(target);
  if (!sourceRgb || !targetRgb) {
    return color;
  }

  const weight = clamp(Number(amount) || 0, 0, 1);
  return formatHexColor({
    r: sourceRgb.r + ((targetRgb.r - sourceRgb.r) * weight),
    g: sourceRgb.g + ((targetRgb.g - sourceRgb.g) * weight),
    b: sourceRgb.b + ((targetRgb.b - sourceRgb.b) * weight)
  });
}

function lightenHexColor(color, amount = 0.84) {
  return mixHexColors(color, '#ffffff', amount);
}

function darkenHexColor(color, amount = 0.24) {
  return mixHexColors(color, '#102842', amount);
}

function positiveModulo(value, modulo) {
  if (!Number.isFinite(Number(modulo)) || modulo <= 0) {
    return 0;
  }
  const numeric = Number(value) || 0;
  return ((numeric % modulo) + modulo) % modulo;
}

function normalizeFeatureSegments(feature, sequenceLength) {
  return (Array.isArray(feature?.segments) ? feature.segments : [])
    .map((segment) => ({
      start: clamp(Number(segment?.start) || 0, 0, sequenceLength),
      end: clamp(Number(segment?.end) || 0, 0, sequenceLength)
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => left.start - right.start);
}

function featureSpanBp(feature) {
  return (Array.isArray(feature?.segments) ? feature.segments : [])
    .reduce((sum, segment) => sum + Math.max(0, (Number(segment?.end) || 0) - (Number(segment?.start) || 0)), 0);
}

function ratioToTheta(ratio) {
  return (-Math.PI / 2) + (clamp(Number(ratio) || 0, 0, 1) * Math.PI * 2);
}

function positionToTheta(position, sequenceLength) {
  if (!sequenceLength) {
    return -Math.PI / 2;
  }
  return ratioToTheta((Number(position) || 0) / sequenceLength);
}

function polarPoint(cx, cy, radius, theta) {
  return {
    x: cx + (radius * Math.cos(theta)),
    y: cy + (radius * Math.sin(theta))
  };
}

function arcCommand(radius, largeArcFlag, sweepFlag, point) {
  return `A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArcFlag} ${sweepFlag} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}

function buildRingSegmentPath(cx, cy, innerRadius, outerRadius, startAngle, endAngle) {
  const span = Math.max(0, Number(endAngle) - Number(startAngle));
  if (span <= 0) {
    return '';
  }

  const outerStart = polarPoint(cx, cy, outerRadius, startAngle);
  const outerEnd = polarPoint(cx, cy, outerRadius, endAngle);
  const innerEnd = polarPoint(cx, cy, innerRadius, endAngle);
  const innerStart = polarPoint(cx, cy, innerRadius, startAngle);
  const largeArc = span > Math.PI ? 1 : 0;

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    arcCommand(outerRadius, largeArc, 1, outerEnd),
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    arcCommand(innerRadius, largeArc, 0, innerStart),
    'Z'
  ].join(' ');
}

function buildDirectionalRingPath(cx, cy, innerRadius, outerRadius, startRatio, endRatio, direction) {
  const safeStart = clamp(Number(startRatio) || 0, 0, 1);
  const safeEnd = clamp(Number(endRatio) || 0, 0, 1);
  const spanRatio = Math.max(0, safeEnd - safeStart);
  if (spanRatio <= 0) {
    return '';
  }

  const startAngle = ratioToTheta(safeStart);
  const endAngle = ratioToTheta(safeEnd);
  const spanAngle = Math.max(0, endAngle - startAngle);
  if (spanAngle <= 0.02 || (direction !== 1 && direction !== -1)) {
    return buildRingSegmentPath(cx, cy, innerRadius, outerRadius, startAngle, endAngle);
  }

  const arrowAngle = Math.min(Math.PI / 36, spanAngle / 2);
  const centerRadius = (innerRadius + outerRadius) / 2;

  if (direction === 1) {
    const endBaseAngle = endAngle - arrowAngle;
    const outerStart = polarPoint(cx, cy, outerRadius, startAngle);
    const outerEndBase = polarPoint(cx, cy, outerRadius, endBaseAngle);
    const tip = polarPoint(cx, cy, centerRadius, endAngle);
    const innerEndBase = polarPoint(cx, cy, innerRadius, endBaseAngle);
    const innerStart = polarPoint(cx, cy, innerRadius, startAngle);
    const largeArc = (endBaseAngle - startAngle) > Math.PI ? 1 : 0;

    return [
      `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
      arcCommand(outerRadius, largeArc, 1, outerEndBase),
      `L ${tip.x.toFixed(2)} ${tip.y.toFixed(2)}`,
      `L ${innerEndBase.x.toFixed(2)} ${innerEndBase.y.toFixed(2)}`,
      arcCommand(innerRadius, largeArc, 0, innerStart),
      'Z'
    ].join(' ');
  }

  const startBaseAngle = startAngle + arrowAngle;
  const tip = polarPoint(cx, cy, centerRadius, startAngle);
  const outerStartBase = polarPoint(cx, cy, outerRadius, startBaseAngle);
  const outerEnd = polarPoint(cx, cy, outerRadius, endAngle);
  const innerEnd = polarPoint(cx, cy, innerRadius, endAngle);
  const innerStartBase = polarPoint(cx, cy, innerRadius, startBaseAngle);
  const largeArc = (endAngle - startBaseAngle) > Math.PI ? 1 : 0;

  return [
    `M ${tip.x.toFixed(2)} ${tip.y.toFixed(2)}`,
    `L ${outerStartBase.x.toFixed(2)} ${outerStartBase.y.toFixed(2)}`,
    arcCommand(outerRadius, largeArc, 1, outerEnd),
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    arcCommand(innerRadius, largeArc, 0, innerStartBase),
    'Z'
  ].join(' ');
}

function splitCircularInterval(start, end, sequenceLength) {
  const span = Math.max(0, (Number(end) || 0) - (Number(start) || 0));
  if (!sequenceLength || span <= 0) {
    return [];
  }
  if (span >= sequenceLength) {
    return [{ start: 0, end: sequenceLength }];
  }

  const normalizedStart = positiveModulo(start, sequenceLength);
  const normalizedEnd = normalizedStart + span;
  if (normalizedEnd <= sequenceLength) {
    return [{ start: normalizedStart, end: normalizedEnd }];
  }

  return [
    { start: normalizedStart, end: sequenceLength },
    { start: 0, end: normalizedEnd - sequenceLength }
  ];
}

function intervalsOverlap(leftIntervals, rightIntervals) {
  return leftIntervals.some((left) => rightIntervals.some((right) => left.start < right.end && right.start < left.end));
}

function wrapWords(text, lineLength) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return [];
  }

  const words = normalized
    .split(/\s+/)
    .flatMap((word) => {
      if (word.length <= lineLength) {
        return [word];
      }

      const chunks = [];
      for (let index = 0; index < word.length; index += lineLength) {
        chunks.push(word.slice(index, index + lineLength));
      }
      return chunks;
    });
  const lines = [];
  let currentLine = '';

  words.forEach((word) => {
    if (!currentLine.length) {
      currentLine = word;
      return;
    }

    const next = `${currentLine} ${word}`;
    if (next.length <= lineLength) {
      currentLine = next;
      return;
    }

    lines.push(currentLine);
    currentLine = word;
  });

  if (currentLine.length) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [normalized];
}

function findNarrowestWrap(text, maxLineLength) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return [];
  }

  let best = wrapWords(normalized, maxLineLength);
  let bestWidth = Math.max(...best.map((line) => line.length));
  for (let lineLength = maxLineLength - 1; lineLength >= 8; lineLength -= 1) {
    const attempt = wrapWords(normalized, lineLength);
    if (attempt.length > best.length) {
      break;
    }
    const width = Math.max(...attempt.map((line) => line.length));
    if (width < bestWidth) {
      best = attempt;
      bestWidth = width;
    }
  }
  return best;
}

function normalizeLabelLines(label) {
  const normalized = String(label || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return ['Feature'];
  }

  const clipped = normalized.length > LABEL_MAX_LENGTH
    ? `${normalized.slice(0, LABEL_MAX_LENGTH - 1).trimEnd()}…`
    : normalized;
  return findNarrowestWrap(clipped, LABEL_MAX_LINE_LENGTH);
}

function estimateLabelWidthPx(lines) {
  return Math.max(70, Math.max(...lines.map((line) => line.length), 0) * LABEL_CHAR_WIDTH) + 16;
}

function estimateLabelHeightPx(lines) {
  return (Math.max(1, lines.length) * LABEL_LINE_HEIGHT) + 8;
}

function computeFeatureAnchorPosition(feature, sequenceLength) {
  const segments = Array.isArray(feature?.segments) ? feature.segments : [];
  if (!segments.length) {
    return 0;
  }

  const longestSegment = segments.reduce((best, segment) => {
    const span = Math.max(0, segment.end - segment.start);
    if (!best) {
      return { segment, span };
    }
    return span > best.span ? { segment, span } : best;
  }, null)?.segment;

  if (!longestSegment) {
    return 0;
  }

  return clamp((longestSegment.start + longestSegment.end) / 2, 0, sequenceLength);
}

function assignLabelLevels(features, sequenceLength, labelRadius) {
  const circumferencePx = Math.max(1, 2 * Math.PI * labelRadius);
  const items = features.map((feature) => {
    const labelWidthPx = estimateLabelWidthPx(feature.labelLines);
    const bpWidth = (labelWidthPx / circumferencePx) * sequenceLength;
    return {
      feature,
      labelWidthPx,
      collisionSegments: splitCircularInterval(
        feature.anchorPosition - (bpWidth / 2),
        feature.anchorPosition + (bpWidth / 2),
        sequenceLength
      )
    };
  });

  const neighbors = new Map(items.map((item) => [item, []]));
  for (let index = 0; index < items.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < items.length; compareIndex += 1) {
      if (!intervalsOverlap(items[index].collisionSegments, items[compareIndex].collisionSegments)) {
        continue;
      }
      neighbors.get(items[index]).push(items[compareIndex]);
      neighbors.get(items[compareIndex]).push(items[index]);
    }
  }

  const levels = new Map();
  const ordered = [...items].sort((left, right) => {
    const spanDiff = featureSpanBp(right.feature) - featureSpanBp(left.feature);
    if (spanDiff !== 0) {
      return spanDiff;
    }
    return right.labelWidthPx - left.labelWidthPx;
  });

  ordered.forEach((item) => {
    let level = 0;
    while (neighbors.get(item).some((neighbor) => levels.get(neighbor) === level)) {
      level += 1;
    }
    levels.set(item, level);
  });

  return items.map((item) => ({
    ...item.feature,
    labelLevel: levels.get(item) || 0,
    labelWidthPx: item.labelWidthPx
  }));
}

function buildTickMarkup(cx, cy, radius, sequenceLength) {
  const tickCount = sequenceLength >= 8000 ? 24 : sequenceLength >= 4000 ? 16 : 12;
  const ticks = [];

  for (let index = 0; index < tickCount; index += 1) {
    const ratio = index / tickCount;
    const theta = ratioToTheta(ratio);
    const inner = polarPoint(cx, cy, radius - 12, theta);
    const outer = polarPoint(cx, cy, radius + 12, theta);
    ticks.push(
      `<line class="circular-preview__tick" x1="${inner.x.toFixed(2)}" y1="${inner.y.toFixed(2)}" x2="${outer.x.toFixed(2)}" y2="${outer.y.toFixed(2)}"></line>`
    );
  }

  return ticks.join('');
}

function buildFeatureTooltip(feature, sequenceLength) {
  const name = normalizeRecordName(feature?.name || 'Feature', 'Feature');
  const location = buildFeatureLocationText(feature, sequenceLength);
  const description = String(feature?.description || '').replace(/\s+/g, ' ').trim();
  return description
    ? `${name} (${location}) - ${description}`
    : `${name} (${location})`;
}

function formatBpCount(value) {
  const numeric = Math.max(0, Math.round(Number(value) || 0));
  return `${numeric.toLocaleString()} bp`;
}

function buildCenterMarkup(recordName, sequenceLength, featureCount, cx, cy) {
  const safeName = escapeHtml(recordName);
  const subtitle = escapeHtml(`${formatBpCount(sequenceLength)} · ${featureCount} feature${featureCount === 1 ? '' : 's'}`);
  return `
    <g class="circular-preview__center">
      <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(BACKBONE_RADIUS - 56).toFixed(2)}" class="circular-preview__center-disc"></circle>
      <text x="${cx.toFixed(2)}" y="${(cy - 14).toFixed(2)}" class="circular-preview__title">${safeName}</text>
      <text x="${cx.toFixed(2)}" y="${(cy + 18).toFixed(2)}" class="circular-preview__subtitle">${subtitle}</text>
      <text x="${cx.toFixed(2)}" y="${(cy + 48).toFixed(2)}" class="circular-preview__caption">Circular plasmid preview</text>
    </g>
  `;
}

function buildEmptyPreviewHtml(recordName) {
  const safeName = escapeHtml(recordName);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeName}</title>
  <style>
    body { margin: 0; padding: 20px; font-family: "Playfair Display", serif; background: #eef4fb; color: #15314d; }
    .preview-shell { max-width: 760px; margin: 0 auto; padding: 24px; border: 1px solid #d2deed; border-radius: 24px; background: rgba(255, 255, 255, 0.92); box-shadow: 0 28px 72px rgba(16, 40, 66, 0.08); }
    h1 { margin: 0 0 12px; font-size: 1.3rem; }
    p { margin: 0; line-height: 1.5; color: #55708f; }
  </style>
</head>
<body>
  <main class="preview-shell" data-renderer="dna-feature-viewer-js">
    <h1>${safeName}</h1>
    <p>No sequence is available for this circular plasmid preview.</p>
  </main>
</body>
</html>`;
}

export function buildDnaFeatureViewerCircularPreviewHtmlDocument(record) {
  const sequence = normalizeSequenceText(record?.sequence || '');
  const sequenceLength = sequence.length;
  const recordName = normalizeRecordName(record?.name || 'Sequence', 'Sequence');
  if (!sequenceLength) {
    return buildEmptyPreviewHtml(recordName);
  }

  const previewFeatures = assignFeatureLanes(
    (Array.isArray(record?.features) ? record.features : [])
      .filter((feature) => String(feature?.type || '').toLowerCase() !== 'restriction_site')
      .map((feature) => {
        const segments = normalizeFeatureSegments(feature, sequenceLength);
        if (!segments.length) {
          return null;
        }

        const fill = hashTypeToColor(feature?.type === 'restriction_site' ? `${feature.type}:${feature.name}` : feature?.type);
        const labelFill = lightenHexColor(fill, 0.86);
        const labelLines = normalizeLabelLines(feature?.name || feature?.type || 'Feature');
        return {
          ...feature,
          name: normalizeRecordName(feature?.name || feature?.type || 'Feature', 'Feature'),
          segments,
          fill,
          stroke: darkenHexColor(fill, 0.18),
          labelFill,
          labelTextColor: getContrastTextColor(labelFill),
          labelLines,
          anchorPosition: computeFeatureAnchorPosition({ segments }, sequenceLength)
        };
      })
      .filter(Boolean)
  ).map((feature) => ({
    ...feature,
    spanBp: featureSpanBp(feature)
  }));

  const maxLane = Math.max(0, ...previewFeatures.map((feature) => Number(feature?.lane) || 0));
  const featureMaxOuterRadius = BACKBONE_RADIUS + FEATURE_START_GAP + FEATURE_BAND_WIDTH + (maxLane * (FEATURE_BAND_WIDTH + FEATURE_LANE_GAP));
  const labelBaseRadius = featureMaxOuterRadius + LABEL_BASE_GAP;
  const labeledFeatures = assignLabelLevels(previewFeatures, sequenceLength, labelBaseRadius + LABEL_LEVEL_GAP);
  const maxLabelLevel = Math.max(0, ...labeledFeatures.map((feature) => Number(feature?.labelLevel) || 0));
  const maxLabelWidthPx = Math.max(120, ...labeledFeatures.map((feature) => Number(feature?.labelWidthPx) || 0));
  const viewboxRadius = Math.max(
    MIN_VIEWBOX_RADIUS,
    labelBaseRadius + (maxLabelLevel * LABEL_LEVEL_GAP) + maxLabelWidthPx + VIEWBOX_PADDING
  );
  const viewboxSize = Math.ceil(viewboxRadius * 2);
  const cx = viewboxSize / 2;
  const cy = viewboxSize / 2;

  const tickMarkup = buildTickMarkup(cx, cy, BACKBONE_RADIUS, sequenceLength);
  const featureMarkup = [];
  const labelMarkup = [];

  [...labeledFeatures]
    .sort((left, right) => {
      const laneDiff = (Number(left?.lane) || 0) - (Number(right?.lane) || 0);
      if (laneDiff !== 0) {
        return laneDiff;
      }
      return (Number(right?.spanBp) || 0) - (Number(left?.spanBp) || 0);
    })
    .forEach((feature, index) => {
      const lane = Number(feature?.lane) || 0;
      const innerRadius = BACKBONE_RADIUS + FEATURE_START_GAP + (lane * (FEATURE_BAND_WIDTH + FEATURE_LANE_GAP));
      const outerRadius = innerRadius + FEATURE_BAND_WIDTH;
      const direction = feature?.strand === -1 ? -1 : feature?.strand === 1 ? 1 : 0;
      const tooltip = escapeHtml(buildFeatureTooltip(feature, sequenceLength));

      feature.segments.forEach((segment, segmentIndex) => {
        const path = buildDirectionalRingPath(
          cx,
          cy,
          innerRadius,
          outerRadius,
          segment.start / sequenceLength,
          segment.end / sequenceLength,
          direction
        );
        if (!path) {
          return;
        }
        featureMarkup.push(`
          <path class="circular-preview__feature"
            data-feature-index="${index + 1}"
            data-segment-index="${segmentIndex + 1}"
            d="${path}"
            fill="${feature.fill}"
            stroke="${feature.stroke}">
            <title>${tooltip}</title>
          </path>
        `);
      });

      const labelRadius = labelBaseRadius + ((Number(feature?.labelLevel) || 0) * LABEL_LEVEL_GAP);
      const theta = positionToTheta(feature.anchorPosition, sequenceLength);
      const featurePoint = polarPoint(cx, cy, outerRadius + 4, theta);
      const bendPoint = polarPoint(cx, cy, labelRadius - 10, theta);
      const labelPoint = polarPoint(cx, cy, labelRadius, theta);
      const labelWidthPx = estimateLabelWidthPx(feature.labelLines);
      const labelHeightPx = estimateLabelHeightPx(feature.labelLines);
      const horizontalBias = Math.cos(theta);
      const textAnchor = Math.abs(horizontalBias) < 0.18 ? 'middle' : horizontalBias > 0 ? 'start' : 'end';
      const textX = labelPoint.x + (textAnchor === 'middle' ? 0 : (textAnchor === 'start' ? 18 : -18));
      const textY = labelPoint.y;
      const boxX = textAnchor === 'middle'
        ? textX - (labelWidthPx / 2)
        : textAnchor === 'start'
          ? textX - 6
          : textX - labelWidthPx + 6;
      const boxY = textY - (labelHeightPx / 2);
      const leaderEndX = textAnchor === 'middle'
        ? textX
        : textAnchor === 'start'
          ? boxX
          : boxX + labelWidthPx;
      const leaderEndY = textY;

      labelMarkup.push(`
        <g class="circular-preview__annotation" data-label-level="${Number(feature?.labelLevel) || 0}">
          <path class="circular-preview__leader"
            d="M ${featurePoint.x.toFixed(2)} ${featurePoint.y.toFixed(2)} L ${bendPoint.x.toFixed(2)} ${bendPoint.y.toFixed(2)} L ${leaderEndX.toFixed(2)} ${leaderEndY.toFixed(2)}"
            stroke="${feature.stroke}"></path>
          <rect
            class="circular-preview__label-box"
            x="${boxX.toFixed(2)}"
            y="${boxY.toFixed(2)}"
            width="${labelWidthPx.toFixed(2)}"
            height="${labelHeightPx.toFixed(2)}"
            rx="10"
            ry="10"
            fill="${feature.labelFill}"
            stroke="${feature.stroke}"></rect>
          ${feature.labelLines.map((line, lineIndex) => `
            <text
              class="circular-preview__label-text"
              x="${textX.toFixed(2)}"
              y="${(textY + ((lineIndex - ((feature.labelLines.length - 1) / 2)) * LABEL_LINE_HEIGHT)).toFixed(2)}"
              text-anchor="${textAnchor}"
              fill="${feature.labelTextColor}">
              ${escapeHtml(line)}
            </text>
          `).join('')}
          <title>${tooltip}</title>
        </g>
      `);
    });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(recordName)}</title>
  <style>
    :root {
      color-scheme: light;
      --preview-ink: #16314c;
      --preview-muted: #5a7592;
      --preview-shell: rgba(255, 255, 255, 0.94);
      --preview-shell-border: #d3dfed;
      --preview-backdrop-a: #edf4fb;
      --preview-backdrop-b: #dce9f7;
      --preview-backbone: #7e99ba;
      --preview-center-ring: #d8e4f2;
      --preview-center-disc: #f9fbfe;
      --preview-tick: #8ca5c5;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 18px;
      min-height: 100vh;
      font-family: "Playfair Display", serif;
      color: var(--preview-ink);
      background:
        radial-gradient(circle at top, rgba(255, 255, 255, 0.92), transparent 48%),
        linear-gradient(180deg, var(--preview-backdrop-a), var(--preview-backdrop-b));
    }
    .preview-shell {
      max-width: 1100px;
      margin: 0 auto;
      padding: 20px;
      border: 1px solid var(--preview-shell-border);
      border-radius: 28px;
      background: var(--preview-shell);
      box-shadow: 0 28px 72px rgba(16, 40, 66, 0.08);
      backdrop-filter: blur(10px);
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
    }
    .circular-preview__backbone {
      fill: none;
      stroke: var(--preview-backbone);
      stroke-width: ${BACKBONE_WIDTH};
    }
    .circular-preview__center-ring {
      fill: none;
      stroke: var(--preview-center-ring);
      stroke-width: 2;
    }
    .circular-preview__center-disc {
      fill: var(--preview-center-disc);
      stroke: var(--preview-center-ring);
      stroke-width: 2;
    }
    .circular-preview__tick {
      stroke: var(--preview-tick);
      stroke-width: 1.5;
      opacity: 0.9;
    }
    .circular-preview__feature {
      stroke-width: 1.5;
      stroke-linejoin: round;
    }
    .circular-preview__leader {
      fill: none;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.82;
    }
    .circular-preview__label-box {
      stroke-width: 1.2;
    }
    .circular-preview__label-text {
      font-size: ${LABEL_FONT_SIZE}px;
      font-weight: 600;
      dominant-baseline: middle;
      letter-spacing: 0.01em;
    }
    .circular-preview__title {
      fill: var(--preview-ink);
      font-size: 28px;
      font-weight: 700;
      text-anchor: middle;
    }
    .circular-preview__subtitle,
    .circular-preview__caption {
      text-anchor: middle;
      fill: var(--preview-muted);
      letter-spacing: 0.02em;
    }
    .circular-preview__subtitle {
      font-size: 15px;
      font-weight: 600;
    }
    .circular-preview__caption {
      font-size: 13px;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <main class="preview-shell" data-renderer="dna-feature-viewer-js">
    <!-- Circular plasmid preview powered by a minimal JS port inspired by DnaFeaturesViewer (MIT). -->
    <svg
      viewBox="0 0 ${viewboxSize} ${viewboxSize}"
      role="img"
      aria-label="${escapeHtml(`${recordName} circular plasmid preview`)}">
      <desc>Standalone circular plasmid preview for ${escapeHtml(recordName)}.</desc>
      <circle class="circular-preview__center-ring" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(BACKBONE_RADIUS - 32).toFixed(2)}"></circle>
      <circle class="circular-preview__backbone" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${BACKBONE_RADIUS.toFixed(2)}"></circle>
      ${tickMarkup}
      ${featureMarkup.join('')}
      ${labelMarkup.join('')}
      ${buildCenterMarkup(recordName, sequenceLength, labeledFeatures.length, cx, cy)}
    </svg>
  </main>
</body>
</html>`;
}
