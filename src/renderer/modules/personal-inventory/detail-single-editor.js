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
            <strong>Falcon Tube</strong>
            <strong>Set Samples</strong>
          </div>
          <div class="well-editor-actions">
            <button type="button" class="primary-btn" data-single-sample-save="${safeText(activeSample.id)}">Save Sample</button>
            <button type="button" class="ghost-btn" data-single-sample-unlink="${safeText(activeSample.id)}">Delete Sample</button>
          </div>
        </div>
        ${sampleSelector}
        <label><input data-single-sample-code value="${safeText(activeSample.code || '')}" placeholder="e.g. S-001" /></label>
        <label><input data-single-sample-name value="${safeText(activeSample.name || '')}" required /></label>
        <label><select data-single-sample-type>${renderSampleTypeOptions(activeSample.type || 'plasmid')}</select></label>
        ${renderStructureAction({ mode: 'single-existing', sample: activeSample })}
        <label><input data-single-sample-lot value="${safeText(activeSample.lot || '')}" /></label>
        <label><input data-single-sample-concentration value="${safeText(activeSample.concentration || '')}" placeholder="e.g. 2 mg/mL" /></label>
        <label><textarea data-single-sample-notes rows="3">${safeText(activeSample.notes || '')}</textarea></label>
      `
      : `
        <div class="well-editor-head">
          <div class="well-editor-title-group">
            <strong>Falcon Tube</strong>
            <strong>Set Samples</strong>
          </div>
          <div class="well-editor-actions">
            <button type="button" class="primary-btn" data-single-sample-create="true">Add Sample</button>
          </div>
        </div>
        <p class="small-note">No sample linked to this tube yet.</p>
        <label><input data-single-sample-new-code placeholder="e.g. S-001" /></label>
        <label><input data-single-sample-new-name placeholder="Required" /></label>
        <label><select data-single-sample-new-type>${renderSampleTypeOptions('plasmid')}</select></label>
        ${renderStructureAction({ mode: 'single-new' })}
        <label><input data-single-sample-new-lot /></label>
        <label><input data-single-sample-new-concentration placeholder="e.g. 2 mg/mL" /></label>
        <label><textarea data-single-sample-new-notes rows="3"></textarea></label>
      `;

    return `<div class="well-inline-editor well-side-editor">${sampleSection}${statusMarkup}</div>`;
  }

  return {
    renderSingleContainerEditor
  };
}
