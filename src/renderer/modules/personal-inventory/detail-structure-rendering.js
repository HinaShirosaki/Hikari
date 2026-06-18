export function createStructureRenderer({ safeText, getPendingStructureDraft }) {
  function hasStructure(sample) {
    const structure = sample?.compoundStructure;
    return Boolean(
      String(structure?.smiles || '').trim()
      || String(structure?.molfile || '').trim()
      || String(structure?.imageDataUrl || '').trim()
    );
  }

  function getStructureImageDataUrl(structure) {
    return String(structure?.imageDataUrl || '').trim();
  }

  function renderStructureAction({ mode, sample = null }) {
    const structure = sample?.compoundStructure || getPendingStructureDraft(mode);
    const imageDataUrl = getStructureImageDataUrl(structure);
    const hasCapturedStructure = sample ? hasStructure(sample) : Boolean(structure);
    const buttonText = hasCapturedStructure ? 'Replace Structure' : 'Paste Structure';
    const sampleId = sample?.id ? ` data-sample-id="${safeText(sample.id)}"` : '';
    return `
      <div class="inventory-sample-structure-control">
        <button
          type="button"
          class="ghost-btn inventory-sample-structure-paste-btn"
          data-inventory-sample-structure-paste="${safeText(mode)}"${sampleId}
          hidden
        >${safeText(buttonText)}</button>
        <div
          class="inventory-sample-structure-preview"
          data-inventory-sample-structure-preview="${safeText(mode)}"${sampleId}
          ${imageDataUrl ? '' : 'hidden'}
        >
          <img
            data-inventory-sample-structure-preview-image
            src="${safeText(imageDataUrl)}"
            alt="Chemical structure preview"
          />
        </div>
        <span class="small-note inventory-sample-structure-status" data-inventory-sample-structure-status></span>
      </div>
    `;
  }

  return {
    renderStructureAction
  };
}
