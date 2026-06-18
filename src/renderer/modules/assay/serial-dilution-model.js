import { axisLabel, oppositeAxis } from './shared.js';
import { parseWellId, sortLayout } from './plate-model.js';
import {
  formatConcentrationLabel,
  formatVolumeText,
  parseConcentrationMagnitude
} from './concentration-utils.js';

export function buildSerialDilutionGroups({
  layout,
  sampleAxis,
  concentrationUnit = '',
  findInventorySampleRecordBySampleId
}) {
  const groupsBySample = new Map();

  sortLayout(layout).forEach((item) => {
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
        concentrationDisplay: formatConcentrationLabel(concentration, concentrationUnit),
        magnitude: parseConcentrationMagnitude(concentration, concentrationUnit),
        wells: [item.well]
      });
      return;
    }
    existing.wells.push(item.well);
    if (!existing.concentrationLabel && concentration) {
      existing.concentrationLabel = concentration;
      existing.concentrationDisplay = formatConcentrationLabel(concentration, concentrationUnit);
      existing.magnitude = parseConcentrationMagnitude(concentration, concentrationUnit);
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

export function calculateSerialDilutionPlan({ group, volumePerWellUl, stockConcentrationText, concentrationUnit = '' }) {
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

  const stockMagnitude = parseConcentrationMagnitude(stockConcentrationText, concentrationUnit);
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

function dilutionRowsMatch(rows, referenceRows) {
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
}

export function buildSerialDilutionSummaryModel({
  groups,
  sampleAxis,
  volumePerWellUl,
  concentrationUnit = '',
  getSerialDilutionStockValue
}) {
  const concentrationAxisName = axisLabel(oppositeAxis(sampleAxis));

  const planResults = groups.map((group) => {
    const stockValue = getSerialDilutionStockValue(group.sampleId);
    return {
      group,
      stockValue,
      plan: calculateSerialDilutionPlan({
        group,
        volumePerWellUl,
        stockConcentrationText: stockValue,
        concentrationUnit
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
    ? validPlans.every(({ plan }) => dilutionRowsMatch(plan.rows.slice(1), referenceFollowingRows))
    : true;

  const followingDilutionRows = referenceFollowingRows.map((row, index) => ({
    step: `Step ${index + 1}`,
    targetConcentration: row.concentrationDisplay || row.concentrationLabel,
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
