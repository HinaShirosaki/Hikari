import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("tools");
import { cleanSequence, peptideStats, residueSummary } from '../sequence-viewer/calculations/protein.js';
import { toolMessage } from './localization.js';

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
      i18nUi.setHtml(peptideResult, `<p class="small-note">${toolMessage('peptide.empty')}</p>`);
      return;
    }

    const stats = peptideStats(sequence);
    const countsText = residueSummary(stats.counts);

    i18nUi.setHtml(peptideResult, `
      <p><strong>${toolMessage('result.length')}</strong> ${stats.length} aa</p>
      <p><strong>${toolMessage('result.weight')}</strong> ${stats.mass.toFixed(2)} Da</p>
      <p><strong>${toolMessage('result.pi')}</strong> ${stats.pI.toFixed(2)}</p>
      <p><strong>${toolMessage('result.charge')}</strong> ${stats.netCharge7.toFixed(2)}</p>
      <p><strong>${toolMessage('result.reduced280')}</strong> ${stats.extinctionReduced} M^-1 cm^-1</p>
      <p><strong>${toolMessage('result.oxidized280')}</strong> ${stats.extinctionOxidized} M^-1 cm^-1</p>
      <p><strong>${toolMessage('result.residueCounts')}</strong> ${countsText || toolMessage('result.na')}</p>
    `);

    if (stats.invalidResidues.length) {
      peptideResult.innerHTML += `<p class="small-note">${toolMessage('peptide.invalid')}</p>`;
    }
  }

  peptideForm.addEventListener('input', renderPeptide);
  peptideForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderPeptide();
  });

  renderPeptide();
}
