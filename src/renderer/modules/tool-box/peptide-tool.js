import { cleanSequence, peptideStats, residueSummary } from '../sequence-viewer/calculations/protein.js';

export function initPeptideTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const peptideForm = rootDocument.getElementById('peptide-form');
  const peptideResult = rootDocument.getElementById('peptide-result');
  if (!peptideForm || !peptideResult) {
    return;
  }

  function renderPeptide() {
    const sequence = cleanSequence(rootDocument.getElementById('peptide-sequence')?.value);

    if (!sequence.length) {
      peptideResult.innerHTML = '<p class="small-note">Enter a peptide sequence to calculate properties.</p>';
      return;
    }

    const stats = peptideStats(sequence);
    const countsText = residueSummary(stats.counts);

    peptideResult.innerHTML = `
      <p><strong>Length:</strong> ${stats.length} aa</p>
      <p><strong>Molecular weight:</strong> ${stats.mass.toFixed(2)} Da</p>
      <p><strong>Estimated pI:</strong> ${stats.pI.toFixed(2)}</p>
      <p><strong>Estimated net charge (pH 7.0):</strong> ${stats.netCharge7.toFixed(2)}</p>
      <p><strong>Extinction coefficient 280 nm (reduced):</strong> ${stats.extinctionReduced} M^-1 cm^-1</p>
      <p><strong>Extinction coefficient 280 nm (oxidized):</strong> ${stats.extinctionOxidized} M^-1 cm^-1</p>
      <p><strong>Residue counts:</strong> ${countsText || 'N/A'}</p>
    `;

    if (stats.invalidResidues.length) {
      peptideResult.innerHTML += '<p class="small-note">Sequence includes non-standard residues. Their masses are treated as 0.</p>';
    }
  }

  peptideForm.addEventListener('input', renderPeptide);
  peptideForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderPeptide();
  });

  renderPeptide();
}
