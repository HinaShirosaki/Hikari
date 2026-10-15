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

function renderLibrarySaveButton(feature, sequence) {
  return `<button type="button" class="sequence-viewer-primer-library-save-btn" data-sequence-primer-library-save data-primer-name="${escapeHtml(feature?.name || 'Primer')}" data-primer-sequence="${escapeHtml(sequence)}" title="Save to Primer Library" aria-label="Save to Primer Library">
    <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
      <path d="M5 5.5h11L19 8.5v10h-14Z"></path>
      <path d="M8.5 5.5h7v4h-7Z"></path>
      <path d="M8 12.5h8v6h-8Z"></path>
    </svg>
  </button>`;
}

// One primer card shared by DNA tracks and maps, with actions beside their values.
export function renderPrimerHoverSection(feature, recordSequence = '', { allowLibrarySave = false } = {}) {
  if (!isPrimerBindingFeature(feature?.type)) {
    return '';
  }
  const sequence = primerFeatureSequence(feature, recordSequence);
  if (!sequence) {
    return '';
  }
  return `
    <div class="sequence-viewer-primer-hover-card">
      <div class="sequence-viewer-primer-hover-head">
        <div class="sequence-viewer-primer-hover-title">${escapeHtml(feature?.name || 'Primer')}</div>
        <div class="sequence-viewer-primer-hover-buttons">
          ${renderPrimerNameCopyButton(feature)}
          ${allowLibrarySave ? renderLibrarySaveButton(feature, sequence) : ''}
        </div>
      </div>
      <div class="sequence-viewer-primer-hover">
        <div class="sequence-viewer-primer-hover-actions">
          <span class="sequence-viewer-primer-hover-meta">${sequence.length.toLocaleString()} nt</span>
          ${renderPrimerCopyButton(sequence, 'sequence', 'primer sequence')}
        </div>
        <code class="sequence-viewer-primer-hover-seq">${escapeHtml(sequence)}</code>
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
  node?.addEventListener?.('focusin', cancelHide);
  node?.addEventListener?.('focusout', (event) => {
    if (!node.contains?.(event.relatedTarget)) hideNow();
  });

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
