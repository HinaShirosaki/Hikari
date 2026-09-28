import { cleanNucleotideSequence } from '../sequence-viewer/calculations/sequence.js';
import { oligoExtinction, oligoMolecularWeight } from '../sequence-viewer/calculations/oligo.js';
import { cleanSequence, countResidues } from '../sequence-viewer/calculations/protein.js';

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
        extinctionResult.innerHTML = '<p class="small-note">Enter a protein sequence.</p>';
        return;
      }

      const counts = countResidues(sequence);
      const trp = counts.W || 0;
      const tyr = counts.Y || 0;
      const cys = counts.C || 0;
      const reduced = (5500 * trp) + (1490 * tyr);
      const oxidized = reduced + (125 * Math.floor(cys / 2));

      extinctionResult.innerHTML = `
        <p><strong>Sequence length:</strong> ${sequence.length} aa</p>
        <p><strong>Reduced extinction (280 nm):</strong> ${reduced} M^-1 cm^-1</p>
        <p><strong>Oxidized extinction (280 nm):</strong> ${oxidized} M^-1 cm^-1</p>
        <p><strong>Counts:</strong> W:${trp} Y:${tyr} C:${cys}</p>
      `;
      return;
    }

    const sequence = cleanNucleotideSequence(raw, type);
    if (!sequence.length) {
      extinctionResult.innerHTML = '<p class="small-note">Enter a nucleotide sequence.</p>';
      return;
    }

    const ext = oligoExtinction(sequence, type);
    const mw = oligoMolecularWeight(sequence, type);
    const ugPerMlA260 = ext > 0 ? (mw * 1000) / ext : 0;

    extinctionResult.innerHTML = `
      <p><strong>Type:</strong> ${type}</p>
      <p><strong>Length:</strong> ${sequence.length} nt</p>
      <p><strong>Extinction coefficient (260 nm):</strong> ${ext.toFixed(0)} M^-1 cm^-1</p>
      <p><strong>A260 conversion:</strong> 1 A260 ~= ${ugPerMlA260.toFixed(2)} ug/mL</p>
    `;
  }

  extinctionForm.addEventListener('input', renderExtinction);
  extinctionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderExtinction();
  });

  renderExtinction();
}
