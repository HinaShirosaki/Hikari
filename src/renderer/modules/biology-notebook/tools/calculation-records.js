import { calculateFixedReaction } from '../../../lib/bench-calculations.js';
import {
  buildFixedReactionCalculationTable,
  normalizeNotebookToolCalculations
} from '../../../lib/notebook-tool-calculations.js';

// Turning a bench-tool result into a saved calculation record (and its editable
// table), and inserting that result into the notebook page's notes.
function createCalculationRecords({
  createId,
  notesInput,
  onAppendNote,
  getToolCalculations,
  setToolCalculations,
  getCurrentResult,
  calculateActiveTool,
  resultTextAfterName,
  renderSavedCalculations,
  setStatus
} = {}) {
  function getCurrentLine() {
    const result = getCurrentResult() || calculateActiveTool();
    if (!result) {
      return '';
    }
    const main = result.resultText || result.formulaText;
    return `${result.title}: ${main}`.trim();
  }

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
        cleanCell(rowDetail?.quantityText || resultTextAfterName(detail.resultText))
      ];
    }).filter((row) => row.some(Boolean));
    if (!rows.length) {
      return null;
    }
    const footerRows = [[
      ['Solvent to add', cleanCell(result.solvent?.text)].filter(Boolean).join(' '),
      '',
      ['6 M NaOH', cleanCell(result.phAdjustment?.naohText)].filter(Boolean).join(' '),
      '',
      ['6 M HCl', cleanCell(result.phAdjustment?.hclText)].filter(Boolean).join(' ')
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
        ''
      ]],
      headers: ['Chemical', 'MW', 'Stock Conc.', 'Final Conc.', 'Mass/Volume'],
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

  function recordCurrentCalculation() {
    const record = makeCalculationRecord();
    if (!record) {
      setStatus('Enter a calculation or formula before recording.');
      return null;
    }
    setToolCalculations(normalizeNotebookToolCalculations(getToolCalculations().concat(record)));
    renderSavedCalculations();
    setStatus('Calculation recorded. Save the notebook page to persist it.');
    return record;
  }

  function appendToNotes(line) {
    const cleanLine = String(line || '').trim();
    if (!cleanLine) {
      return;
    }
    if (typeof onAppendNote === 'function') {
      onAppendNote(cleanLine);
      return;
    }
    if (!notesInput) {
      return;
    }
    const current = String(notesInput.value || '').trim();
    notesInput.value = current ? `${current}\n${cleanLine}` : cleanLine;
  }

  function insertCurrentIntoNotes() {
    const line = getCurrentLine();
    if (!line) {
      setStatus('Enter a calculation before inserting it.');
      return;
    }
    appendToNotes(line);
    const record = recordCurrentCalculation();
    if (record) {
      setStatus('Inserted into notes and recorded for the next save.');
    }
  }

  return {
    getCurrentLine,
    calculationTableForResult,
    makeCalculationRecord,
    applyCalculationEdit,
    recordCurrentCalculation,
    appendToNotes,
    insertCurrentIntoNotes
  };
}

export { createCalculationRecords };
