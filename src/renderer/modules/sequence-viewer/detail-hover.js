import { escapeHtml } from '../tool-box/common.js';
import { buildFeatureLocationText } from './feature-model.js';
import { FEATURE_TOOLTIP_OFFSET_PX } from './constants.js';

function buildFeatureHoverTooltipHtml(feature, sequenceLength) {
  const strand = feature?.strand === -1 ? '-' : '+';
  const location = buildFeatureLocationText(feature, sequenceLength);
  const identity = Number.isFinite(feature?.identity) ? `${feature.identity.toFixed(2)}%` : '';
  const coverage = Number.isFinite(feature?.coverage) ? `${feature.coverage.toFixed(2)}%` : '';
  const source = String(feature?.mode || feature?.source || '-');
  const meta = [identity ? `Identity ${identity}` : '', coverage ? `Coverage ${coverage}` : '', source]
    .filter(Boolean)
    .join(' | ');

  return `
    <p class="sequence-viewer-feature-hover-title">${escapeHtml(feature?.name || '-')}</p>
    <p>${escapeHtml(feature?.type || '-')} | Strand ${strand}</p>
    <p>${escapeHtml(location)}</p>
    <p>${escapeHtml(meta)}</p>
  `;
}

export function createSequenceHoverTooltipController(rootDocument) {
  const tooltip = (() => {
    if (
      !rootDocument
      || typeof rootDocument.createElement !== 'function'
      || !rootDocument.body
      || typeof rootDocument.body.appendChild !== 'function'
    ) {
      return null;
    }
    const node = rootDocument.createElement('div');
    node.className = 'sequence-viewer-feature-hover-tooltip';
    node.hidden = true;
    rootDocument.body.appendChild(node);
    return node;
  })();

  function hide() {
    if (tooltip) {
      tooltip.hidden = true;
    }
  }

  function show(event, feature, sequenceLength) {
    if (!tooltip || !feature) {
      return;
    }

    tooltip.innerHTML = buildFeatureHoverTooltipHtml(feature, sequenceLength);
    tooltip.hidden = false;

    const rawX = Number(event?.clientX);
    const rawY = Number(event?.clientY);
    const startX = Number.isFinite(rawX) ? rawX + FEATURE_TOOLTIP_OFFSET_PX : FEATURE_TOOLTIP_OFFSET_PX;
    const startY = Number.isFinite(rawY) ? rawY + FEATURE_TOOLTIP_OFFSET_PX : FEATURE_TOOLTIP_OFFSET_PX;
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = Number(globalThis?.innerWidth) || 0;
    const viewportHeight = Number(globalThis?.innerHeight) || 0;

    let left = Math.max(8, startX);
    let top = Math.max(8, startY);

    if (viewportWidth > 0) {
      left = Math.min(left, Math.max(8, viewportWidth - tooltipRect.width - 8));
    }
    if (viewportHeight > 0) {
      top = Math.min(top, Math.max(8, viewportHeight - tooltipRect.height - 8));
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  return {
    hide,
    show
  };
}
