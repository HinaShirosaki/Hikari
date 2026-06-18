export function createWellEditorRenderer({
  safeText,
  uiState,
  helpers,
  renderStructureAction
}) {
  const {
    getLinkedSamples,
    getSavedSamplesForWellFill,
    getSampleTypeColor,
    getSampleTypeLabel,
    renderSampleTypeOptions,
    getWellDataForType
  } = helpers;

  function renderSavedSampleFillList(section, container, index) {
    const samples = typeof getSavedSamplesForWellFill === 'function'
      ? getSavedSamplesForWellFill({ section, containerId: container.id, wellIndex: index })
      : [];
    const sampleList = samples.length
      ? `
        <div class="well-saved-sample-list" aria-label="Saved samples">
          ${samples.map((sample) => {
            const label = sample.code || sample.name || sample.id;
            const name = sample.name && sample.name !== label ? sample.name : '';
            const typeLabel = getSampleTypeLabel(sample.type);
            const typeColor = getSampleTypeColor(sample.type);
            return `
              <button
                type="button"
                class="well-saved-sample-chip"
                draggable="true"
                data-saved-sample-drag="${safeText(sample.id)}"
                title="${safeText(`${label}${name ? ` - ${name}` : ''}`)}"
              >
                <span class="well-saved-sample-copy">
                  <span class="well-saved-sample-code">${safeText(label)}</span>
                  ${name ? `<span class="well-saved-sample-name">${safeText(name)}</span>` : ''}
                </span>
                <span class="well-saved-sample-type" style="--sample-type-color:${safeText(typeColor)};">${safeText(typeLabel)}</span>
              </button>
            `;
          }).join('')}
        </div>
      `
      : '<p class="small-note well-saved-sample-empty">No saved samples available.</p>';

    return `
      <div class="well-saved-sample-fill">
        <div class="well-saved-sample-head">
          <strong>Saved Samples</strong>
        </div>
        ${sampleList}
      </div>
    `;
  }

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
    const savedSampleFillList = renderSavedSampleFillList(section, container, index);
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
            <button type="button" class="primary-btn" data-well-sample-save="${safeText(activeSample.id)}">Save Sample</button>
            <button type="button" class="ghost-btn" data-well-sample-unlink="${safeText(activeSample.id)}">Delete Sample</button>
          </div>
        </div>
        ${sampleSelector}
        ${savedSampleFillList}
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
            <button type="button" class="primary-btn" data-well-sample-create="${index}">Add Sample</button>
          </div>
        </div>
        <p class="small-note">No sample linked to this cell yet.</p>
        ${savedSampleFillList}
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
