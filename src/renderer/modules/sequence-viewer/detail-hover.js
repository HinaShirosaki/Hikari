import { escapeHtml } from '../../lib/html.js';
import { buildFeatureLocationText } from './feature-model.js';
import { FEATURE_TOOLTIP_OFFSET_PX } from './constants.js';
import { createHoverTooltipInteractivity, renderPrimerHoverSection } from './primer-hover.js';
import { copyPrimerValueFromEvent } from './primer-copy.js';
import { showTransientNotice } from '../../lib/notify.js';

function buildFeatureHoverTooltipHtml(feature, sequenceLength, recordSequence) {
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
    ${renderPrimerHoverSection(feature, recordSequence)}
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
    node.setAttribute?.('data-sequence-hover-tooltip', 'feature');
    node.hidden = true;
    rootDocument.body.appendChild(node);
    return node;
  })();

  function hideNow() {
    if (tooltip) {
      tooltip.hidden = true;
    }
  }

  const interactivity = createHoverTooltipInteractivity(tooltip, hideNow);

  // Deferred while a primer readout is up, so the pointer can cross the gap to
  // the copy button; immediate for every other feature, as before.
  function hide() {
    interactivity.requestHide();
  }

  tooltip?.addEventListener?.('click', (event) => {
    void (async () => {
      const result = await copyPrimerValueFromEvent(event);
      if (!result.handled) {
        return;
      }
      showTransientNotice(
        result.copied ? 'Copied primer sequence.' : 'Clipboard access is unavailable.',
        { type: result.copied ? 'success' : 'error' }
      );
      hideNow();
    })();
  });

  function show(event, feature, sequenceLength, recordSequence = '') {
    if (!tooltip || !feature) {
      return;
    }

    interactivity.cancelHide();
    tooltip.innerHTML = buildFeatureHoverTooltipHtml(feature, sequenceLength, recordSequence);
    interactivity.setInteractive(tooltip.innerHTML.includes('sequence-viewer-primer-hover'));
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
    hideNow,
    show
  };
}
