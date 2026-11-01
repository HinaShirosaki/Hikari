import { createPresentation } from '../../lib/i18n/presentation.js';
import './localization.js';
import { escapeHtml } from '../../lib/html.js';
import { showTransientNotice } from '../../lib/notify.js';

const i18nUi = createPresentation('dna');

export function renderProteinCopyButton(value, kind) {
  if (value == null || value === '') return '';
  const label = kind === 'sequence'
    ? i18nUi.message('Copy amino acid sequence')
    : kind === 'mw' ? i18nUi.message('Copy molecular weight (Da)') : i18nUi.message('Copy pI');
  return `<button type="button" class="sequence-viewer-protein-copy-btn"
    data-sequence-protein-copy="${escapeHtml(String(value))}" data-sequence-protein-copy-kind="${escapeHtml(kind)}"
    ${i18nUi.attributeMessage('title', label)} ${i18nUi.attributeMessage('aria-label', label)}>
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="8" y="8" width="11" height="11" rx="1.75"></rect>
      <path d="M5 16V6.75A1.75 1.75 0 0 1 6.75 5H16"></path>
    </svg>
  </button>`;
}

// Protein sequences can exceed the primer copy limit. Preserve every residue;
// display grouping and scrolling must never change the clipboard value.
export async function copyProteinValueFromEvent(event, { navigatorRef = globalThis.navigator } = {}) {
  const button = event?.target?.closest?.('[data-sequence-protein-copy]');
  if (!button) return { handled: false, copied: false };
  event.preventDefault?.();
  event.stopPropagation?.();
  const value = String(button.dataset.sequenceProteinCopy || '');
  const kind = button.dataset.sequenceProteinCopyKind;
  let copied = false;
  try {
    if (value && navigatorRef?.clipboard?.writeText) {
      await navigatorRef.clipboard.writeText(value);
      copied = true;
    }
  } catch { /* Keep the readout available for manual selection or another try. */ }
  showTransientNotice(copied
    ? kind === 'sequence' ? i18nUi.message('Amino acid sequence copied.')
      : kind === 'mw' ? i18nUi.message('Molecular weight copied in Da.') : i18nUi.message('pI copied.')
    : i18nUi.message('Clipboard access is unavailable.'), { type: copied ? 'success' : 'error' });
  return { handled: true, copied, kind, value };
}
