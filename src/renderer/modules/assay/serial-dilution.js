import { axisLabel, oppositeAxis } from './shared.js';
import { parseWellId, sortLayout } from './plate-model.js';
import {
  formatVolumeText,
  parseConcentrationMagnitude
} from './concentration-utils.js';

export function createSerialDilutionController({
  elements,
  safeText,
  getSampleAxis,
  getCurrentLayout,
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
    const sampleAxis = getSampleAxis();
    const groupsBySample = new Map();

    sortLayout(getCurrentLayout()).forEach((item) => {
      const sampleId = String(item?.sampleId || '').trim();
      const concentration = String(item?.concentration || '').trim();
      if (!sampleId || !concentration) {
        return;
      }
      const parsed = parseWellId(item.well);
      if (!parsed) {
        return;
      }
      const sampleOrder = sampleAxis === 'row' ? parsed.rowIndex : parsed.columnIndex;
      const concentrationIndex = sampleAxis === 'row' ? parsed.columnIndex : parsed.rowIndex;
      if (!groupsBySample.has(sampleId)) {
        groupsBySample.set(sampleId, {
          sampleId,
          sampleOrder,
          entriesByIndex: new Map(),
          hasConflict: false
        });
      }
      const group = groupsBySample.get(sampleId);
      const existing = group.entriesByIndex.get(concentrationIndex);
      if (!existing) {
        group.entriesByIndex.set(concentrationIndex, {
          concentrationIndex,
          concentrationLabel: concentration,
          magnitude: parseConcentrationMagnitude(concentration),
          wells: [item.well]
        });
        return;
      }
      existing.wells.push(item.well);
      if (!existing.concentrationLabel && concentration) {
        existing.concentrationLabel = concentration;
        existing.magnitude = parseConcentrationMagnitude(concentration);
        return;
      }
      if (existing.concentrationLabel !== concentration) {
        group.hasConflict = true;
      }
    });

    return [...groupsBySample.values()]
      .sort((left, right) => {
        if (left.sampleOrder !== right.sampleOrder) {
          return left.sampleOrder - right.sampleOrder;
        }
        return left.sampleId.localeCompare(right.sampleId, undefined, { sensitivity: 'base' });
      })
      .map((group) => {
        const entries = [...group.entriesByIndex.values()]
          .sort((left, right) => left.concentrationIndex - right.concentrationIndex)
          .map((entry) => ({
            ...entry,
            wellLabel: entry.wells.join(', ')
          }));
        let lastNonZeroIndex = -1;
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          if (Number.isFinite(entries[index].magnitude) && entries[index].magnitude > 0) {
            lastNonZeroIndex = index;
            break;
          }
        }
        return {
          sampleId: group.sampleId,
          sampleOrder: group.sampleOrder,
          hasConflict: group.hasConflict,
          inventorySample: findInventorySampleRecordBySampleId(group.sampleId),
          entries,
          chainEntries: lastNonZeroIndex >= 0 ? entries.slice(0, lastNonZeroIndex + 1) : [],
          trailingEntries: lastNonZeroIndex >= 0 ? entries.slice(lastNonZeroIndex + 1) : entries.slice()
        };
      });
  }

  function calculateSerialDilutionPlan({ group, volumePerWellUl, stockConcentrationText }) {
    const notes = [];
    const trailingZeroEntries = group.trailingEntries.filter((entry) => entry.magnitude === 0);
    const trailingOtherEntries = group.trailingEntries.filter((entry) => entry.magnitude !== 0);

    if (group.hasConflict) {
      notes.push('Multiple mapped wells for one concentration position had different concentration labels. Using the first one.');
    }
    if (trailingZeroEntries.length) {
      notes.push(`Skipped trailing 0 concentration well${trailingZeroEntries.length === 1 ? '' : 's'}: ${trailingZeroEntries.map((entry) => entry.wellLabel).join('; ')}.`);
    }
    if (trailingOtherEntries.length) {
      notes.push(`Ignored trailing wells without a positive concentration: ${trailingOtherEntries.map((entry) => entry.wellLabel).join('; ')}.`);
    }
    if (!(Number.isFinite(volumePerWellUl) && volumePerWellUl > 0)) {
      return {
        rows: [],
        notes,
        error: 'Enter a positive volume per well to calculate the dilution recipe.'
      };
    }
    if (!group.chainEntries.length) {
      return {
        rows: [],
        notes,
        error: 'Add at least one mapped well with a positive concentration for this sample.'
      };
    }
    if (group.chainEntries.some((entry) => !(Number.isFinite(entry.magnitude) && entry.magnitude > 0))) {
      return {
        rows: [],
        notes,
        error: 'Concentrations must stay positive until the last active dilution well.'
      };
    }

    const stockMagnitude = parseConcentrationMagnitude(stockConcentrationText);
    if (!(Number.isFinite(stockMagnitude) && stockMagnitude > 0)) {
      return {
        rows: [],
        notes,
        error: 'Enter a valid stock concentration for this sample.'
      };
    }

    const rows = group.chainEntries.map((entry) => ({
      ...entry,
      inputLabel: '',
      inputVolume: null,
      bufferVolume: null,
      prepVolume: null,
      outputLabel: '-',
      outputVolume: 0,
      discardVolume: 0,
      finalVolume: volumePerWellUl
    }));

    if (!(stockMagnitude > rows[0].magnitude)) {
      return {
        rows: [],
        notes,
        error: 'Stock concentration must be higher than the first target concentration.'
      };
    }

    if (rows.length > 1) {
      for (let index = rows.length - 1; index >= 1; index -= 1) {
        const current = rows[index];
        const previous = rows[index - 1];
        const ratio = current.magnitude / previous.magnitude;
        if (!(ratio > 0 && ratio < 1)) {
          return {
            rows: [],
            notes,
            error: `Concentrations must decrease in dilution order (${previous.wellLabel} -> ${current.wellLabel}).`
          };
        }

        const outputVolume = index === rows.length - 1
          ? ((ratio * volumePerWellUl) / (1 - ratio))
          : rows[index + 1].inputVolume;

        if (!(Number.isFinite(outputVolume) && outputVolume > 0)) {
          return {
            rows: [],
            notes,
            error: `Could not calculate the carryover volume for ${current.wellLabel}.`
          };
        }

        const prepVolume = volumePerWellUl + outputVolume;
        const inputVolume = ratio * prepVolume;
        const bufferVolume = prepVolume - inputVolume;
        if (!(Number.isFinite(inputVolume) && inputVolume > 0 && inputVolume < prepVolume)) {
          return {
            rows: [],
            notes,
            error: `Could not calculate a valid transfer volume into ${current.wellLabel}.`
          };
        }

        current.inputLabel = `From ${previous.wellLabel}`;
        current.inputVolume = inputVolume;
        current.bufferVolume = bufferVolume;
        current.prepVolume = prepVolume;
        current.outputLabel = index === rows.length - 1 ? 'Discard' : `To ${rows[index + 1].wellLabel}`;
        current.outputVolume = outputVolume;
        current.discardVolume = index === rows.length - 1 ? outputVolume : 0;
      }
    }

    const firstOutputVolume = rows.length > 1 ? rows[1].inputVolume : 0;
    const firstPrepVolume = volumePerWellUl + firstOutputVolume;
    const stockVolume = (rows[0].magnitude / stockMagnitude) * firstPrepVolume;
    const firstBufferVolume = firstPrepVolume - stockVolume;
    if (!(Number.isFinite(stockVolume) && stockVolume > 0 && stockVolume < firstPrepVolume)) {
      return {
        rows: [],
        notes,
        error: `Could not calculate a valid stock dilution volume for ${rows[0].wellLabel}.`
      };
    }

    rows[0].inputLabel = 'From stock';
    rows[0].inputVolume = stockVolume;
    rows[0].bufferVolume = firstBufferVolume;
    rows[0].prepVolume = firstPrepVolume;
    rows[0].outputLabel = rows.length > 1 ? `To ${rows[1].wellLabel}` : '-';
    rows[0].outputVolume = firstOutputVolume;
    rows[0].discardVolume = 0;

    return { rows, notes, error: '' };
  }

  function buildSummaryModel() {
    const groups = buildSerialDilutionGroups();
    const volumePerWellUl = Number(volumeInput?.value);
    const concentrationAxisName = axisLabel(oppositeAxis(getSampleAxis()));

    const planResults = groups.map((group) => {
      const stockValue = getSerialDilutionStockValue(group.sampleId);
      return {
        group,
        stockValue,
        plan: calculateSerialDilutionPlan({
          group,
          volumePerWellUl,
          stockConcentrationText: stockValue
        })
      };
    });

    const feedbackMessages = planResults.flatMap(({ group, plan }) => {
      const messages = [];
      if (plan.error) {
        messages.push({
          type: 'error',
          text: `${group.sampleId}: ${plan.error}`
        });
      }
      for (const note of plan.notes) {
        messages.push({
          type: 'note',
          text: `${group.sampleId}: ${note}`
        });
      }
      return messages;
    });

    const validPlans = planResults.filter(({ plan }) => plan.rows.length && !plan.error);
    const initialDilutionRows = validPlans.map(({ group, plan }) => {
      const firstRow = plan.rows[0];
      return {
        sample: group.sampleId,
        stockVolume: formatVolumeText(firstRow.inputVolume),
        bufferVolume: formatVolumeText(firstRow.bufferVolume)
      };
    });

    const referenceFollowingRows = validPlans.find(({ plan }) => plan.rows.length > 1)?.plan.rows.slice(1) || [];
    const followingRowsAreShared = referenceFollowingRows.length
      ? validPlans.every(({ plan }) => {
        const rows = plan.rows.slice(1);
        if (rows.length !== referenceFollowingRows.length) {
          return false;
        }
        return rows.every((row, index) => {
          const referenceRow = referenceFollowingRows[index];
          return String(row.concentrationLabel || '') === String(referenceRow.concentrationLabel || '')
            && formatVolumeText(row.inputVolume) === formatVolumeText(referenceRow.inputVolume)
            && formatVolumeText(row.bufferVolume) === formatVolumeText(referenceRow.bufferVolume)
            && formatVolumeText(row.outputVolume) === formatVolumeText(referenceRow.outputVolume)
            && formatVolumeText(row.finalVolume) === formatVolumeText(referenceRow.finalVolume)
            && (row.outputLabel === 'Discard') === (referenceRow.outputLabel === 'Discard');
        });
      })
      : true;

    const followingDilutionRows = referenceFollowingRows.map((row, index) => ({
      step: `Step ${index + 1}`,
      targetConcentration: row.concentrationLabel,
      fromPreviousWell: formatVolumeText(row.inputVolume),
      bufferVolume: formatVolumeText(row.bufferVolume),
      transferOrDiscard: row.outputLabel === 'Discard'
        ? `Discard ${formatVolumeText(row.outputVolume)}`
        : `Transfer ${formatVolumeText(row.outputVolume)}`,
      finalVolume: formatVolumeText(row.finalVolume)
    }));

    return {
      groups,
      concentrationAxisName,
      volumePerWellUl,
      feedbackMessages,
      initialDilutionRows,
      followingDilutionRows,
      followingRowsAreShared,
      hasValidPlans: validPlans.length > 0
    };
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

    const matchesSharedFollowingRecipe = (rows, referenceRows) => {
      if (rows.length !== referenceRows.length) {
        return false;
      }
      return rows.every((row, index) => {
        const referenceRow = referenceRows[index];
        return String(row.concentrationLabel || '') === String(referenceRow.concentrationLabel || '')
          && formatVolumeText(row.inputVolume) === formatVolumeText(referenceRow.inputVolume)
          && formatVolumeText(row.bufferVolume) === formatVolumeText(referenceRow.bufferVolume)
          && formatVolumeText(row.outputVolume) === formatVolumeText(referenceRow.outputVolume)
          && formatVolumeText(row.finalVolume) === formatVolumeText(referenceRow.finalVolume)
          && (row.outputLabel === 'Discard') === (referenceRow.outputLabel === 'Discard');
      });
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
