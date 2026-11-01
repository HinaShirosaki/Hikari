import { createQuickSampleController } from '../../lib/quick-sample-controller.js';
import { escapeHtml } from '../../lib/html.js';
import { dnaAttributes } from './localization.js';

export function samplePositionButtonHtml(attribute, id) {
  return `<button type="button" class="sequence-viewer-sample-position-btn" ${attribute}="${escapeHtml(id)}"
    ${dnaAttributes({ title: 'ui.recordSamplePosition', 'aria-label': 'ui.recordSamplePosition' })} aria-haspopup="dialog">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5.5 4h7M7 4v5l-2.6 6.4A3.2 3.2 0 0 0 7.4 20h2.2a3.2 3.2 0 0 0 3-4.4L10 9V4M14 14.5h6M17 11.5v6"/>
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
      if (entry) picker.open({ name: entry.name, type: 'plasmid' });
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
