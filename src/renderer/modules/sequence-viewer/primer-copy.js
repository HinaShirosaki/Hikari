import { escapeHtml } from '../../lib/html.js';
import { cleanText } from './shared.js';

const COPY_ICON_MARKUP = `
  <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
    <rect x="8" y="8" width="11" height="11" rx="1.75"></rect>
    <path d="M5 16V6.75A1.75 1.75 0 0 1 6.75 5H16"></path>
  </svg>
`;

function normalizeCopyValue(value) {
  return cleanText(value, 12000);
}

export function renderPrimerCopyButton(value, kind = 'value', label = 'primer value') {
  const copyValue = normalizeCopyValue(value);
  if (!copyValue) {
    return '';
  }

  const safeKind = cleanText(kind, 80) || 'value';
  const safeLabel = cleanText(label, 160) || 'primer value';
  return `
    <button
      type="button"
      class="sequence-viewer-primer-copy-btn"
      data-sequence-primer-copy="${escapeHtml(copyValue)}"
      data-sequence-primer-copy-kind="${escapeHtml(safeKind)}"
      title="Copy ${escapeHtml(safeLabel)}"
      aria-label="Copy ${escapeHtml(safeLabel)}"
    >
      ${COPY_ICON_MARKUP}
    </button>
  `;
}

async function copyPrimerValueFromEvent(event, options = {}) {
  const trigger = event?.target?.closest?.('[data-sequence-primer-copy]') || null;
  if (!trigger) {
    return {
      handled: false,
      copied: false,
      kind: '',
      value: ''
    };
  }

  event.preventDefault?.();
  event.stopPropagation?.();

  const value = normalizeCopyValue(trigger?.dataset?.sequencePrimerCopy);
  const kind = cleanText(trigger?.dataset?.sequencePrimerCopyKind, 80) || 'value';
  if (!value) {
    return {
      handled: true,
      copied: false,
      kind,
      value
    };
  }

  const clipboard = options?.navigatorRef?.clipboard || globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) {
    return {
      handled: true,
      copied: false,
      kind,
      value
    };
  }

  try {
    await clipboard.writeText(value);
    return {
      handled: true,
      copied: true,
      kind,
      value
    };
  } catch {
    return {
      handled: true,
      copied: false,
      kind,
      value
    };
  }
}

export {
  copyPrimerValueFromEvent
};
