import { getContainerLayout, getContainerTypeLabel } from './constants.js';

export function createContainerDetailRenderer({
  safeText,
  uiState,
  helpers,
  renderWellEditor,
  renderSingleContainerEditor
}) {
  const {
    getLinkedSamples,
    getSampleTypeColor,
    getSampleTypeLabel,
    renderSampleLegendForContainer,
    getWellDataForType,
    buildSampleDotFill
  } = helpers;

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
        <div class="container-detail-toolbar">
          <button type="button" class="ghost-btn" data-container-import-csv="${safeText(container.id)}" data-section="${safeText(section)}">Import CSV</button>
          <input type="file" accept=".csv,text/csv" data-container-import-input="${safeText(container.id)}" hidden />
        </div>
        <div class="well-editor-shell">
          <div class="well-grid-column">
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
          </div>
          ${renderWellEditor(section, container, uiState.editingWellIndex)}
        </div>
      </div>
    `;
  }

  return {
    renderContainerDetail
  };
}
