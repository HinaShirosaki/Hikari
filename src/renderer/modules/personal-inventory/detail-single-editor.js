import { renderTypeFieldsMarkup } from './type-fields.js';

export function createSingleContainerEditorRenderer({
  safeText,
  uiState,
  helpers,
  renderStructureAction
}) {
  const {
    getLinkedSamples,
    renderSampleTypeOptions
  } = helpers;

  function renderSingleContainerEditor(section, container) {
    const linkedSamples = getLinkedSamples(section, container.id, null);
    const activeSample = linkedSamples.find((item) => item.id === uiState.editingSampleId) || linkedSamples[0] || null;
    const editorTitle = `${safeText(container.name)} (Single position)`;
    const statusMarkup = uiState.wellEditorStatus ? `<p class="small-note well-editor-status">${safeText(uiState.wellEditorStatus)}</p>` : '';
    const sampleSelector = linkedSamples.length > 1
      ? `
        <label>
          Linked Sample
          <select data-single-sample-select="true">
            ${linkedSamples.map((item) => `
              <option value="${safeText(item.id)}"${activeSample && item.id === activeSample.id ? ' selected' : ''}>
                ${safeText(item.code || item.name || item.id)}
              </option>
            `).join('')}
          </select>
        </label>
      `
      : '';
    const sampleSection = activeSample
      ? `
        <div class="well-editor-head">
          <div class="well-editor-title-group">
            <strong>${editorTitle}</strong>
            <strong>Set Samples</strong>
          </div>
          <div class="well-editor-actions">
            <button type="button" class="primary-btn inventory-sample-editor-icon-btn" data-single-sample-save="${safeText(activeSample.id)}" aria-label="Save Sample" data-hover-caption="Save sample">
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M5 3h12l3 3v15H4V3Z"></path>
                <path d="M8 3v6h8V3"></path>
                <path d="M8 21v-7h8v7"></path>
              </svg>
              <span class="sr-only">Save Sample</span>
            </button>
            <button type="button" class="ghost-btn inventory-sample-editor-icon-btn" data-single-sample-delete="${safeText(activeSample.id)}" aria-label="Delete Sample" data-hover-caption="Delete sample">
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M3 6h18"></path>
                <path d="M8 6V4h8v2"></path>
                <path d="M19 6l-1 14H6L5 6"></path>
                <path d="M10 11v5"></path>
                <path d="M14 11v5"></path>
              </svg>
              <span class="sr-only">Delete Sample</span>
            </button>
          </div>
        </div>
        ${sampleSelector}
        <label>
          Sample Code
          <input data-single-sample-code value="${safeText(activeSample.code || '')}" placeholder="e.g. S-001" />
        </label>
        <label>
          Sample Name
          <input data-single-sample-name value="${safeText(activeSample.name || '')}" required />
        </label>
        <label>
          Type
          <select data-single-sample-type>${renderSampleTypeOptions(activeSample.type || 'plasmid')}</select>
        </label>
        <div data-sample-type-fields>${renderTypeFieldsMarkup(activeSample.type, activeSample.details)}</div>
        ${renderStructureAction({ mode: 'single-existing', sample: activeSample })}
        <label>
          Lot / Batch
          <input data-single-sample-lot value="${safeText(activeSample.lot || '')}" />
        </label>
        <label>
          Concentration
          <input data-single-sample-concentration value="${safeText(activeSample.concentration || '')}" placeholder="e.g. 2 mg/mL" />
        </label>
        <label>
          Notes
          <textarea data-single-sample-notes rows="3">${safeText(activeSample.notes || '')}</textarea>
        </label>
      `
      : `
        <div class="well-editor-head">
          <div class="well-editor-title-group">
            <strong>${editorTitle}</strong>
            <strong>Set Samples</strong>
          </div>
          <div class="well-editor-actions">
            <button type="button" class="lab-add-icon-btn inventory-add-sample-icon-btn" data-single-sample-create="true" aria-label="Add Sample" data-hover-caption="Add sample">
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M12 5v14M5 12h14"></path>
              </svg>
              <span class="sr-only">Add Sample</span>
            </button>
          </div>
        </div>
        <label>
          Sample Code
          <input data-single-sample-new-code placeholder="e.g. S-001" />
        </label>
        <label>
          Sample Name
          <input data-single-sample-new-name placeholder="Required" />
        </label>
        <label>
          Type
          <select data-single-sample-new-type>${renderSampleTypeOptions('plasmid')}</select>
        </label>
        <div data-sample-type-fields>${renderTypeFieldsMarkup('plasmid')}</div>
        ${renderStructureAction({ mode: 'single-new' })}
        <label>
          Lot / Batch
          <input data-single-sample-new-lot />
        </label>
        <label>
          Concentration
          <input data-single-sample-new-concentration placeholder="e.g. 2 mg/mL" />
        </label>
        <label>
          Notes
          <textarea data-single-sample-new-notes rows="3"></textarea>
        </label>
      `;

    return `<div class="well-inline-editor well-side-editor">${sampleSection}${statusMarkup}</div>`;
  }

  return {
    renderSingleContainerEditor
  };
}
