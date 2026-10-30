import { sampleAttributes, sampleMessage, sampleStatusMarkup } from './localization.js';
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
    const editorTitle = sampleMessage('editor.single', { name: container.name });
    const statusMarkup = uiState.wellEditorStatus ? `<p class="small-note well-editor-status">${sampleStatusMarkup(uiState.wellEditorStatus)}</p>` : '';
    const sampleSelector = linkedSamples.length > 1
      ? `
        <label>
          ${sampleMessage('editor.linked')}
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
            <strong>${sampleMessage('editor.title')}</strong>
          </div>
          <div class="well-editor-actions">
            <button type="button" class="primary-btn inventory-sample-editor-icon-btn" data-single-sample-save="${safeText(activeSample.id)}" ${sampleAttributes({ 'aria-label': 'editor.save', 'data-hover-caption': 'editor.saveCaption' })}>
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M5 3h12l3 3v15H4V3Z"></path>
                <path d="M8 3v6h8V3"></path>
                <path d="M8 21v-7h8v7"></path>
              </svg>
              <span class="sr-only">${sampleMessage('editor.save')}</span>
            </button>
            <button type="button" class="ghost-btn inventory-sample-editor-icon-btn" data-single-sample-delete="${safeText(activeSample.id)}" ${sampleAttributes({ 'aria-label': 'editor.delete', 'data-hover-caption': 'editor.deleteCaption' })}>
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
          <input data-single-sample-code value="${safeText(activeSample.code || '')}" ${sampleAttributes({ placeholder: 'editor.codePlaceholder' })} />
        </label>
        <label>
          ${sampleMessage('editor.name')}
          <input data-single-sample-name value="${safeText(activeSample.name || '')}" required />
        </label>
        <label>
          ${sampleMessage('editor.type')}
          <select data-single-sample-type>${renderSampleTypeOptions(activeSample.type || 'plasmid')}</select>
        </label>
        <div data-sample-type-fields>${renderTypeFieldsMarkup(activeSample.type, activeSample.details)}</div>
        ${renderStructureAction({ mode: 'single-existing', sample: activeSample })}
        <label>
          ${sampleMessage('editor.lot')}
          <input data-single-sample-lot value="${safeText(activeSample.lot || '')}" />
        </label>
        <label>
          ${sampleMessage('editor.concentration')}
          <input data-single-sample-concentration value="${safeText(activeSample.concentration || '')}" ${sampleAttributes({ placeholder: 'editor.concentrationPlaceholder' })} />
        </label>
        <label>
          ${sampleMessage('editor.notes')}
          <textarea data-single-sample-notes rows="3">${safeText(activeSample.notes || '')}</textarea>
        </label>
      `
      : `
        <div class="well-editor-head">
          <div class="well-editor-title-group">
            <strong>${editorTitle}</strong>
            <strong>${sampleMessage('editor.title')}</strong>
          </div>
          <div class="well-editor-actions">
            <button type="button" class="lab-add-icon-btn inventory-add-sample-icon-btn" data-single-sample-create="true" ${sampleAttributes({ 'aria-label': 'editor.add', 'data-hover-caption': 'editor.addCaption' })}>
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M12 5v14M5 12h14"></path>
              </svg>
              <span class="sr-only">${sampleMessage('editor.add')}</span>
            </button>
          </div>
        </div>
        <label>
          ${sampleMessage('editor.code')}
          <input data-single-sample-new-code ${sampleAttributes({ placeholder: 'editor.codePlaceholder' })} />
        </label>
        <label>
          ${sampleMessage('editor.name')}
          <input data-single-sample-new-name ${sampleAttributes({ placeholder: 'editor.required' })} />
        </label>
        <label>
          ${sampleMessage('editor.type')}
          <select data-single-sample-new-type>${renderSampleTypeOptions('plasmid')}</select>
        </label>
        <div data-sample-type-fields>${renderTypeFieldsMarkup('plasmid')}</div>
        ${renderStructureAction({ mode: 'single-new' })}
        <label>
          ${sampleMessage('editor.lot')}
          <input data-single-sample-new-lot />
        </label>
        <label>
          ${sampleMessage('editor.concentration')}
          <input data-single-sample-new-concentration ${sampleAttributes({ placeholder: 'editor.concentrationPlaceholder' })} />
        </label>
        <label>
          ${sampleMessage('editor.notes')}
          <textarea data-single-sample-new-notes rows="3"></textarea>
        </label>
      `;

    return `<div class="well-inline-editor well-side-editor">${sampleSection}${statusMarkup}</div>`;
  }

  return {
    renderSingleContainerEditor
  };
}
