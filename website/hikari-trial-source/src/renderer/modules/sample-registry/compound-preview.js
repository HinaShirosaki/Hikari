import { normalizeCompoundStructureData } from './compound-model.js';
import { escapeHtml } from './sample-utils.js';

export function renderCompoundPreviewMarkup(structure, label, safeText) {
  const normalized = normalizeCompoundStructureData(structure);
  if (!normalized) {
    return `
      <section class="sample-compound-structure-card">
        <h4>Structure Snapshot</h4>
        <p class="small-note">No structure has been saved for this chemical yet.</p>
      </section>
    `;
  }

  const imageMarkup = normalized.imageDataUrl
    ? `
      <div class="sample-compound-structure-preview">
        <img src="${escapeHtml(normalized.imageDataUrl)}" alt="${escapeHtml(`${label} structure preview`)}" />
      </div>
    `
    : '<p class="small-note">Structure saved without an image preview.</p>';

  const smilesMarkup = normalized.smiles
    ? `<p><strong>SMILES:</strong> ${safeText(normalized.smiles)}</p>`
    : '';

  return `
    <section class="sample-compound-structure-card">
      <h4>Structure Snapshot</h4>
      ${imageMarkup}
      ${smilesMarkup}
    </section>
  `;
}
