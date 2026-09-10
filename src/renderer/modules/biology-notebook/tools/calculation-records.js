import { calculateFixedReaction } from '../../../lib/bench-calculations.js';
import {
  buildFixedReactionCalculationTable,
  normalizeNotebookToolCalculations
} from '../../../lib/notebook-tool-calculations.js';

// Turning a bench-tool result into the calculation record (and editable table)
// the notebook page carries.
function createCalculationRecords({
  createId,
  getToolCalculations,
  setToolCalculations,
  getCurrentResult,
  calculateActiveTool,
  resultTextAfterName,
  renderSavedCalculations
} = {}) {
  function cleanCell(value) {
    return String(value ?? '').trim();
  }

  function concentrationText(parsed, fallback = '') {
    return cleanCell(parsed?.text || fallback);
  }

  function bufferCalculationTable(result) {
    if (!result || result.type !== 'buffer' || result.mode !== 'recipe') {
      return null;
    }
    const rowsByIndex = new Map((Array.isArray(result.inputs?.rows) ? result.inputs.rows : [])
      .map((row) => [Number(row?.rowIndex) || 0, row]));
    const rows = (Array.isArray(result.details) ? result.details : []).map((detail) => {
      const rowIndex = Number(detail?.rowIndex) || 0;
      const rowInput = rowsByIndex.get(rowIndex) || {};
      const rowDetail = Array.isArray(detail.details) ? detail.details[0] : null;
      return [
        cleanCell(rowDetail?.name || detail.inputs?.name || rowInput.name),
        cleanCell(detail.inputs?.molecularWeight || rowInput.molecularWeight),
        concentrationText(rowDetail?.stockConcentration, rowInput.stockConcentration),
        concentrationText(rowDetail?.finalConcentration, rowInput.finalConcentration),
        cleanCell(rowDetail?.quantityText || resultTextAfterName(detail.resultText)),
        // What actually went on the balance -- the lot, which bottle it came from.
        cleanCell(rowInput.note)
      ];
    }).filter((row) => row.some(Boolean));
    const footerRows = [[
      ['Solvent to add', cleanCell(result.solvent?.text)].filter(Boolean).join(' '),
      '',
      ['6 M NaOH', cleanCell(result.phAdjustment?.naohText)].filter(Boolean).join(' '),
      '',
      ['6 M HCl', cleanCell(result.phAdjustment?.hclText)].filter(Boolean).join(' '),
      ''
    ]];
    const volumeValue = cleanCell(result.inputs?.volumeValue ?? result.inputs?.volumeMl);
    const volumeUnit = cleanCell(result.inputs?.volumeUnit) || 'mL';
    return {
      caption: 'Buffer Preparer',
      metaRows: [[
        'Volume',
        volumeValue ? `${volumeValue} ${volumeUnit}` : '',
        'pH',
        cleanCell(result.inputs?.pH),
        '',
        ''
      ]],
      headers: ['Chemical', 'MW', 'Stock Conc.', 'Final Conc.', 'Mass/Volume', 'Note'],
      rows,
      footerRows
    };
  }

  function reactionCalculationTable(result) {
    const table = buildFixedReactionCalculationTable(result);
    return table && (table.rows.length || table.footerRows.some((row) => row.some(Boolean))) ? table : null;
  }

  function calculationTableForResult(result) {
    return bufferCalculationTable(result) || reactionCalculationTable(result);
  }

  function makeCalculationRecord() {
    const result = getCurrentResult() || calculateActiveTool();
    const main = result?.resultText || result?.formulaText || '';
    if (!result || !main) {
      return null;
    }
    const id = typeof createId === 'function' ? createId() : `tool_calc_${Date.now()}`;
    return {
      id,
      type: result.type,
      mode: result.mode,
      title: result.title,
      inputs: result.inputs || {},
      table: calculationTableForResult(result),
      result: result.resultText || '',
      formula: result.formulaText || '',
      summary: main,
      status: result.status || '',
      createdAt: new Date().toISOString()
    };
  }

  // Editing a cell rewrites that one input and runs the same engine again, so a
  // changed stock concentration flows through to every derived volume and to
  // the water that fills the tube.
  function applyCalculationEdit({ calculationId, rowIndex, field, value }) {
    const index = getToolCalculations().findIndex((entry) => String(entry?.id || '') === String(calculationId || ''));
    const calculation = index >= 0 ? getToolCalculations()[index] : null;
    if (!calculation || calculation.type !== 'fixed-reaction' || calculation.mode !== 'reaction') {
      return false;
    }
    const inputs = {
      ...calculation.inputs,
      reagents: (Array.isArray(calculation.inputs?.reagents) ? calculation.inputs.reagents : []).map((row) => ({ ...row }))
    };
    if (field === 'totalVolumeValue') {
      inputs.totalVolumeValue = value;
    } else {
      const reagent = inputs.reagents[rowIndex];
      if (!reagent) {
        return false;
      }
      reagent[field] = value;
      if (field === 'manualVolumeValue' && !String(value).trim()) {
        // Clearing the volume hands the row back to its concentrations.
        delete reagent.manualVolumeValue;
      }
    }
    const result = calculateFixedReaction(inputs);
    getToolCalculations()[index] = {
      ...calculation,
      inputs: result.inputs || inputs,
      table: buildFixedReactionCalculationTable(result, {
        // Notes such as "set up one reaction each" belong to the page that
        // generated the table, not to the engine.
        extraMetaRows: (calculation.table?.metaRows || []).slice(1)
      }) || calculation.table,
      result: result.resultText || '',
      formula: result.formulaText || '',
      summary: result.resultText || result.formulaText || calculation.summary,
      status: result.status || ''
    };
    setToolCalculations(normalizeNotebookToolCalculations(getToolCalculations()));
    return true;
  }

  // The table on the page is the tool's output, not a snapshot of it: opening a
  // tool puts one there and every keystroke rewrites it in place, so there is
  // nothing to press.
  // ponytail: the sheet wins over cells edited on the page table while the tool
  // is open. Carry those edits back if anyone works both ends at once.
  function upsertToolCalculation(existingId = '') {
    const record = makeCalculationRecord();
    if (!record) {
      return String(existingId || '');
    }
    const calculations = getToolCalculations();
    const index = calculations.findIndex((item) => String(item?.id || '') === String(existingId || ''));
    if (index < 0) {
      setToolCalculations(normalizeNotebookToolCalculations(calculations.concat(record)));
      return record.id;
    }
    const next = calculations.slice();
    next[index] = { ...record, id: calculations[index].id, createdAt: calculations[index].createdAt || record.createdAt };
    setToolCalculations(normalizeNotebookToolCalculations(next));
    return next[index].id;
  }

  function removeToolCalculation(calculationId) {
    const id = String(calculationId || '');
    const remaining = getToolCalculations().filter((item) => String(item?.id || '') !== id);
    if (remaining.length === getToolCalculations().length) {
      return false;
    }
    setToolCalculations(normalizeNotebookToolCalculations(remaining));
    renderSavedCalculations();
    return true;
  }

  return {
    calculationTableForResult,
    makeCalculationRecord,
    applyCalculationEdit,
    upsertToolCalculation,
    removeToolCalculation
  };
}

export { createCalculationRecords };
