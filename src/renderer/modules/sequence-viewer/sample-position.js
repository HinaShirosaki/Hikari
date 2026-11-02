import { createQuickSampleController } from '../../lib/quick-sample-controller.js';
import { escapeHtml } from '../../lib/html.js';
import { dnaAttributes } from './localization.js';

export function samplePositionButtonHtml(attribute, id) {
  return `<button type="button" class="sequence-viewer-sample-position-btn" ${attribute}="${escapeHtml(id)}"
    ${dnaAttributes({ title: 'ui.recordSamplePosition', 'aria-label': 'ui.recordSamplePosition' })} aria-haspopup="dialog">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/>
      <circle cx="12" cy="10" r="2.5"/>
    </svg>
  </button>`;
}

export function createSequenceSamplePositionController({ rootDocument, appState = {}, persist, createId } = {}) {
  const overlay = rootDocument?.getElementById('sequence-viewer-quick-sample-overlay');
  // The home rail and primer library also open this picker outside the detail view.
  if (overlay && rootDocument?.body) rootDocument.body.appendChild(overlay);
  const picker = createQuickSampleController({
    doc: rootDocument,
    state: appState,
    safeText: escapeHtml,
    createId,
    idPrefix: 'sequence-viewer-quick-sample',
    onCreated: async () => { await persist?.({ label: 'Record sample position' }); }
  });

  return {
    openSequence(entry) {
      if (entry) picker.open({ name: entry.name, type: 'dna' });
    },
    openPrimer(primer) {
      if (primer) picker.open({
        name: primer.name,
        type: 'primer',
        details: { sequence: primer.sequence, target: primer.sourceName || '' }
      });
    }
  };
}
