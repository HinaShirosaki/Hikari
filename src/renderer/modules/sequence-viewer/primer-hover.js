import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("dna");
import { escapeHtml } from '../../lib/html.js';
import { isPrimerBindingFeature } from './feature-types.js';
import { renderPrimerCopyButton } from './primer-copy.js';
import { normalizeSequenceText, reverseComplementIupac } from './shared.js';

// Hovering a primer binding site should answer the only question worth asking of
// one: what do I order? The designed oligo is carried on the feature; an
// imported primer_bind feature only has its footprint, so that gets read back
// off the record.

const HIDE_GRACE_MS = 500;
const POINTER_PATH_PADDING_PX = 6;

function pointerPosition(event) {
  const x = Number(event?.clientX);
  const y = Number(event?.clientY);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function pointInTriangle(point, a, b, c) {
  const cross = (start, end, target) => (end.x - start.x) * (target.y - start.y)
    - (end.y - start.y) * (target.x - start.x);
  if (Math.abs(cross(a, b, c)) < 0.001) return false;
  const sides = [cross(a, b, point), cross(b, c, point), cross(c, a, point)];
  return sides.every(side => side >= 0) || sides.every(side => side <= 0);
}

// Protect the path to every edge, including when the card flips at a window edge.
function pointerIsApproachingCard(point, origin, node) {
  const rect = node?.getBoundingClientRect?.();
  if (!point || !origin || !rect?.width || !rect?.height) return false;
  if (Math.hypot(point.x - origin.x, point.y - origin.y) < 0.1) return false;
  const left = rect.left - POINTER_PATH_PADDING_PX;
  const right = rect.left + rect.width + POINTER_PATH_PADDING_PX;
  const top = rect.top - POINTER_PATH_PADDING_PX;
  const bottom = rect.top + rect.height + POINTER_PATH_PADDING_PX;
  if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return true;
  const corners = [{ x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom }];
  return corners.some((corner, index) => pointInTriangle(point, origin, corner, corners[(index + 1) % 4]));
}

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
    // GenBank location order also preserves a primer crossing the origin.
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

export function renderPrimerPcrButton(feature) {
  if (!isPrimerBindingFeature(feature?.type)) return '';
  // Carry the identity of the site, including its coordinates, rather than
  // treating two copies of the same oligo as interchangeable.
  const site = { id: feature.id, name: feature.name, strand: feature.strand,
    segments: feature.segments, primerSequence: feature.primerSequence };
  return `<button type="button" class="ghost-btn sequence-viewer-primer-pcr-btn"
    data-sequence-primer-pcr="${escapeHtml(JSON.stringify(site))}" ${i18nUi.attribute('title', 'Create a PCR fragment')}>${i18nUi.html('PCR…')}</button>`;
}

function renderLibrarySaveButton(feature, sequence) {
  return `<button type="button" class="sequence-viewer-primer-library-save-btn" data-sequence-primer-library-save data-primer-name="${escapeHtml(feature?.name || 'Primer')}" data-primer-sequence="${escapeHtml(sequence)}" title="Save to Primer Library" aria-label="Save to Primer Library" data-i18n-aria-label="dna.full.fb552537" data-i18n-title="dna.full.fb552537">
    <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
      <path d="M5 5.5h11L19 8.5v10h-14Z"></path>
      <path d="M8.5 5.5h7v4h-7Z"></path>
      <path d="M8 12.5h8v6h-8Z"></path>
    </svg>
  </button>`;
}

// One primer card shared by DNA tracks and maps, with actions beside their values.
export function renderPrimerHoverSection(feature, recordSequence = '', { allowLibrarySave = false, allowPcr = false } = {}) {
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
        <div class="sequence-viewer-primer-hover-title">${i18nUi.render((feature?.name || i18nUi.message("Primer")))}</div>
        <div class="sequence-viewer-primer-hover-buttons">
          ${renderPrimerNameCopyButton(feature)}
          ${allowLibrarySave ? renderLibrarySaveButton(feature, sequence) : ''}
          ${allowPcr ? renderPrimerPcrButton(feature) : ''}
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
// Keep an actionable card still and protect the path into it: dense neighboring
// features must not replace it while the pointer is on its way to Copy.
export function createHoverTooltipInteractivity(node, hide) {
  let hideTimer = 0;
  let interactive = false;
  let origin = null;
  let contentKey = null;
  let pointerInside = false;
  let focusInside = false;

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
  }

  function hideNow() {
    reset();
    hide();
  }

  function reset() {
    cancelHide();
    origin = null;
    contentKey = null;
    pointerInside = false;
    focusInside = false;
  }

  node?.addEventListener?.('mouseenter', () => {
    pointerInside = true;
    cancelHide();
  });
  node?.addEventListener?.('mouseleave', () => {
    pointerInside = false;
    hideNow();
  });
  node?.addEventListener?.('focusin', () => {
    focusInside = true;
    cancelHide();
  });
  node?.addEventListener?.('focusout', (event) => {
    focusInside = Boolean(node.contains?.(event.relatedTarget));
    if (!focusInside && !pointerInside) hideNow();
  });

  return {
    cancelHide,
    reset,
    anchor(event, key) {
      origin = event?.type === 'focusin' ? null : pointerPosition(event);
      contentKey = key;
      pointerInside = false;
      focusInside = false;
    },
    shouldPreserve(event, key) {
      if (!interactive || node?.hidden || event?.type === 'focusin') return false;
      const point = pointerPosition(event);
      if (pointerInside || focusInside || (origin && key === contentKey)
        || pointerIsApproachingCard(point, origin, node)) {
        if (point && key === contentKey) origin = point;
        cancelHide();
        return true;
      }
      return false;
    },
    setInteractive(next) {
      interactive = Boolean(next);
      node?.classList?.toggle?.('is-interactive', interactive);
    },
    // Immediate for a plain readout; deferred once the pointer has somewhere to go.
    requestHide() {
      if (!node?.hidden && (pointerInside || focusInside)) return;
      if (!interactive) {
        hideNow();
        return;
      }
      cancelHide();
      hideTimer = setTimeout(hideNow, HIDE_GRACE_MS);
    }
  };
}
