import {
  DEFAULT_SEQUENCE_LINE_LENGTH,
  FALLBACK_CHAR_ADVANCE_PX,
  FALLBACK_SEQUENCE_LINE_HEIGHT_PX,
  DEFAULT_STRAND_MARKER_COLUMN_PX,
  DEFAULT_STRAND_COLUMN_GAP_PX
} from './constants.js';
import { clamp, parseCssPixels } from './shared.js';

function measureSequenceTypography(rootDocument, sequenceHost) {
  let charAdvancePx = FALLBACK_CHAR_ADVANCE_PX;
  let lineHeightPx = FALLBACK_SEQUENCE_LINE_HEIGHT_PX;

  if (rootDocument && sequenceHost && typeof sequenceHost.appendChild === 'function') {
    let probe = null;
    try {
      probe = rootDocument.createElement('span');
      probe.className = 'sequence-viewer-seq-text';
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      probe.style.pointerEvents = 'none';
      probe.style.whiteSpace = 'nowrap';
      probe.style.display = 'inline-block';
      probe.style.width = 'auto';
      const sampleLength = 40;
      probe.textContent = 'A'.repeat(sampleLength);
      sequenceHost.appendChild(probe);

      const measuredAdvance = probe.getBoundingClientRect().width / sampleLength;
      if (Number.isFinite(measuredAdvance) && measuredAdvance > 0) {
        charAdvancePx = measuredAdvance;
      }

      if (typeof globalThis.getComputedStyle === 'function') {
        const computed = globalThis.getComputedStyle(probe);
        const measuredLineHeight = parseCssPixels(computed?.lineHeight);
        if (Number.isFinite(measuredLineHeight) && measuredLineHeight > 0) {
          lineHeightPx = measuredLineHeight;
        } else {
          const measuredFontSize = parseCssPixels(computed?.fontSize);
          if (Number.isFinite(measuredFontSize) && measuredFontSize > 0) {
            lineHeightPx = measuredFontSize * 1.35;
          }
        }
      }
    } catch {
      // Keep fallback typography metrics.
    } finally {
      probe?.remove?.();
    }
  }

  return {
    charAdvancePx: Math.max(1, charAdvancePx),
    lineHeightPx: Math.max(8, lineHeightPx)
  };
}

export function computeSequenceLayoutMetrics(rootDocument, sequenceHost) {
  const typography = measureSequenceTypography(rootDocument, sequenceHost);
  const fallbackFeatureOffsetPx = DEFAULT_STRAND_MARKER_COLUMN_PX + DEFAULT_STRAND_COLUMN_GAP_PX;
  if (!sequenceHost || typeof sequenceHost.clientWidth !== 'number') {
    return {
      lineLength: DEFAULT_SEQUENCE_LINE_LENGTH,
      charAdvancePx: typography.charAdvancePx,
      lineHeightPx: typography.lineHeightPx,
      lineFeatureOffsetPx: fallbackFeatureOffsetPx
    };
  }

  const hostWidth = Math.max(0, sequenceHost.clientWidth);
  if (!hostWidth) {
    return {
      lineLength: DEFAULT_SEQUENCE_LINE_LENGTH,
      charAdvancePx: typography.charAdvancePx,
      lineHeightPx: typography.lineHeightPx,
      lineFeatureOffsetPx: fallbackFeatureOffsetPx
    };
  }

  const compact = hostWidth <= 640;
  const coordColumn = compact ? 58 : 74;
  const dualGap = compact ? 8 : 10;
  const strandEndColumn = compact ? 24 : 28;
  const strandEndGap = DEFAULT_STRAND_COLUMN_GAP_PX;
  const lineFeatureOffsetPx = strandEndColumn + strandEndGap;

  let hostPadding = 0;
  if (typeof globalThis.getComputedStyle === 'function') {
    const computed = globalThis.getComputedStyle(sequenceHost);
    hostPadding = parseCssPixels(computed?.paddingLeft) + parseCssPixels(computed?.paddingRight);
  }

  const usableWidth = Math.max(
    120,
    hostWidth - hostPadding - coordColumn - dualGap - (strandEndColumn * 2) - (strandEndGap * 2) - 12
  );
  const lineLength = clamp(Math.floor(usableWidth / Math.max(4.2, typography.charAdvancePx)), 24, 280);

  return {
    lineLength,
    charAdvancePx: typography.charAdvancePx,
    lineHeightPx: typography.lineHeightPx,
    lineFeatureOffsetPx
  };
}
