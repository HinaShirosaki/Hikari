import { cleanNucleotideSequence, nucleotideCounts } from '../sequence-viewer/calculations/sequence.js';
import { oligoExtinction, oligoMolecularWeight, oligoTm } from '../sequence-viewer/calculations/oligo.js';

export function initOligoTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const oligoForm = rootDocument.getElementById('oligo-form');
  const oligoResult = rootDocument.getElementById('oligo-result');
  if (!oligoForm || !oligoResult) {
    return;
  }

  function renderOligo() {
    const type = rootDocument.getElementById('oligo-type')?.value;
    const sequence = cleanNucleotideSequence(rootDocument.getElementById('oligo-sequence')?.value, type);
    if (!sequence.length) {
      oligoResult.innerHTML = '<p class="small-note">Enter an oligo sequence to calculate properties.</p>';
      return;
    }

    const counts = nucleotideCounts(sequence);
    const length = sequence.length;
    const gcCount = (counts.G || 0) + (counts.C || 0);
    const gcPercent = (gcCount / length) * 100;
    const tm = oligoTm(sequence, type);
    const mw = oligoMolecularWeight(sequence, type);
    const ext = oligoExtinction(sequence, type);
    const ugPerMlA260 = ext > 0 ? (mw * 1000) / ext : 0;
    const countsText = Object.keys(counts)
      .sort()
      .map((base) => `${base}:${counts[base]}`)
      .join('  ');

    oligoResult.innerHTML = `
      <p><strong>Type:</strong> ${type}</p>
      <p><strong>Length:</strong> ${length} nt</p>
      <p><strong>GC content:</strong> ${gcPercent.toFixed(2)}%</p>
      <p><strong>Approx Tm:</strong> ${tm.toFixed(2)} C</p>
      <p><strong>Approx molecular weight:</strong> ${mw.toFixed(2)} g/mol</p>
      <p><strong>Extinction coefficient (260 nm):</strong> ${ext.toFixed(0)} M^-1 cm^-1</p>
      <p><strong>A260 conversion:</strong> 1 A260 ~= ${ugPerMlA260.toFixed(2)} ug/mL</p>
      <p><strong>Base counts:</strong> ${countsText}</p>
    `;
  }

  oligoForm.addEventListener('input', renderOligo);
  oligoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderOligo();
  });

  renderOligo();
}
