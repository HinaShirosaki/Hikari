import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("tools");
import { cleanNucleotideSequence } from '../sequence-viewer/calculations/sequence.js';
import { oligoExtinction, oligoMolecularWeight } from '../sequence-viewer/calculations/oligo.js';
import { cleanSequence, countResidues } from '../sequence-viewer/calculations/protein.js';
import { toolMessage } from './localization.js';

export function initExtinctionTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const extinctionForm = rootDocument.getElementById('extinction-form');
  const extinctionResult = rootDocument.getElementById('extinction-result');
  if (!extinctionForm || !extinctionResult) {
    return;
  }

  function renderExtinction() {
    const type = rootDocument.getElementById('extinction-type')?.value;
    const raw = rootDocument.getElementById('extinction-sequence')?.value;

    if (type === 'protein') {
      const sequence = cleanSequence(raw);
      if (!sequence.length) {
        i18nUi.setHtml(extinctionResult, `<p class="small-note">${toolMessage('extinction.proteinEmpty')}</p>`);
        return;
      }

      const counts = countResidues(sequence);
      const trp = counts.W || 0;
      const tyr = counts.Y || 0;
      const cys = counts.C || 0;
      // Pace et al. (1995) coefficients at 280 nm: Trp 5500, Tyr 1490, and
      // 125 per disulfide (cystine) for the oxidized form.
      const reduced = (5500 * trp) + (1490 * tyr);
      const oxidized = reduced + (125 * Math.floor(cys / 2));

      i18nUi.setHtml(extinctionResult, `
        <p><strong>${toolMessage('result.sequenceLength')}</strong> ${sequence.length} aa</p>
        <p><strong>${toolMessage('result.reduced')}</strong> ${reduced} M^-1 cm^-1</p>
        <p><strong>${toolMessage('result.oxidized')}</strong> ${oxidized} M^-1 cm^-1</p>
        <p><strong>${toolMessage('result.counts')}</strong> W:${trp} Y:${tyr} C:${cys}</p>
      `);
      return;
    }

    const sequence = cleanNucleotideSequence(raw, type);
    if (!sequence.length) {
      i18nUi.setHtml(extinctionResult, `<p class="small-note">${toolMessage('extinction.nucleotideEmpty')}</p>`);
      return;
    }

    const ext = oligoExtinction(sequence, type);
    const mw = oligoMolecularWeight(sequence, type);
    const ugPerMlA260 = ext > 0 ? (mw * 1000) / ext : 0;

    i18nUi.setHtml(extinctionResult, `
      <p><strong>${toolMessage('result.type')}</strong> ${type}</p>
      <p><strong>${toolMessage('result.length')}</strong> ${sequence.length} nt</p>
      <p><strong>${toolMessage('result.extinction260')}</strong> ${ext.toFixed(0)} M^-1 cm^-1</p>
      <p><strong>${toolMessage('result.a260')}</strong> 1 A260 ~= ${ugPerMlA260.toFixed(2)} ug/mL</p>
    `);
  }

  extinctionForm.addEventListener('input', renderExtinction);
  extinctionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderExtinction();
  });

  renderExtinction();
}
