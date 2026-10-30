import "./localization.js";
import { getContainerLayout } from './constants.js';
import { sampleAttributes, sampleContainerTypeMessage, sampleMessage } from './localization.js';

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
    const fillKey = primarySample ? 'container.sampleFill' : 'container.emptyTube';
    return `
      <div class="falcon-preview-shell">
        <div class="falcon-preview" role="img" ${sampleAttributes({ 'aria-label': fillKey }, primarySample ? { type: getSampleTypeLabel(primarySample.type) } : {})}>
          <div class="falcon-cap" aria-hidden="true">
            <span class="falcon-cap-ridges"></span>
          </div>
          <div class="falcon-body">
            <div class="falcon-liquid${primarySample ? ' has-sample' : ''}"${fillColor ? ` style="--falcon-fill:${fillColor};"` : ''}></div>
            <div class="falcon-mark falcon-mark-1"></div>
            <div class="falcon-mark falcon-mark-2"></div>
            <div class="falcon-mark falcon-mark-3"></div>
            <div class="falcon-mark falcon-mark-4"></div>
            <span class="falcon-volume falcon-volume-50">50</span>
            <span class="falcon-volume falcon-volume-25">25</span>
            <span class="falcon-volume falcon-volume-10">10</span>
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
          <div class="container-detail-sticky">
            <div class="container-detail-header">
              <div class="container-detail-title">
                <h4>${safeText(section)} / ${safeText(container.name)} (${sampleContainerTypeMessage(container)})</h4>
              </div>
            </div>
          </div>
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
      const wellTitle = well.content ? `${well.name}: ${well.content}` : well.name;
      const titleAttribute = linkedSamples.length
        ? sampleAttributes({ title: linkedTypeLabels.length ? 'well.samplesAndTypes' : 'well.samples' }, {
          well: wellTitle,
          samples: linkedSamples.map((item) => item.code || item.name || item.id).join(', '),
          ...(linkedTypeLabels.length ? { types: linkedTypeLabels.join(', ') } : {})
        })
        : `title="${safeText(wellTitle)}"`;
      const sampleDotFill = buildSampleDotFill(linkedSamples.map((item) => item.type));
      const hasSamples = linkedSamples.length > 0;
      const sampleCount = linkedSamples.length;
      const gridEdgeClasses = layout.className === 'box81'
        ? `${(index + 1) % layout.cols === 0 ? ' well-last-column' : ''}${index >= (layout.rows - 1) * layout.cols ? ' well-last-row' : ''}`
        : '';
      return `
        <button type="button" class="well well-${safeText(layout.className)}${gridEdgeClasses}${uiState.editingWellIndex === index ? ' well-selected' : ''}${uiState.cloningSampleId ? ' well-clone-target' : ''}" data-well-index="${index}" data-section="${safeText(section)}" data-container-id="${safeText(container.id)}" ${titleAttribute}>
          <span class="well-number">${safeText(well.name)}</span>
          <span class="well-sample-dot${hasSamples ? ' has-sample' : ''}"${sampleDotFill ? ` style="--well-sample-fill:${sampleDotFill};"` : ''}></span>
          ${sampleCount > 1 ? `<span class="well-sample-count">${safeText(String(sampleCount))}</span>` : ''}
        </button>
      `;
    }).join('');
    const gridStyle = `--well-grid-cols:${safeText(String(layout.cols))}; --well-grid-rows:${safeText(String(layout.rows))}; --well-grid-aspect-x:${safeText(String(layout.cols))}; --well-grid-aspect-y:${safeText(String(layout.rows))};`;
    const activeWellSamples = Number.isInteger(uiState.editingWellIndex) && uiState.editingWellIndex >= 0
      ? getLinkedSamples(section, container.id, uiState.editingWellIndex)
      : [];
    const activeSample = activeWellSamples.find((item) => item.id === uiState.editingSampleId) || activeWellSamples[0] || null;
    const isFillingWells = activeSample && uiState.cloningSampleId === activeSample.id;
    const fillWellsKey = isFillingWells ? 'container.stopFilling' : 'container.startFilling';

    return `
      <div class="container-inline-detail">
        <div class="container-detail-sticky">
          <div class="container-detail-header">
            <div class="container-detail-title">
              <h4>${safeText(section)} / ${safeText(container.name)} (${sampleContainerTypeMessage(container)})</h4>
              ${layout.className === 'plate96' ? `<p class="small-note">${sampleMessage('container.plateHint')}</p>` : ''}
            </div>
            <div class="container-detail-toolbar">
              ${activeSample
                ? `
                  <button type="button" class="ghost-btn inventory-fill-wells-btn${isFillingWells ? ' is-active' : ''}" data-well-sample-clone="${safeText(activeSample.id)}" ${sampleAttributes({ 'aria-label': fillWellsKey, 'data-hover-caption': fillWellsKey })} aria-pressed="${isFillingWells ? 'true' : 'false'}">
                    <svg class="inventory-fill-wells-icon" viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                      <rect x="8" y="8" width="11" height="11" rx="2"></rect>
                      <path d="M5 16V7a2 2 0 0 1 2-2h9"></path>
                    </svg>
                  </button>
                `
                : ''}
              <button type="button" class="ghost-btn container-csv-icon-btn" data-container-import-csv="${safeText(container.id)}" data-section="${safeText(section)}" ${sampleAttributes({ 'aria-label': 'container.importCsv', 'data-hover-caption': 'container.importCsv' })}>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M12 15V3"></path>
                  <path d="m7 8 5-5 5 5"></path>
                  <path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"></path>
                </svg>
              </button>
              <button type="button" class="ghost-btn container-csv-icon-btn" data-container-export-csv="${safeText(container.id)}" data-section="${safeText(section)}" ${sampleAttributes({ 'aria-label': 'container.exportCsv', 'data-hover-caption': 'container.exportCsv' })}>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M12 3v12"></path>
                  <path d="m7 10 5 5 5-5"></path>
                  <path d="M4 19v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"></path>
                </svg>
              </button>
              <input type="file" accept=".csv,text/csv" data-container-import-input="${safeText(container.id)}" hidden />
            </div>
          </div>
        </div>
        <div class="well-editor-shell">
          <div class="well-grid-column">
            <div class="well-grid-panel well-grid-panel-${safeText(layout.className)}">
              ${layout.className === 'plate96' ? `
                  <div class="plate96-shell">
                    <span class="plate96-corner" aria-hidden="true"></span>
                    <div class="plate96-col-labels" aria-hidden="true">${columnLabels.map((label) => `<span>${safeText(label)}</span>`).join('')}</div>
                    <div class="plate96-row-labels" aria-hidden="true">${rowLabels.map((label) => `<span>${safeText(label)}</span>`).join('')}</div>
                    <div class="plate96-well-area">
                      <div class="well-grid well-grid-${safeText(layout.className)}" style="${gridStyle}">${grid}</div>
                    </div>
                  </div>
                ` : `<div class="well-grid well-grid-${safeText(layout.className)}" style="${gridStyle}">${grid}</div>`
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
