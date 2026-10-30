import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("plate");
import {
  buildSerialDilutionGroups as buildSerialDilutionGroupsModel,
  buildSerialDilutionSummaryModel
} from './serial-dilution-model.js';
import { bindPlateMessage, plateAttributes, plateMessage, setPlateText } from './localization.js';

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
      // Saved summaries keep their canonical English shape; display descriptors stay in the UI.
      feedbackMessages: model.feedbackMessages.map(({ type, text }) => ({ type, text })),
      initialDilutionRows: model.initialDilutionRows.map((item) => ({ ...item })),
      followingDilutionRows: model.followingDilutionRows.map(({ stepMessage, transferMessage, ...item }) => item),
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
      feedbackMessages,
      initialDilutionRows,
      followingDilutionRows,
      followingRowsAreShared,
      hasValidPlans
    } = model;

    if (!groups.length) {
      setPlateText(summary, 'dilution.mapFirst');
      i18nUi.setHtml(content, `<p class="small-note">${plateMessage('dilution.noSeries')}</p>`);
      return;
    }

    bindPlateMessage(summary, '');

    const renderSerialDilutionTable = (headers, rows, className = '') => {
      if (!rows.length) {
        return '';
      }
      return `
        <div class="assay-serial-dilution-table-wrap">
          <table class="assay-serial-dilution-table ${className}">
            <thead>
              <tr>
                ${headers.map((header) => `<th>${plateMessage(header)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map((cells) => `
                <tr>
                  ${cells.map((cell) => `<td>${cell?.id ? plateMessage(cell.id, cell.params) : safeText(cell)}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    };

    const sampleInputTable = `
      <section class="assay-serial-dilution-sample">
        <div class="assay-serial-dilution-sample-head">
          <h4>${plateMessage('dilution.sampleConcentrations')}</h4>
        </div>
        <div class="assay-serial-dilution-stock-table-wrap">
          <table class="assay-serial-dilution-stock-table">
            <thead>
              <tr>
                <th>${plateMessage('dilution.sample')}</th>
                <th>${plateMessage('dilution.stockConcentration')}</th>
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
                        ${plateAttributes({ placeholder: 'dilution.stockPlaceholder' })}
                        data-assay-serial-stock-sample="${safeText(group.sampleId)}"
                      />
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;

    const feedbackLines = feedbackMessages.map((item) => `
      <p class="small-note ${item.type === 'error' ? 'assay-serial-dilution-error' : 'assay-serial-dilution-note'}">${item.message
        ? `${safeText(item.sampleId)}: ${plateMessage(item.message.id, item.message.params)}` : safeText(item.text)}</p>
    `).join('');

    const initialDilutionSection = initialDilutionRows.length
      ? `
        <section class="assay-serial-dilution-sample">
          <div class="assay-serial-dilution-sample-head">
            <h4>${plateMessage('dilution.initial')}</h4>
          </div>
          ${renderSerialDilutionTable(
            ['dilution.sample', 'dilution.stockVolume', 'dilution.bufferVolume'],
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
            <h4>${plateMessage('dilution.following')}</h4>
          </div>
          ${!followingRowsAreShared ? `<p class="small-note assay-serial-dilution-note">${plateMessage('dilution.notShared')}</p>` : ''}
          ${renderSerialDilutionTable(
            ['dilution.step', 'dilution.targetConcentration', 'dilution.fromPrevious', 'dilution.bufferVolume', 'dilution.transferDiscard', 'dilution.finalVolume'],
            followingDilutionRows.map((row) => [
              row.stepMessage,
              row.targetConcentration,
              row.fromPreviousWell,
              row.bufferVolume,
              row.transferMessage,
              row.finalVolume
            ])
          )}
        </section>
      `
      : hasValidPlans
        ? `
        <section class="assay-serial-dilution-sample">
          <div class="assay-serial-dilution-sample-head">
            <h4>${plateMessage('dilution.following')}</h4>
          </div>
          <p class="small-note">${plateMessage('dilution.noFollowing')}</p>
        </section>
      `
        : '';

    const emptyState = !hasValidPlans
      ? `<p class="small-note">${plateMessage('dilution.noRecipe')}</p>`
      : '';

    i18nUi.setHtml(content, `${feedbackLines}<div class="assay-serial-dilution-overview">${sampleInputTable}${initialDilutionSection}</div>${followingDilutionSection}${emptyState}`);
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
