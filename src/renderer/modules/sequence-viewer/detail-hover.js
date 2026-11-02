import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("dna");
import { escapeHtml } from '../../lib/html.js';
import { buildFeatureLocationText } from './feature-model.js';
import { FEATURE_TOOLTIP_OFFSET_PX } from './constants.js';
import {
  createHoverTooltipInteractivity,
  renderPrimerHoverSection,
  renderPrimerNameCopyButton
} from './primer-hover.js';
import { copyPrimerValueFromEvent } from './primer-copy.js';
import { showTransientNotice } from '../../lib/notify.js';
import { renderCdsProteinHoverSection } from './rendering/protein-summary.js';
import { copyProteinValueFromEvent } from './protein-copy.js';
import { renderDigestionActions } from './digestion-actions.js';

function buildFeatureHoverTooltipHtml(feature, sequenceLength, recordSequence) {
  const primerCard = renderPrimerHoverSection(feature, recordSequence, { allowLibrarySave: true, allowPcr: true });
  if (primerCard) return primerCard;
  const strand = feature?.strand === -1 ? '-' : '+';
  const location = buildFeatureLocationText(feature, sequenceLength);
  const identity = Number.isFinite(feature?.identity) ? `${feature.identity.toFixed(2)}%` : '';
  const coverage = Number.isFinite(feature?.coverage) ? `${feature.coverage.toFixed(2)}%` : '';
  const source = String(feature?.mode || feature?.source || '-');
  const meta = [identity ? `Identity ${identity}` : '', coverage ? `Coverage ${coverage}` : '', source]
    .filter(Boolean)
    .join(' | ');

  return `
    <div class="sequence-viewer-feature-hover-head">
      <p class="sequence-viewer-feature-hover-title">${escapeHtml(feature?.name || '-')}</p>
      ${renderPrimerNameCopyButton(feature)}
    </div>
    <p>${escapeHtml(feature?.type || '-')} ${i18nUi.html("| Strand")} ${strand}</p>
    <p>${escapeHtml(location)}</p>
    <p>${escapeHtml(meta)}</p>
    ${renderCdsProteinHoverSection(feature, recordSequence)}
    ${renderDigestionActions(feature)}
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
    interactivity.reset();
    if (tooltip) {
      tooltip.hidden = true;
    }
  }

  const interactivity = createHoverTooltipInteractivity(tooltip, hideNow);

  // Give the pointer time to reach a readout's copy buttons.
  function hide() {
    interactivity.requestHide();
  }

  tooltip?.addEventListener?.('click', (event) => {
    void (async () => {
      if (event.target?.closest?.('[data-sequence-protein-copy]')) {
        await copyProteinValueFromEvent(event);
        return;
      }
      const result = await copyPrimerValueFromEvent(event);
      if (!result.handled) {
        return;
      }
      const label = result.kind === 'name' ? 'primer name' : 'primer sequence';
      showTransientNotice(
        (((((result.copied ? i18nUi.message("Copied {p0}.", { p0: label }) : i18nUi.message("Clipboard access is unavailable.")))))),
        { type: result.copied ? 'success' : 'error' }
      );
      // Stays up: name and sequence are two buttons, and copying one is no
      // reason to make the user re-hover for the other.
    })();
  });

  function show(event, feature, sequenceLength, recordSequence = '') {
    if (!tooltip || !feature) {
      return;
    }

    const html = buildFeatureHoverTooltipHtml(feature, sequenceLength, recordSequence);
    if (interactivity.shouldPreserve(event, html)) return;
    interactivity.cancelHide();
    rootDocument?.querySelectorAll?.('[data-sequence-hover-tooltip]').forEach(node => {
      if (node !== tooltip) node.hidden = true;
    });
    i18nUi.setHtml(tooltip, html);
    interactivity.setInteractive(/data-sequence-(?:(?:primer|protein)-copy=|digest-action=)/.test(tooltip.innerHTML));
    interactivity.anchor(event, html);
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
