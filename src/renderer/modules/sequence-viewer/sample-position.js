import { createQuickSampleController } from '../../lib/quick-sample-controller.js';
import { escapeHtml } from '../../lib/html.js';
import { dnaAttributes } from './localization.js';
import { normalizeTopology } from './shared.js';

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

  function openItem(item, kind, defaults) {
    const sourceLink = { kind, id: item.id };
    const samples = Array.isArray(appState.samples) ? appState.samples : [];
    const linked = samples.find(sample => sample?.sourceLink?.kind === kind && sample.sourceLink.id === item.id);
    // Samples recorded before library links existed can still be found by name
    // and, for primers, by sequence. Never reuse another item's explicit link.
    const existing = linked || samples.find(sample => !sample?.sourceLink
      && sample?.name === item.name
      && (kind === 'sequence-library'
        ? ['dna', 'plasmid', 'rna'].includes(sample.type)
        : sample.type === 'primer' && (!sample.details?.sequence || sample.details.sequence === item.sequence)));
    picker.open({
      ...defaults,
      ...existing,
      sampleId: existing?.id || '',
      sourceLink
    });
  }

  return {
    openSequence(entry) {
      if (entry) openItem(entry, 'sequence-library', {
        name: entry.name,
        type: normalizeTopology(entry.topology) === 'circular' ? 'plasmid' : 'dna'
      });
    },
    openPrimer(primer) {
      if (primer) openItem(primer, 'primer-library', {
        name: primer.name,
        type: 'primer',
        details: { sequence: primer.sequence, target: primer.sourceName || '' }
      });
    }
  };
}
