import { escapeHtml } from '../tool-box/common.js';
import {
  assignFeatureLanes,
  buildFeatureLocationText,
  hashTypeToColor
} from './feature-model.js';
import { clamp, normalizeRecordName, normalizeSequenceText } from './shared.js';

// Minimal circular preview port inspired by:
// https://github.com/Edinburgh-Genome-Foundry/DnaFeaturesViewer (MIT)
// Hikari only keeps the standalone HTML/SVG plasmid-preview path.

const BACKBONE_RADIUS = 290;
const BACKBONE_WIDTH = 5;
const FEATURE_START_GAP = 18;
const FEATURE_BAND_WIDTH = 18;
const FEATURE_LANE_GAP = 12;
const LABEL_BASE_GAP = 46;
const LABEL_FONT_SIZE = 15;
const LABEL_LINE_HEIGHT = 18;
const LABEL_CHAR_WIDTH = 7.4;
const LABEL_MAX_LINE_LENGTH = 20;
const LABEL_MAX_LENGTH = 60;
const LABEL_STACK_GAP = 14;
const LABEL_SIDE_BALANCE_THRESHOLD = 0.55;
const LABEL_BOX_HORIZONTAL_PADDING = 12;
const PREVIEW_TOOLTIP_OFFSET_PX = 12;
const VIEWBOX_PADDING = 32;
const PREVIEW_FONT_FACE_CSS = `
    @font-face {
      font-family: "Inter";
      src: url("./assets/fonts/InterVariable.woff2") format("woff2-variations");
      font-style: normal;
      font-weight: 100 900;
      font-display: block;
    }
    @font-face {
      font-family: "Inter";
      src: url("./assets/fonts/InterVariable-Italic.woff2") format("woff2-variations");
      font-style: italic;
      font-weight: 100 900;
      font-display: block;
    }
`;

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

function buildColumnLabelLayout(features, sequenceLength, ringOuterRadius) {
  const items = features.map((feature) => {
    const theta = positionToTheta(feature.anchorPosition, sequenceLength);
    const labelWidthPx = Math.max(70, Number(feature?.labelWidthPx) || estimateLabelWidthPx(feature.labelLines));
    const labelHeightPx = estimateLabelHeightPx(feature.labelLines);
    const desiredPoint = polarPoint(0, 0, ringOuterRadius + LABEL_BASE_GAP, theta);
    return {
      ...feature,
      theta,
      defaultLabelSide: Math.cos(theta) >= 0 ? 'right' : 'left',
      labelWidthPx,
      labelHeightPx,
      desiredLabelCenterY: desiredPoint.y
    };
  });

  const sideLoad = { left: 0, right: 0 };
  const flexibleItems = [];

  items.forEach((item) => {
    const horizontalBias = Math.abs(Math.cos(item.theta));
    if (horizontalBias >= LABEL_SIDE_BALANCE_THRESHOLD) {
      item.labelSide = item.defaultLabelSide;
      sideLoad[item.labelSide] += item.labelHeightPx + LABEL_STACK_GAP;
      return;
    }
    flexibleItems.push(item);
  });

  flexibleItems
    .sort((left, right) => {
      const biasDiff = Math.abs(Math.cos(left.theta)) - Math.abs(Math.cos(right.theta));
      if (biasDiff !== 0) {
        return biasDiff;
      }
      return left.anchorPosition - right.anchorPosition;
    })
    .forEach((item) => {
      const preferredSide = item.defaultLabelSide;
      const alternateSide = preferredSide === 'right' ? 'left' : 'right';
      const preferredProjectedLoad = sideLoad[preferredSide] + item.labelHeightPx + LABEL_STACK_GAP;
      const alternateProjectedLoad = sideLoad[alternateSide] + item.labelHeightPx + LABEL_STACK_GAP;
      const chosenSide = alternateProjectedLoad + 8 < preferredProjectedLoad ? alternateSide : preferredSide;
      item.labelSide = chosenSide;
      sideLoad[chosenSide] = chosenSide === preferredSide ? preferredProjectedLoad : alternateProjectedLoad;
    });

  ['left', 'right'].forEach((side) => {
    const sideItems = items
      .filter((item) => item.labelSide === side)
      .sort((left, right) => left.desiredLabelCenterY - right.desiredLabelCenterY);

    if (!sideItems.length) {
      return;
    }

    sideItems[0].labelCenterY = sideItems[0].desiredLabelCenterY;
    for (let index = 1; index < sideItems.length; index += 1) {
      const previous = sideItems[index - 1];
      const current = sideItems[index];
      const minimumCenterY = previous.labelCenterY
        + (previous.labelHeightPx / 2)
        + (current.labelHeightPx / 2)
        + LABEL_STACK_GAP;
      current.labelCenterY = Math.max(current.desiredLabelCenterY, minimumCenterY);
    }

    const desiredCenterY = (sideItems[0].desiredLabelCenterY + sideItems[sideItems.length - 1].desiredLabelCenterY) / 2;
    const actualCenterY = (sideItems[0].labelCenterY + sideItems[sideItems.length - 1].labelCenterY) / 2;
    const shift = desiredCenterY - actualCenterY;
    sideItems.forEach((item) => {
      item.labelCenterY += shift;
    });
  });

  const rightColumnX = ringOuterRadius + LABEL_BASE_GAP;
  const leftColumnRightX = -ringOuterRadius - LABEL_BASE_GAP;
  const bendRadius = ringOuterRadius + Math.max(22, LABEL_BASE_GAP - 8);

  items.forEach((item) => {
    item.labelBoxX = item.labelSide === 'right'
      ? rightColumnX
      : leftColumnRightX - item.labelWidthPx;
    item.labelBoxY = item.labelCenterY - (item.labelHeightPx / 2);
    item.labelTextAnchor = item.labelSide === 'right' ? 'start' : 'end';
    item.textX = item.labelSide === 'right'
      ? item.labelBoxX + LABEL_BOX_HORIZONTAL_PADDING
      : item.labelBoxX + item.labelWidthPx - LABEL_BOX_HORIZONTAL_PADDING;
    item.leaderEndX = item.labelSide === 'right'
      ? item.labelBoxX
      : item.labelBoxX + item.labelWidthPx;
    item.leaderEndY = item.labelCenterY;
    item.bendPoint = polarPoint(0, 0, bendRadius, item.theta);
  });

  const minX = Math.min(
    -ringOuterRadius,
    ...items.map((item) => item.labelBoxX)
  );
  const maxX = Math.max(
    ringOuterRadius,
    ...items.map((item) => item.labelBoxX + item.labelWidthPx)
  );
  const minY = Math.min(
    -ringOuterRadius,
    ...items.map((item) => item.labelBoxY)
  );
  const maxY = Math.max(
    ringOuterRadius,
    ...items.map((item) => item.labelBoxY + item.labelHeightPx)
  );

  return {
    items,
    minX,
    maxX,
    minY,
    maxY
  };
}

function niceTickStep(sequenceLength) {
  const target = 6;
  const rough = Math.max(1, sequenceLength / target);
  const pow = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 2.5, 5, 10]
    .map((multiplier) => multiplier * pow)
    .find((candidate) => sequenceLength / candidate <= target + 2) ?? 10 * pow;
}

// bp ruler: numbered major ticks + faint minor ticks inside the backbone.
function buildTickMarkup(cx, cy, radius, sequenceLength) {
  const step = niceTickStep(sequenceLength);
  const minorStep = step / 5;
  const parts = [];

  for (let bp = 0; bp < sequenceLength; bp += minorStep) {
    const theta = ratioToTheta(bp / sequenceLength);
    const isMajor = Math.abs((bp / step) - Math.round(bp / step)) < 1e-6;
    const reach = isMajor ? 7 : 3.5;
    const inner = polarPoint(cx, cy, radius - reach, theta);
    const outer = polarPoint(cx, cy, radius + reach, theta);
    parts.push(
      `<line class="circular-preview__tick${isMajor ? ' circular-preview__tick--major' : ''}" x1="${inner.x.toFixed(2)}" y1="${inner.y.toFixed(2)}" x2="${outer.x.toFixed(2)}" y2="${outer.y.toFixed(2)}"></line>`
    );

    if (isMajor) {
      const label = polarPoint(cx, cy, radius - 20, theta);
      const text = bp === 0 ? '1' : String(Math.round(bp));
      parts.push(
        `<text class="circular-preview__ruler-label" x="${label.x.toFixed(2)}" y="${label.y.toFixed(2)}">${text}</text>`
      );
    }
  }

  return parts.join('');
}

function buildFeatureTooltip(feature, sequenceLength) {
  const summary = buildFeatureHoverCardData(feature, sequenceLength);
  const description = summary.description;
  return description
    ? `${summary.name} (${summary.location}) - ${description}`
    : `${summary.name} (${summary.location})`;
}

function buildFeatureHoverCardData(feature, sequenceLength) {
  const name = normalizeRecordName(feature?.name || 'Feature', 'Feature');
  const strand = feature?.strand === -1 ? '-' : '+';
  const type = normalizeRecordName(feature?.type || 'Feature', 'Feature');
  const location = buildFeatureLocationText(feature, sequenceLength);
  const description = String(feature?.description || '').replace(/\s+/g, ' ').trim();
  return {
    name,
    meta: `${type} | Strand ${strand}`,
    location,
    description
  };
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
      <text x="${cx.toFixed(2)}" y="${(cy - 14).toFixed(2)}" class="circular-preview__title">${safeName}</text>
      <text x="${cx.toFixed(2)}" y="${(cy + 18).toFixed(2)}" class="circular-preview__subtitle">${subtitle}</text>
    </g>
  `;
}

function buildPreviewMeasurementScriptMarkup() {
  return `
  <script>
    (() => {
      const LABEL_PADDING_X = ${LABEL_BOX_HORIZONTAL_PADDING};
      const MIN_LABEL_WIDTH = 70;
      const VIEWBOX_GUTTER = ${VIEWBOX_PADDING};
      const TOOLTIP_OFFSET = ${PREVIEW_TOOLTIP_OFFSET_PX};

      function escapeText(value) {
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function ensureTooltipNode() {
        let node = document.querySelector('.circular-preview__hover-tooltip');
        if (node) {
          return node;
        }
        node = document.createElement('div');
        node.className = 'circular-preview__hover-tooltip';
        node.hidden = true;
        document.body.appendChild(node);
        return node;
      }

      function hideTooltip() {
        const tooltip = document.querySelector('.circular-preview__hover-tooltip');
        if (tooltip) {
          tooltip.hidden = true;
          tooltip.dataset.owner = '';
        }
      }

      function buildTooltipHtml(target) {
        const name = String(target?.dataset?.tooltipName || '').trim();
        const meta = String(target?.dataset?.tooltipMeta || '').trim();
        const location = String(target?.dataset?.tooltipLocation || '').trim();
        const description = String(target?.dataset?.tooltipDescription || '').trim();
        if (!name && !meta && !location && !description) {
          return '';
        }
        return [
          name ? '<p class="circular-preview__hover-title">' + escapeText(name) + '</p>' : '',
          meta ? '<p>' + escapeText(meta) + '</p>' : '',
          location ? '<p>' + escapeText(location) + '</p>' : '',
          description ? '<p class="circular-preview__hover-description">' + escapeText(description) + '</p>' : ''
        ].filter(Boolean).join('');
      }

      function positionTooltip(tooltip, event) {
        const rawX = Number(event?.clientX);
        const rawY = Number(event?.clientY);
        const startX = Number.isFinite(rawX) ? rawX + TOOLTIP_OFFSET : TOOLTIP_OFFSET;
        const startY = Number.isFinite(rawY) ? rawY + TOOLTIP_OFFSET : TOOLTIP_OFFSET;
        const tooltipRect = tooltip.getBoundingClientRect();
        const viewportWidth = Number(window?.innerWidth) || 0;
        const viewportHeight = Number(window?.innerHeight) || 0;

        let left = Math.max(8, startX);
        let top = Math.max(8, startY);

        if (viewportWidth > 0) {
          left = Math.min(left, Math.max(8, viewportWidth - tooltipRect.width - 8));
        }
        if (viewportHeight > 0) {
          top = Math.min(top, Math.max(8, viewportHeight - tooltipRect.height - 8));
        }

        tooltip.style.left = left.toFixed(0) + 'px';
        tooltip.style.top = top.toFixed(0) + 'px';
      }

      function showTooltip(target, event) {
        const html = buildTooltipHtml(target);
        if (!html) {
          hideTooltip();
          return;
        }
        const tooltip = ensureTooltipNode();
        const ownerKey = String(target?.dataset?.tooltipKey || '');
        if (tooltip.dataset.owner !== ownerKey) {
          tooltip.innerHTML = html;
          tooltip.dataset.owner = ownerKey;
        }
        tooltip.hidden = false;
        positionTooltip(tooltip, event);
      }

      function bindFeatureHoverCards() {
        const svg = document.querySelector('.preview-shell svg');
        if (!svg || svg.dataset.hoverCardsBound === 'true') {
          return;
        }

        svg.dataset.hoverCardsBound = 'true';
        svg.querySelectorAll('[data-preview-tooltip="feature"]').forEach((node) => {
          node.addEventListener('pointerenter', (event) => {
            showTooltip(node, event);
          });
          node.addEventListener('pointermove', (event) => {
            showTooltip(node, event);
          });
          node.addEventListener('pointerleave', () => {
            hideTooltip();
          });
        });

        svg.addEventListener('pointerleave', () => {
          hideTooltip();
        });
        window.addEventListener('blur', () => {
          hideTooltip();
        });
      }

      function fitAnnotationBoxes() {
        const svg = document.querySelector('.preview-shell svg');
        const scene = svg?.querySelector('.circular-preview__scene');
        if (!svg || !scene) {
          return;
        }

        svg.querySelectorAll('.circular-preview__annotation').forEach((annotation) => {
          const rect = annotation.querySelector('.circular-preview__label-box');
          const leader = annotation.querySelector('.circular-preview__leader');
          const textNodes = annotation.querySelectorAll('.circular-preview__label-text');
          if (!rect || !leader || !textNodes.length) {
            return;
          }

          let minX = Number.POSITIVE_INFINITY;
          let maxX = Number.NEGATIVE_INFINITY;
          textNodes.forEach((node) => {
            const box = node.getBBox();
            if (!Number.isFinite(box.x) || !Number.isFinite(box.width)) {
              return;
            }
            minX = Math.min(minX, box.x);
            maxX = Math.max(maxX, box.x + box.width);
          });

          if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
            return;
          }

          const width = Math.max(MIN_LABEL_WIDTH, (maxX - minX) + (LABEL_PADDING_X * 2));
          const x = minX - LABEL_PADDING_X;
          rect.setAttribute('x', x.toFixed(2));
          rect.setAttribute('width', width.toFixed(2));

          const featureX = Number(annotation.dataset.featureX);
          const featureY = Number(annotation.dataset.featureY);
          const bendX = Number(annotation.dataset.bendX);
          const bendY = Number(annotation.dataset.bendY);
          const centerY = Number(annotation.dataset.labelCenterY);
          if (![featureX, featureY, bendX, bendY, centerY].every(Number.isFinite)) {
            return;
          }

          const endX = annotation.dataset.labelSide === 'right'
            ? x
            : x + width;
          leader.setAttribute(
            'd',
            \`M \${featureX.toFixed(2)} \${featureY.toFixed(2)} L \${bendX.toFixed(2)} \${bendY.toFixed(2)} L \${endX.toFixed(2)} \${centerY.toFixed(2)}\`
          );
        });

        const bounds = scene.getBBox();
        if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
          return;
        }

        svg.setAttribute(
          'viewBox',
          [
            Math.floor(bounds.x - VIEWBOX_GUTTER),
            Math.floor(bounds.y - VIEWBOX_GUTTER),
            Math.ceil(bounds.width + (VIEWBOX_GUTTER * 2)),
            Math.ceil(bounds.height + (VIEWBOX_GUTTER * 2))
          ].join(' ')
        );
      }

      function scheduleFit() {
        bindFeatureHoverCards();
        window.requestAnimationFrame(() => {
          fitAnnotationBoxes();
          bindFeatureHoverCards();
          window.setTimeout(fitAnnotationBoxes, 48);
        });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleFit, { once: true });
      } else {
        scheduleFit();
      }

      if (document.fonts?.ready) {
        document.fonts.ready.then(scheduleFit).catch(() => {});
      }

      window.addEventListener('load', scheduleFit, { once: true });
    })();
  </script>`;
}

function buildEmptyPreviewHtml(recordName) {
  const safeName = escapeHtml(recordName);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeName}</title>
  <style>${PREVIEW_FONT_FACE_CSS}
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #ffffff; }
    body { font-family: "Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #15314d; overflow: hidden; }
    .preview-shell {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 16px;
      display: grid;
      place-items: center;
      text-align: center;
    }
    .preview-empty {
      display: grid;
      gap: 12px;
      max-width: 560px;
    }
    h1 { margin: 0; font-size: 1.3rem; }
    p { margin: 0; line-height: 1.5; color: #55708f; }
  </style>
</head>
<body>
  <main class="preview-shell" data-renderer="dna-feature-viewer-js">
    <div class="preview-empty">
      <h1>${safeName}</h1>
      <p>No sequence is available for this circular plasmid preview.</p>
    </div>
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
        const labelFill = lightenHexColor(fill, 0.9);
        const labelLines = normalizeLabelLines(feature?.name || feature?.type || 'Feature');
        return {
          ...feature,
          name: normalizeRecordName(feature?.name || feature?.type || 'Feature', 'Feature'),
          segments,
          fill,
          stroke: darkenHexColor(fill, 0.18),
          labelFill,
          labelStroke: lightenHexColor(fill, 0.5),
          labelTextColor: darkenHexColor(fill, 0.5),
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
  const ringOuterRadius = BACKBONE_RADIUS + FEATURE_START_GAP + FEATURE_BAND_WIDTH + (maxLane * (FEATURE_BAND_WIDTH + FEATURE_LANE_GAP));
  const labeledFeatures = buildColumnLabelLayout(previewFeatures, sequenceLength, ringOuterRadius);
  const contentWidth = labeledFeatures.maxX - labeledFeatures.minX;
  const contentHeight = labeledFeatures.maxY - labeledFeatures.minY;
  const viewboxWidth = Math.ceil(contentWidth + (VIEWBOX_PADDING * 2));
  const viewboxHeight = Math.ceil(contentHeight + (VIEWBOX_PADDING * 2));
  const cx = VIEWBOX_PADDING - labeledFeatures.minX;
  const cy = VIEWBOX_PADDING - labeledFeatures.minY;

  const tickMarkup = buildTickMarkup(cx, cy, BACKBONE_RADIUS, sequenceLength);
  const featureMarkup = [];
  const labelMarkup = [];

  [...labeledFeatures.items]
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
      const hoverCard = buildFeatureHoverCardData(feature, sequenceLength);
      const hoverKey = escapeHtml(String(feature?.id || `feature_${index + 1}`));
      const hoverName = escapeHtml(hoverCard.name);
      const hoverMeta = escapeHtml(hoverCard.meta);
      const hoverLocation = escapeHtml(hoverCard.location);
      const hoverDescription = escapeHtml(hoverCard.description);

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
            data-preview-tooltip="feature"
            data-tooltip-key="${hoverKey}"
            data-tooltip-name="${hoverName}"
            data-tooltip-meta="${hoverMeta}"
            data-tooltip-location="${hoverLocation}"
            data-tooltip-description="${hoverDescription}"
            d="${path}"
            aria-label="${tooltip}"
            fill="${feature.fill}"
            stroke="${feature.stroke}"></path>
        `);
      });

      const featurePoint = polarPoint(cx, cy, outerRadius + 4, feature.theta);
      const bendPoint = {
        x: cx + feature.bendPoint.x,
        y: cy + feature.bendPoint.y
      };
      const labelWidthPx = feature.labelWidthPx;
      const labelHeightPx = feature.labelHeightPx;
      const textAnchor = feature.labelTextAnchor;
      const textX = cx + feature.textX;
      const textY = cy + feature.labelCenterY;
      const boxX = cx + feature.labelBoxX;
      const boxY = cy + feature.labelBoxY;
      const leaderEndX = cx + feature.leaderEndX;
      const leaderEndY = cy + feature.leaderEndY;

      labelMarkup.push(`
        <g
          class="circular-preview__annotation"
          data-preview-tooltip="feature"
          data-label-side="${feature.labelSide}"
          data-tooltip-key="${hoverKey}"
          data-tooltip-name="${hoverName}"
          data-tooltip-meta="${hoverMeta}"
          data-tooltip-location="${hoverLocation}"
          data-tooltip-description="${hoverDescription}"
          data-feature-x="${featurePoint.x.toFixed(2)}"
          data-feature-y="${featurePoint.y.toFixed(2)}"
          data-bend-x="${bendPoint.x.toFixed(2)}"
          data-bend-y="${bendPoint.y.toFixed(2)}"
          data-label-center-y="${leaderEndY.toFixed(2)}"
          aria-label="${tooltip}">
          <path class="circular-preview__leader"
            d="M ${featurePoint.x.toFixed(2)} ${featurePoint.y.toFixed(2)} L ${bendPoint.x.toFixed(2)} ${bendPoint.y.toFixed(2)} L ${leaderEndX.toFixed(2)} ${leaderEndY.toFixed(2)}"
            stroke="${feature.stroke}"></path>
          <rect
            class="circular-preview__label-box"
            x="${boxX.toFixed(2)}"
            y="${boxY.toFixed(2)}"
            width="${labelWidthPx.toFixed(2)}"
            height="${labelHeightPx.toFixed(2)}"
            rx="9"
            ry="9"
            fill="${feature.labelFill}"
            stroke="${feature.labelStroke}"></rect>
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
        </g>
      `);
    });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(recordName)}</title>
  <style>${PREVIEW_FONT_FACE_CSS}
    :root {
      color-scheme: light;
      --preview-ink: #16314c;
      --preview-muted: #5a7592;
      --preview-backbone: #7e99ba;
      --preview-tick: #8ca5c5;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #ffffff;
    }
    body {
      font-family: "Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--preview-ink);
      overflow: hidden;
    }
    .preview-shell {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      margin: 0;
      padding: 4px;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
    }
    .circular-preview__backbone {
      fill: none;
      stroke: var(--preview-backbone);
      stroke-width: ${BACKBONE_WIDTH};
    }
    .circular-preview__tick {
      stroke: var(--preview-tick);
      stroke-width: 1;
      opacity: 0.5;
    }
    .circular-preview__tick--major {
      stroke-width: 1.5;
      opacity: 0.9;
    }
    .circular-preview__ruler-label {
      fill: var(--preview-muted);
      font-size: 11px;
      font-weight: 600;
      text-anchor: middle;
      dominant-baseline: middle;
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
      stroke-width: 1;
      filter: url(#previewLabelShadow);
    }
    .circular-preview__label-text {
      font-size: ${LABEL_FONT_SIZE}px;
      font-weight: 600;
      dominant-baseline: middle;
      letter-spacing: 0.01em;
    }
    .circular-preview__hover-tooltip {
      position: fixed;
      z-index: 20;
      min-width: 180px;
      max-width: min(320px, calc(100vw - 16px));
      border-radius: 8px;
      border: 1px solid rgba(216, 206, 193, 0.96);
      background: rgba(255, 252, 247, 0.98);
      box-shadow: 0 2px 8px rgba(27, 20, 14, 0.1);
      padding: 9px 11px;
      font-size: 12px;
      line-height: 1.35;
      color: #17120e;
      pointer-events: none;
    }
    .circular-preview__hover-tooltip[hidden] {
      display: none;
    }
    .circular-preview__hover-tooltip p {
      margin: 0;
    }
    .circular-preview__hover-tooltip p + p {
      margin-top: 3px;
    }
    .circular-preview__hover-title {
      font-weight: 700;
    }
    .circular-preview__hover-description {
      color: #72675d;
    }
    .circular-preview__title {
      fill: var(--preview-ink);
      font-size: 28px;
      font-weight: 700;
      text-anchor: middle;
    }
    .circular-preview__subtitle {
      text-anchor: middle;
      fill: var(--preview-muted);
      letter-spacing: 0.02em;
    }
    .circular-preview__subtitle {
      font-size: 15px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <main class="preview-shell" data-renderer="dna-feature-viewer-js">
    <!-- Circular plasmid preview powered by a minimal JS port inspired by DnaFeaturesViewer (MIT). -->
    <svg
      viewBox="0 0 ${viewboxWidth} ${viewboxHeight}"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="${escapeHtml(`${recordName} circular plasmid preview`)}">
      <desc>Standalone circular plasmid preview for ${escapeHtml(recordName)}.</desc>
      <defs>
        <filter id="previewLabelShadow" x="-30%" y="-50%" width="160%" height="200%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#16314c" flood-opacity="0.16"></feDropShadow>
        </filter>
      </defs>
      <g class="circular-preview__scene">
        <circle class="circular-preview__backbone" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${BACKBONE_RADIUS.toFixed(2)}"></circle>
        ${tickMarkup}
        ${featureMarkup.join('')}
        ${labelMarkup.join('')}
        ${buildCenterMarkup(recordName, sequenceLength, labeledFeatures.items.length, cx, cy)}
      </g>
    </svg>
  </main>
  ${buildPreviewMeasurementScriptMarkup()}
</body>
</html>`;
}
