import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("tools");
import { cleanNucleotideSequence, nucleotideCounts } from '../sequence-viewer/calculations/sequence.js';
import { oligoExtinction, oligoMolecularWeight, oligoTm } from '../sequence-viewer/calculations/oligo.js';
import { toolMessage } from './localization.js';

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
      i18nUi.setHtml(oligoResult, `<p class="small-note">${toolMessage('oligo.empty')}</p>`);
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

    i18nUi.setHtml(oligoResult, `
      <p><strong>${toolMessage('result.type')}</strong> ${type}</p>
      <p><strong>${toolMessage('result.length')}</strong> ${length} nt</p>
      <p><strong>${toolMessage('result.gc')}</strong> ${gcPercent.toFixed(2)}%</p>
      <p><strong>${toolMessage('result.tm')}</strong> ${tm.toFixed(2)} C</p>
      <p><strong>${toolMessage('result.approxWeight')}</strong> ${mw.toFixed(2)} ${i18nUi.html("g/mol")}</p>
      <p><strong>${toolMessage('result.extinction260')}</strong> ${ext.toFixed(0)} M^-1 cm^-1</p>
      <p><strong>${toolMessage('result.a260')}</strong> 1 A260 ~= ${ugPerMlA260.toFixed(2)} ug/mL</p>
      <p><strong>${toolMessage('result.baseCounts')}</strong> ${countsText}</p>
    `);
  }

  oligoForm.addEventListener('input', renderOligo);
  oligoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderOligo();
  });

  renderOligo();
}
