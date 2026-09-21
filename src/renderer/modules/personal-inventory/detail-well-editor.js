import { renderTypeFieldsMarkup } from '../sample-registry/type-fields.js';

export function createWellEditorRenderer({
  safeText,
  uiState,
  helpers,
  renderStructureAction
}) {
  const {
    getLinkedSamples,
    renderSampleTypeOptions,
    getWellDataForType
  } = helpers;

  function renderWellEditor(section, container, index) {
    if (!Number.isInteger(index) || index < 0) {
      return `
        <div class="well-inline-editor well-side-editor">
          <p class="small-note well-editor-empty">Select one cell to edit well and sample information.</p>
        </div>
      `;
    }

    const well = getWellDataForType(container, container.wells[index], index);
    const linkedSamples = getLinkedSamples(section, container.id, index);
    const activeSample = linkedSamples.find((item) => item.id === uiState.editingSampleId) || null;
    const statusMarkup = uiState.wellEditorStatus ? `<p class="small-note well-editor-status">${safeText(uiState.wellEditorStatus)}</p>` : '';
    const sampleSelector = linkedSamples.length > 1
      ? `
        <label>
          Linked Sample
          <select data-well-sample-select="${index}">
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
            <strong>${safeText(well.name)} (Cell ${index + 1})</strong>
            <strong>Set Samples</strong>
          </div>
          <div class="well-editor-actions">
            <button type="button" class="primary-btn inventory-sample-editor-icon-btn" data-well-sample-save="${safeText(activeSample.id)}" aria-label="Save Sample" data-hover-caption="Save sample">
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M5 3h12l3 3v15H4V3Z"></path>
                <path d="M8 3v6h8V3"></path>
                <path d="M8 21v-7h8v7"></path>
              </svg>
              <span class="sr-only">Save Sample</span>
            </button>
            <button type="button" class="ghost-btn inventory-sample-editor-icon-btn" data-well-sample-unlink="${safeText(activeSample.id)}" aria-label="Delete Sample" data-hover-caption="Delete sample">
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
          <input data-well-sample-code value="${safeText(activeSample.code || '')}" placeholder="e.g. S-001" />
        </label>
        <label>
          Sample Name
          <input data-well-sample-name value="${safeText(activeSample.name || '')}" required />
        </label>
        <label>
          Type
          <select data-well-sample-type>
            ${renderSampleTypeOptions(activeSample.type || 'plasmid')}
          </select>
        </label>
        <div data-sample-type-fields>${renderTypeFieldsMarkup(activeSample.type, activeSample.details)}</div>
        ${renderStructureAction({ mode: 'well-existing', sample: activeSample })}
        <label>
          Lot / Batch
          <input data-well-sample-lot value="${safeText(activeSample.lot || '')}" />
        </label>
        <label>
          Concentration
          <input data-well-sample-concentration value="${safeText(activeSample.concentration || '')}" placeholder="e.g. 2 mg/mL" />
        </label>
        <label>
          Notes
          <textarea data-well-sample-notes rows="3">${safeText(activeSample.notes || '')}</textarea>
        </label>
      `
      : `
        <div class="well-editor-head">
          <div class="well-editor-title-group">
            <strong>${safeText(well.name)} (Cell ${index + 1})</strong>
            <strong>Set Samples</strong>
          </div>
          <div class="well-editor-actions">
            <button type="button" class="primary-btn inventory-add-sample-icon-btn" data-well-sample-create="${index}" aria-label="Add Sample" data-hover-caption="Add sample">
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M5.5 4h7M7 4v5l-2.6 6.4A3.2 3.2 0 0 0 7.4 20h2.2a3.2 3.2 0 0 0 3-4.4L10 9V4"></path>
                <path d="M14 14.5h6M17 11.5v6"></path>
              </svg>
              <span class="sr-only">Add Sample</span>
            </button>
          </div>
        </div>
        <label>
          Sample Code
          <input data-well-sample-new-code placeholder="e.g. S-001" />
        </label>
        <label>
          Sample Name
          <input data-well-sample-new-name placeholder="Required" />
        </label>
        <label>
          Type
          <select data-well-sample-new-type>
            ${renderSampleTypeOptions('plasmid')}
          </select>
        </label>
        <div data-sample-type-fields>${renderTypeFieldsMarkup('plasmid')}</div>
        ${renderStructureAction({ mode: 'well-new' })}
        <label>
          Lot / Batch
          <input data-well-sample-new-lot />
        </label>
        <label>
          Concentration
          <input data-well-sample-new-concentration placeholder="e.g. 2 mg/mL" />
        </label>
        <label>
          Notes
          <textarea data-well-sample-new-notes rows="3"></textarea>
        </label>
      `;

    return `<div class="well-inline-editor well-side-editor">${sampleSection}${statusMarkup}</div>`;
  }

  return {
    renderWellEditor
  };
}
