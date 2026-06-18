import {
  buildSerialDilutionGroups as buildSerialDilutionGroupsModel,
  buildSerialDilutionSummaryModel
} from './serial-dilution-model.js';

export function createSerialDilutionController({
  elements,
  safeText,
  getSampleAxis,
  getCurrentLayout,
  getConcentrationUnit = () => '',
  findInventorySampleRecordBySampleId,
  hideInventorySamplePicker
}) {
  const {
    overlay,
    content,
    summary,
    volumeInput
  } = elements;

  const state = {
    stockConcentrations: Object.create(null)
  };

  function getSerialDilutionStockValue(sampleId) {
    if (Object.prototype.hasOwnProperty.call(state.stockConcentrations, sampleId)) {
      return state.stockConcentrations[sampleId];
    }
    const inventorySample = findInventorySampleRecordBySampleId(sampleId);
    const nextValue = String(inventorySample?.concentration || '').trim();
    state.stockConcentrations[sampleId] = nextValue;
    return nextValue;
  }

  function buildSerialDilutionGroups() {
    return buildSerialDilutionGroupsModel({
      layout: getCurrentLayout(),
      sampleAxis: getSampleAxis(),
      concentrationUnit: getConcentrationUnit(),
      findInventorySampleRecordBySampleId
    });
  }

  function buildSummaryModel() {
    const groups = buildSerialDilutionGroups();
    const volumePerWellUl = Number(volumeInput?.value);
    return buildSerialDilutionSummaryModel({
      groups,
      sampleAxis: getSampleAxis(),
      volumePerWellUl,
      concentrationUnit: getConcentrationUnit(),
      getSerialDilutionStockValue
    });
  }

  function getSnapshot() {
    const snapshot = {
      volumePerWellUl: String(volumeInput?.value || volumeInput?.defaultValue || '100').trim() || '100',
      stockConcentrations: {}
    };
    buildSerialDilutionGroups().forEach((group) => {
      snapshot.stockConcentrations[group.sampleId] = String(getSerialDilutionStockValue(group.sampleId) || '').trim();
    });
    return snapshot;
  }

  function restoreSnapshot(snapshot = null) {
    state.stockConcentrations = Object.create(null);
    const nextStocks = snapshot?.stockConcentrations && typeof snapshot.stockConcentrations === 'object'
      ? snapshot.stockConcentrations
      : {};
    Object.entries(nextStocks).forEach(([sampleId, value]) => {
      const key = String(sampleId || '').trim();
      if (!key) {
        return;
      }
      state.stockConcentrations[key] = String(value || '').trim();
    });
    if (volumeInput) {
      const nextVolume = String(snapshot?.volumePerWellUl || '').trim();
      volumeInput.value = nextVolume || String(volumeInput.defaultValue || '100');
    }
    if (isOpen()) {
      render();
    }
  }

  function reset() {
    restoreSnapshot(null);
  }

  function getSummaryData() {
    const model = buildSummaryModel();
    return {
      concentrationAxisName: model.concentrationAxisName,
      volumePerWellUl: model.volumePerWellUl,
      feedbackMessages: model.feedbackMessages.map((item) => ({ ...item })),
      initialDilutionRows: model.initialDilutionRows.map((item) => ({ ...item })),
      followingDilutionRows: model.followingDilutionRows.map((item) => ({ ...item })),
      followingRowsAreShared: model.followingRowsAreShared,
      hasValidPlans: model.hasValidPlans
    };
  }

  function render() {
    if (!content || !summary) {
      return;
    }

    const model = buildSummaryModel();
    const {
      groups,
      concentrationAxisName,
      feedbackMessages,
      initialDilutionRows,
      followingDilutionRows,
      followingRowsAreShared,
      hasValidPlans
    } = model;

    if (!groups.length) {
      summary.textContent = 'Map sample IDs and concentrations on the plate first.';
      content.innerHTML = '<p class="small-note">No mapped sample dilution series are available yet.</p>';
      return;
    }

    summary.textContent = `Calculated from the current ${concentrationAxisName} order. Trailing 0 concentration control wells are skipped from the serial dilution chain.`;

    const renderSerialDilutionTable = (headers, rows, className = '') => {
      if (!rows.length) {
        return '';
      }
      return `
        <div class="assay-serial-dilution-table-wrap">
          <table class="assay-serial-dilution-table ${className}">
            <thead>
              <tr>
                ${headers.map((header) => `<th>${safeText(header)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map((cells) => `
                <tr>
                  ${cells.map((cell) => `<td>${safeText(cell)}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    };

    const sampleInputTable = `
      <div class="assay-serial-dilution-stock-table-wrap">
        <table class="assay-serial-dilution-stock-table">
          <thead>
            <tr>
              <th>Sample</th>
              <th>Conc</th>
            </tr>
          </thead>
          <tbody>
            ${groups.map((group) => {
              const stockValue = getSerialDilutionStockValue(group.sampleId);
              return `
                <tr>
                  <td>${safeText(group.sampleId)}</td>
                  <td>
                    <input
                      type="text"
                      value="${safeText(stockValue)}"
                      placeholder="e.g. 10 mM"
                      data-assay-serial-stock-sample="${safeText(group.sampleId)}"
                    />
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="small-note">Stock concentration is loaded from inventory when available. You can edit any value in the table above.</p>
    `;

    const feedbackLines = feedbackMessages.map((item) => `
      <p class="small-note ${item.type === 'error' ? 'assay-serial-dilution-error' : 'assay-serial-dilution-note'}">${safeText(item.text)}</p>
    `).join('');

    const initialDilutionSection = initialDilutionRows.length
      ? `
        <section class="assay-serial-dilution-sample">
          <div class="assay-serial-dilution-sample-head">
            <h4>Initial Dilution</h4>
          </div>
          <p class="small-note">Prepare the first active dilution well for each sample using its stock concentration.</p>
          ${renderSerialDilutionTable(
            ['Sample', 'Stock Vol.', 'Buffer Vol.'],
            initialDilutionRows.map((row) => [row.sample, row.stockVolume, row.bufferVolume]),
            'assay-serial-dilution-table-compact'
          )}
        </section>
      `
      : '';

    const followingDilutionSection = followingDilutionRows.length
      ? `
        <section class="assay-serial-dilution-sample">
          <div class="assay-serial-dilution-sample-head">
            <h4>Following Dilution</h4>
          </div>
          <p class="small-note">Repeat this same downstream dilution sequence for every sample after the initial well is prepared.</p>
          ${!followingRowsAreShared ? '<p class="small-note assay-serial-dilution-note">Following-dilution rows were not identical across every sample, so this table is based on the first valid sample sequence.</p>' : ''}
          ${renderSerialDilutionTable(
            ['Step', 'Target Conc.', 'From Previous Well', 'Buffer Vol.', 'Transfer / Discard', 'Final Vol.'],
            followingDilutionRows.map((row) => [
              row.step,
              row.targetConcentration,
              row.fromPreviousWell,
              row.bufferVolume,
              row.transferOrDiscard,
              row.finalVolume
            ])
          )}
        </section>
      `
      : hasValidPlans
        ? `
        <section class="assay-serial-dilution-sample">
          <div class="assay-serial-dilution-sample-head">
            <h4>Following Dilution</h4>
          </div>
          <p class="small-note">No downstream dilution steps are needed for the current mapped series.</p>
        </section>
      `
        : '';

    const emptyState = !hasValidPlans
      ? '<p class="small-note">No serial dilution recipe could be calculated yet.</p>'
      : '';

    content.innerHTML = `${sampleInputTable}${feedbackLines}${initialDilutionSection}${followingDilutionSection}${emptyState}`;
  }

  function open() {
    if (!overlay) {
      return;
    }
    hideInventorySamplePicker();
    overlay.hidden = false;
    render();
    volumeInput?.focus();
    volumeInput?.select?.();
  }

  function close() {
    if (!overlay) {
      return;
    }
    overlay.hidden = true;
  }

  function onOverlayClick(event) {
    if (event?.target === overlay) {
      close();
    }
  }

  function onDialogInput(event) {
    const stockInput = event.target.closest('[data-assay-serial-stock-sample]');
    if (stockInput) {
      const sampleId = String(stockInput.dataset.assaySerialStockSample || '').trim();
      state.stockConcentrations[sampleId] = String(stockInput.value || '');
      render();
      const nextInput = [...(content?.querySelectorAll('[data-assay-serial-stock-sample]') || [])]
        .find((input) => String(input.dataset.assaySerialStockSample || '').trim() === sampleId);
      nextInput?.focus();
      nextInput?.setSelectionRange?.(state.stockConcentrations[sampleId].length, state.stockConcentrations[sampleId].length);
      return;
    }
    if (event.target === volumeInput) {
      render();
    }
  }

  function isOpen() {
    return Boolean(overlay && !overlay.hidden);
  }

  return {
    render,
    getSnapshot,
    restoreSnapshot,
    reset,
    getSummaryData,
    open,
    close,
    onOverlayClick,
    onDialogInput,
    isOpen
  };
}
