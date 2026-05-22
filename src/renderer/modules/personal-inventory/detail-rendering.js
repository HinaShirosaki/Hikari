import { getContainerLayout, getContainerTypeLabel } from './constants.js';

export function createPersonalInventoryDetailRenderer({
  safeText,
  uiState,
  helpers,
  getPendingStructureDraft = () => null
}) {
  const {
    getLinkedSamples,
    getSampleTypeColor,
    getSampleTypeLabel,
    renderSampleTypeOptions,
    renderSampleLegendForContainer,
    getWellDataForType,
    buildSampleDotFill
  } = helpers;

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
    const buttonText = hasCapturedStructure ? 'Edit Structure' : 'Add Structure';
    const sampleId = sample?.id ? ` data-sample-id="${safeText(sample.id)}"` : '';
    return `
      <div class="inventory-sample-structure-control">
        <button
          type="button"
          class="ghost-btn inventory-sample-structure-btn"
          data-inventory-sample-structure-open="${safeText(mode)}"${sampleId}
          hidden
        >${safeText(buttonText)}</button>
        <button
          type="button"
          class="ghost-btn inventory-sample-structure-paste-btn"
          data-inventory-sample-structure-paste="${safeText(mode)}"${sampleId}
          hidden
        >Paste Structure</button>
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
            <button type="button" class="primary-btn" data-well-sample-save="${safeText(activeSample.id)}">Save Sample</button>
            <button type="button" class="ghost-btn" data-well-sample-unlink="${safeText(activeSample.id)}">Delete Sample</button>
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

  function renderSingleContainerPreview(section, container) {
    const linkedSamples = getLinkedSamples(section, container.id, null);
    const primarySample = linkedSamples.find((item) => item.id === uiState.editingSampleId) || linkedSamples[0] || null;
    const fillColor = primarySample ? getSampleTypeColor(primarySample.type) : '';
    const fillLabel = primarySample ? `${getSampleTypeLabel(primarySample.type)} sample fill` : 'Empty tube';
    return `
      <div class="falcon-preview-shell">
        <div class="falcon-preview" aria-label="${safeText(fillLabel)}">
          <div class="falcon-cap"></div>
          <div class="falcon-body">
            <div class="falcon-liquid${primarySample ? ' has-sample' : ''}"${fillColor ? ` style="--falcon-fill:${fillColor};"` : ''}></div>
            <div class="falcon-mark falcon-mark-1"></div>
            <div class="falcon-mark falcon-mark-2"></div>
            <div class="falcon-mark falcon-mark-3"></div>
            <div class="falcon-mark falcon-mark-4"></div>
            <div class="falcon-highlight"></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderContainerDetail(section, container) {
    if (!container) {
      return '';
    }
    if (container.type === 'single') {
      const linkedSamples = getLinkedSamples(section, container.id, null);
      return `
        <div class="container-inline-detail">
          <h4>${safeText(section)} / ${safeText(container.name)} (${getContainerTypeLabel(container)})</h4>
          <p class="small-note">50 mL Falcon tube. Linked samples fill about one-third of the visible volume.</p>
          <div class="well-editor-shell well-editor-shell-single">
            <div class="well-grid-panel falcon-grid-panel">
              ${renderSingleContainerPreview(section, container)}
              ${linkedSamples.length ? renderSampleLegendForContainer(section, container) : ''}
            </div>
            ${renderSingleContainerEditor(section, container)}
          </div>
          <div class="container-detail-actions">
            <button type="button" class="danger-btn" data-container-delete="${safeText(container.id)}" data-section="${safeText(section)}">Delete</button>
          </div>
        </div>
      `;
    }

    const layout = getContainerLayout(container);
    const wells = Array.isArray(container.wells) ? container.wells : [];
    const rowLabels = layout.className === 'plate96'
      ? Array.from({ length: layout.rows }, (_item, index) => String.fromCharCode(65 + index))
      : [];
    const columnLabels = layout.className === 'plate96'
      ? Array.from({ length: layout.cols }, (_item, index) => String(index + 1))
      : [];
    const grid = wells.map((rawWell, index) => {
      const well = getWellDataForType(container, rawWell, index);
      const linkedSamples = getLinkedSamples(section, container.id, index);
      const linkedTypeLabels = Array.from(new Set(linkedSamples.map((item) => getSampleTypeLabel(item.type))));
      const linkedText = linkedSamples.length
        ? ` | Samples: ${linkedSamples.map((item) => item.code || item.name || item.id).join(', ')}${linkedTypeLabels.length ? ` | Types: ${linkedTypeLabels.join(', ')}` : ''}`
        : '';
      const title = well.content ? `${well.name}: ${well.content}${linkedText}` : `${well.name}${linkedText}`;
      const sampleDotFill = buildSampleDotFill(linkedSamples.map((item) => item.type));
      const hasSamples = linkedSamples.length > 0;
      const sampleCount = linkedSamples.length;
      return `
        <button type="button" class="well well-${safeText(layout.className)}${uiState.editingWellIndex === index ? ' well-selected' : ''}" data-well-index="${index}" data-section="${safeText(section)}" data-container-id="${safeText(container.id)}" title="${safeText(title)}">
          <span class="well-number">${safeText(well.name)}</span>
          <span class="well-sample-dot${hasSamples ? ' has-sample' : ''}"${sampleDotFill ? ` style="--well-sample-fill:${sampleDotFill};"` : ''}></span>
          ${sampleCount > 1 ? `<span class="well-sample-count">${safeText(String(sampleCount))}</span>` : ''}
        </button>
      `;
    }).join('');
    const gridStyle = `--well-grid-cols:${safeText(String(layout.cols))}; --well-grid-rows:${safeText(String(layout.rows))}; --well-grid-aspect-x:${safeText(String(layout.cols))}; --well-grid-aspect-y:${safeText(String(layout.rows))};`;

    return `
      <div class="container-inline-detail">
        <h4>${safeText(section)} / ${safeText(container.name)} (${getContainerTypeLabel(container)})</h4>
        <p class="small-note">${safeText(layout.helperText)}</p>
        <div class="well-editor-shell">
          <div class="well-grid-panel well-grid-panel-${safeText(layout.className)}">
            ${layout.className === 'plate96'
              ? `
                <div class="plate96-shell">
                  <span class="plate96-corner" aria-hidden="true"></span>
                  <div class="plate96-col-labels" aria-hidden="true">${columnLabels.map((label) => `<span>${safeText(label)}</span>`).join('')}</div>
                  <div class="plate96-row-labels" aria-hidden="true">${rowLabels.map((label) => `<span>${safeText(label)}</span>`).join('')}</div>
                  <div class="plate96-well-area">
                    <span class="plate96-skirt-shape" aria-hidden="true"></span>
                    <span class="plate96-skirt-edge" aria-hidden="true"></span>
                    <div class="well-grid well-grid-${safeText(layout.className)}" style="${gridStyle}">${grid}</div>
                  </div>
                </div>
              `
              : `<div class="well-grid well-grid-${safeText(layout.className)}" style="${gridStyle}">${grid}</div>`
            }
            ${renderSampleLegendForContainer(section, container)}
          </div>
          ${renderWellEditor(section, container, uiState.editingWellIndex)}
        </div>
        <div class="container-detail-actions">
          <button type="button" class="danger-btn" data-container-delete="${safeText(container.id)}" data-section="${safeText(section)}">Delete</button>
        </div>
      </div>
    `;
  }

  return {
    renderContainerDetail
  };
}
