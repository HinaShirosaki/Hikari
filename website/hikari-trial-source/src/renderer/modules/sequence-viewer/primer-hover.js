import { escapeHtml } from '../../lib/html.js';
import { isPrimerBindingFeature } from './feature-types.js';
import { renderPrimerCopyButton } from './primer-copy.js';
import { normalizeSequenceText, reverseComplementIupac } from './shared.js';

// Hovering a primer binding site should answer the only question worth asking of
// one: what do I order? The designed oligo is carried on the feature; an
// imported primer_bind feature only has its footprint, so that gets read back
// off the record.

const HIDE_GRACE_MS = 500;

export function primerFeatureSequence(feature, recordSequence = '') {
  const stored = normalizeSequenceText(feature?.primerSequence || '');
  if (stored) {
    return stored;
  }
  const sequence = String(recordSequence || '');
  if (!sequence.length) {
    return '';
  }
  const joined = (Array.isArray(feature?.segments) ? [...feature.segments] : [])
    .map((segment) => ({
      start: Math.max(0, Math.round(Number(segment?.start) || 0)),
      end: Math.max(0, Math.round(Number(segment?.end) || 0))
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => left.start - right.start)
    .map((segment) => sequence.slice(segment.start, segment.end))
    .join('');
  const normalized = normalizeSequenceText(joined);
  return Number(feature?.strand) === -1 ? reverseComplementIupac(normalized) : normalized;
}

// The primer's name is what an order sheet or a lab notebook needs next to the
// oligo, so it gets its own copy button, or '' for anything that is not a primer.
export function renderPrimerNameCopyButton(feature) {
  if (!isPrimerBindingFeature(feature?.type)) {
    return '';
  }
  return renderPrimerCopyButton(feature?.name, 'name', 'primer name');
}

// The sequence plus its copy button, or '' for anything that is not a primer.
export function renderPrimerHoverSection(feature, recordSequence = '') {
  if (!isPrimerBindingFeature(feature?.type)) {
    return '';
  }
  const sequence = primerFeatureSequence(feature, recordSequence);
  if (!sequence) {
    return '';
  }
  return `
    <div class="sequence-viewer-primer-hover">
      <code class="sequence-viewer-primer-hover-seq">${escapeHtml(sequence)}</code>
      <div class="sequence-viewer-primer-hover-actions">
        <span class="sequence-viewer-primer-hover-meta">${sequence.length.toLocaleString()} nt</span>
        ${renderPrimerCopyButton(sequence, 'sequence', 'primer sequence')}
      </div>
    </div>
  `;
}

// A hover readout must never sit between the pointer and what it describes, so
// it stays click-through until it carries a copy button the user has to reach.
// Then hiding waits a moment, long enough to cross the gap to it.
export function createHoverTooltipInteractivity(node, hide) {
  let hideTimer = 0;
  let interactive = false;

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
  }

  function hideNow() {
    cancelHide();
    hide();
  }

  node?.addEventListener?.('mouseenter', cancelHide);
  node?.addEventListener?.('mouseleave', hideNow);

  return {
    cancelHide,
    setInteractive(next) {
      interactive = Boolean(next);
      node?.classList?.toggle?.('is-interactive', interactive);
    },
    // Immediate for a plain readout; deferred once the pointer has somewhere to go.
    requestHide() {
      if (!interactive) {
        hideNow();
        return;
      }
      cancelHide();
      hideTimer = setTimeout(hideNow, HIDE_GRACE_MS);
    }
  };
}
