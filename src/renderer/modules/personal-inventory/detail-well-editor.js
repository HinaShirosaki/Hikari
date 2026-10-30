import { sampleAttributes, sampleMessage, sampleStatusMarkup } from './localization.js';
import { renderTypeFieldsMarkup } from './type-fields.js';

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
          <p class="small-note well-editor-empty">${sampleMessage('editor.selectWell')}</p>
        </div>
      `;
    }

    const well = getWellDataForType(container, container.wells[index], index);
    const linkedSamples = getLinkedSamples(section, container.id, index);
    const activeSample = linkedSamples.find((item) => item.id === uiState.editingSampleId) || null;
    const statusMarkup = uiState.wellEditorStatus ? `<p class="small-note well-editor-status">${sampleStatusMarkup(uiState.wellEditorStatus)}</p>` : '';
    const sampleSelector = linkedSamples.length > 1
      ? `
        <label>
          ${sampleMessage('editor.linked')}
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
            <strong>${sampleMessage('editor.well', { name: well.name, index: index + 1 })}</strong>
            <strong>${sampleMessage('editor.title')}</strong>
          </div>
          <div class="well-editor-actions">
            <button type="button" class="primary-btn inventory-sample-editor-icon-btn" data-well-sample-save="${safeText(activeSample.id)}" ${sampleAttributes({ 'aria-label': 'editor.save', 'data-hover-caption': 'editor.saveCaption' })}>
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M5 3h12l3 3v15H4V3Z"></path>
                <path d="M8 3v6h8V3"></path>
                <path d="M8 21v-7h8v7"></path>
              </svg>
              <span class="sr-only">${sampleMessage('editor.save')}</span>
            </button>
            <button type="button" class="ghost-btn inventory-sample-editor-icon-btn" data-well-sample-delete="${safeText(activeSample.id)}" ${sampleAttributes({ 'aria-label': 'editor.delete', 'data-hover-caption': 'editor.deleteCaption' })}>
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M3 6h18"></path>
                <path d="M8 6V4h8v2"></path>
                <path d="M19 6l-1 14H6L5 6"></path>
                <path d="M10 11v5"></path>
                <path d="M14 11v5"></path>
              </svg>
              <span class="sr-only">${sampleMessage('editor.delete')}</span>
            </button>
          </div>
        </div>
        ${sampleSelector}
        <label>
          ${sampleMessage('editor.code')}
          <input data-well-sample-code value="${safeText(activeSample.code || '')}" ${sampleAttributes({ placeholder: 'editor.codePlaceholder' })} />
        </label>
        <label>
          ${sampleMessage('editor.name')}
          <input data-well-sample-name value="${safeText(activeSample.name || '')}" required />
        </label>
        <label>
          ${sampleMessage('editor.type')}
          <select data-well-sample-type>
            ${renderSampleTypeOptions(activeSample.type || 'plasmid')}
          </select>
        </label>
        <div data-sample-type-fields>${renderTypeFieldsMarkup(activeSample.type, activeSample.details)}</div>
        ${renderStructureAction({ mode: 'well-existing', sample: activeSample })}
        <label>
          ${sampleMessage('editor.lot')}
          <input data-well-sample-lot value="${safeText(activeSample.lot || '')}" />
        </label>
        <label>
          ${sampleMessage('editor.concentration')}
          <input data-well-sample-concentration value="${safeText(activeSample.concentration || '')}" ${sampleAttributes({ placeholder: 'editor.concentrationPlaceholder' })} />
        </label>
        <label>
          ${sampleMessage('editor.notes')}
          <textarea data-well-sample-notes rows="3">${safeText(activeSample.notes || '')}</textarea>
        </label>
      `
      : `
        <div class="well-editor-head">
          <div class="well-editor-title-group">
            <strong>${sampleMessage('editor.well', { name: well.name, index: index + 1 })}</strong>
            <strong>${sampleMessage('editor.title')}</strong>
          </div>
          <div class="well-editor-actions">
            <button type="button" class="lab-add-icon-btn inventory-add-sample-icon-btn" data-well-sample-create="${index}" ${sampleAttributes({ 'aria-label': 'editor.add', 'data-hover-caption': 'editor.addCaption' })}>
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M12 5v14M5 12h14"></path>
              </svg>
              <span class="sr-only">${sampleMessage('editor.add')}</span>
            </button>
          </div>
        </div>
        <label>
          ${sampleMessage('editor.code')}
          <input data-well-sample-new-code ${sampleAttributes({ placeholder: 'editor.codePlaceholder' })} />
        </label>
        <label>
          ${sampleMessage('editor.name')}
          <input data-well-sample-new-name ${sampleAttributes({ placeholder: 'editor.required' })} />
        </label>
        <label>
          ${sampleMessage('editor.type')}
          <select data-well-sample-new-type>
            ${renderSampleTypeOptions('plasmid')}
          </select>
        </label>
        <div data-sample-type-fields>${renderTypeFieldsMarkup('plasmid')}</div>
        ${renderStructureAction({ mode: 'well-new' })}
        <label>
          ${sampleMessage('editor.lot')}
          <input data-well-sample-new-lot />
        </label>
        <label>
          ${sampleMessage('editor.concentration')}
          <input data-well-sample-new-concentration ${sampleAttributes({ placeholder: 'editor.concentrationPlaceholder' })} />
        </label>
        <label>
          ${sampleMessage('editor.notes')}
          <textarea data-well-sample-new-notes rows="3"></textarea>
        </label>
      `;

    return `<div class="well-inline-editor well-side-editor">${sampleSection}${statusMarkup}</div>`;
  }

  return {
    renderWellEditor
  };
}
