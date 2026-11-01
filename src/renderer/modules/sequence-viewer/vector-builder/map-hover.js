import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("dna");
// Hover readout for sequence maps, shared by the Vector Builder and the library
// preview.
//
// Short features -- primer binding sites especially -- render as slivers on a
// multi-kb plasmid, so their only on-map identification is a name in the label
// column, which is hard to associate with the arc under the cursor. This puts
// the name (and its span) right at the pointer. It replaces the native <title>
// tooltip, which took about a second to appear and could not be styled.

import { escapeHtml } from '../../../lib/html.js';
import { showTransientNotice } from '../../../lib/notify.js';
import { copyPrimerValueFromEvent } from '../primer-copy.js';
import { createHoverTooltipInteractivity, renderPrimerHoverSection } from '../primer-hover.js';
import { renderCdsProteinHoverSection } from '../rendering/protein-summary.js';
import { copyProteinValueFromEvent } from '../protein-copy.js';
import { renderDigestionActions } from '../digestion-actions.js';

const TOOLTIP_CLASS = 'vector-map__tooltip';
const POINTER_OFFSET_PX = 14;

export function attachMapHoverLabel(config = {}) {
  const resolveHost = typeof config?.host === 'function' ? config.host : () => config?.host || null;
  const rootDocument = config?.rootDocument || globalThis?.document || null;
  // Supplied by the map's owner so a primer arc can show the oligo itself; the
  // aria-label alone only carries the name and span.
  const getFeature = typeof config?.getFeature === 'function' ? config.getFeature : () => null;
  const getSequence = typeof config?.getSequence === 'function' ? config.getSequence : () => '';
  let node = null;
  let interactivity = null;

  function ensureNode() {
    if (node || !rootDocument?.createElement || !rootDocument?.body?.appendChild) {
      return node;
    }
    node = rootDocument.createElement('div');
    node.className = TOOLTIP_CLASS;
    node.setAttribute?.('data-sequence-hover-tooltip', 'map');
    node.hidden = true;
    rootDocument.body.appendChild(node);
    interactivity = createHoverTooltipInteractivity(node, hideNow);
    node.addEventListener('click', (event) => {
      void (async () => {
        if (event.target?.closest?.('[data-sequence-protein-copy]')) {
          await copyProteinValueFromEvent(event);
          return;
        }
        const result = await copyPrimerValueFromEvent(event);
        if (!result.handled) {
          return;
        }
        showTransientNotice(
          (((((result.copied ? i18nUi.message("Copied primer {p0}.", { p0: result.kind === 'name' ? 'name' : 'sequence' }) : i18nUi.message("Clipboard access is unavailable.")))))),
          { type: result.copied ? 'success' : 'error' }
        );
      })();
    });
    return node;
  }

  function hideNow() {
    if (interactivity) {
      interactivity.reset();
    }
    if (node) {
      node.hidden = true;
    }
  }

  function hide() {
    if (!interactivity) {
      hideNow();
      return;
    }
    interactivity.requestHide();
  }

  function show(text, detailHtml, event) {
    const element = ensureNode();
    if (!element) {
      return;
    }
    const contentKey = text + detailHtml;
    if (interactivity?.shouldPreserve(event, contentKey)) return;
    interactivity?.cancelHide();
    rootDocument?.querySelectorAll?.('[data-sequence-hover-tooltip]').forEach(node => {
      if (node !== element) node.hidden = true;
    });
    const hasPrimerCard = detailHtml.includes('sequence-viewer-primer-hover-card');
    if (detailHtml) {
      i18nUi.setHtml(element, hasPrimerCard ? detailHtml : `<span class="vector-map__tooltip-title">${escapeHtml(text)}</span>${detailHtml}`);
    } else {
      i18nUi.setText(element, text);
    }
    element.classList?.toggle('has-protein-properties', detailHtml.includes('sequence-viewer-protein-hover'));
    interactivity?.setInteractive(/data-sequence-(?:(?:primer|protein)-copy=|digest-action=)/.test(detailHtml));
    interactivity?.anchor(event, contentKey);
    element.hidden = false;

    // Flip to the other side of the cursor rather than letting the readout run
    // off the edge of the window.
    const viewWidth = Number(globalThis?.innerWidth) || 0;
    const viewHeight = Number(globalThis?.innerHeight) || 0;
    const width = Number(element.offsetWidth) || 0;
    const height = Number(element.offsetHeight) || 0;
    const { clientX, clientY } = event;
    let left = clientX + POINTER_OFFSET_PX;
    let top = clientY + POINTER_OFFSET_PX;
    if (viewWidth && left + width > viewWidth - 8) {
      left = Math.max(8, clientX - width - POINTER_OFFSET_PX);
    }
    if (viewHeight && top + height > viewHeight - 8) {
      top = Math.max(8, clientY - height - POINTER_OFFSET_PX);
    }
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  function readLabel(target) {
    return String(target?.getAttribute?.('aria-label') || '').trim();
  }

  function bind() {
    const host = resolveHost();
    if (!host?.addEventListener) {
      return;
    }

    function showFeatureReadout(event) {
      const trigger = event.target?.closest?.('[data-feature-index]') || null;
      const label = trigger ? readLabel(trigger) : '';
      if (!label) {
        hide();
        return;
      }
      const feature = getFeature(Number(trigger.dataset.featureIndex));
      const sequence = getSequence();
      const detailHtml = renderPrimerHoverSection(feature, sequence, { allowLibrarySave: Boolean(config.allowLibrarySave), allowPcr: Boolean(config.allowPcr) }) + renderCdsProteinHoverSection(feature, sequence)
        + (config.allowDigestion ? renderDigestionActions(feature) : '');
      const rect = event.type === 'focusin' ? trigger.getBoundingClientRect?.() : null;
      show(label, detailHtml, rect ? { type: event.type, clientX: rect.left, clientY: rect.bottom } : event);
    }

    host.addEventListener('mousemove', showFeatureReadout);
    host.addEventListener('focusin', showFeatureReadout);
    host.addEventListener('focusout', (event) => {
      if (!node?.contains?.(event.relatedTarget)) hideNow();
    });

    host.addEventListener('mouseleave', hide);
    // Zooming and panning move the map out from under the pointer.
    host.addEventListener('wheel', hideNow, { passive: true });
    host.addEventListener('scroll', hideNow, { passive: true });
    host.addEventListener('mousedown', hideNow);
  }

  return { bind, hide: hideNow };
}
