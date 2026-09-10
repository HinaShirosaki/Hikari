import { calculateBufferRecipe, calculateFixedReaction } from '../../../lib/bench-calculations.js';

// Reading the buffer / fixed-reaction forms, running the bench calculation for
// whichever tool is open, and rendering its result table.
function createToolCalculations({
  doc,
  getElement,
  inputValue,
  isHidden,
  setText,
  reactionRowCount,
  getActiveTool,
  getCurrentResult,
  setCurrentResult,
  bufferRowCount,
  bufferCandidateForm,
  findBufferCandidate
} = {}) {
  function setPlaceholder(element, value) {
    if (element) {
      element.placeholder = String(value || '');
    }
  }

  function syncBufferCompound(index, { overwriteMw = false } = {}) {
    const nameInput = getElement(doc, `biology-notebook-tool-buffer-name-${index}`);
    const mwInput = getElement(doc, `biology-notebook-tool-buffer-mw-${index}`);
    const compound = findBufferCandidate(inputValue(nameInput));
    if (!compound) {
      return;
    }
    if (mwInput && compound.mw && (overwriteMw || !String(mwInput.value || '').trim())) {
      mwInput.value = compound.mw;
    }
  }

  function collectBufferRows() {
    const rows = [];
    for (let index = 1; index <= bufferRowCount(); index += 1) {
      if (isHidden(getElement(doc, `biology-notebook-tool-buffer-row-${index}`))) {
        continue;
      }
      syncBufferCompound(index);
      const name = inputValue(getElement(doc, `biology-notebook-tool-buffer-name-${index}`));
      rows.push({
        rowIndex: index,
        name,
        form: bufferCandidateForm(name),
        molecularWeight: inputValue(getElement(doc, `biology-notebook-tool-buffer-mw-${index}`)),
        stockConcentration: inputValue(getElement(doc, `biology-notebook-tool-buffer-stock-${index}`)),
        finalConcentration: inputValue(getElement(doc, `biology-notebook-tool-buffer-final-${index}`)),
        manualQuantity: inputValue(getElement(doc, `biology-notebook-tool-buffer-amount-${index}`)),
        note: inputValue(getElement(doc, `biology-notebook-tool-buffer-note-${index}`))
      });
    }
    return rows;
  }

  function calculateCurrentBuffer() {
    return calculateBufferRecipe({
      volumeValue: inputValue(getElement(doc, 'biology-notebook-tool-buffer-volume')),
      volumeUnit: inputValue(getElement(doc, 'biology-notebook-tool-buffer-volume-unit')) || 'mL',
      pH: inputValue(getElement(doc, 'biology-notebook-tool-buffer-ph')),
      rows: collectBufferRows()
    });
  }

  function collectReactionRows() {
    const rows = [];
    for (let index = 1; index <= reactionRowCount(); index += 1) {
      if (isHidden(getElement(doc, `biology-notebook-tool-reaction-row-${index}`))) {
        continue;
      }
      rows.push({
        rowIndex: index,
        name: inputValue(getElement(doc, `biology-notebook-tool-reaction-name-${index}`)),
        stockConcentration: inputValue(getElement(doc, `biology-notebook-tool-reaction-stock-${index}`)),
        finalConcentration: inputValue(getElement(doc, `biology-notebook-tool-reaction-final-${index}`)),
        manualVolumeValue: inputValue(getElement(doc, `biology-notebook-tool-reaction-volume-${index}`)),
        note: inputValue(getElement(doc, `biology-notebook-tool-reaction-note-${index}`))
      });
    }
    return rows;
  }

  function calculateCurrentReaction() {
    return calculateFixedReaction({
      totalVolumeValue: inputValue(getElement(doc, 'biology-notebook-tool-reaction-total-volume')),
      totalVolumeUnit: 'uL',
      fillName: inputValue(getElement(doc, 'biology-notebook-tool-reaction-fill-name')) || 'Water / buffer',
      reagents: collectReactionRows()
    });
  }

  function calculateActiveTool() {
    return getActiveTool() === 'reaction' ? calculateCurrentReaction() : calculateCurrentBuffer();
  }

  function resultTextAfterName(text) {
    const source = String(text || '').trim();
    const match = source.match(/^[^:]+:\s*(.+?)\.?$/s);
    return match ? match[1].trim() : source;
  }

  function renderBufferTableResult(result) {
    for (let index = 1; index <= bufferRowCount(); index += 1) {
      setPlaceholder(getElement(doc, `biology-notebook-tool-buffer-amount-${index}`), 'auto');
    }
    (Array.isArray(result?.details) ? result.details : []).forEach((detail) => {
      const rowIndex = Number(detail?.rowIndex) || 0;
      const amount = rowIndex ? getElement(doc, `biology-notebook-tool-buffer-amount-${rowIndex}`) : null;
      if (!amount || String(amount.value || '').trim()) {
        return;
      }
      const rowDetail = Array.isArray(detail.details) ? detail.details[0] : null;
      const suffix = detail.resultText && /\bstock\./i.test(detail.resultText) ? ' stock' : '';
      setPlaceholder(amount, rowDetail?.quantityText ? `${rowDetail.quantityText}${suffix}` : resultTextAfterName(detail.resultText));
    });
    setText(getElement(doc, 'biology-notebook-tool-buffer-solvent-output'), result?.solvent?.text || '');
    setText(getElement(doc, 'biology-notebook-tool-buffer-naoh-output'), result?.phAdjustment?.naohText || '');
    setText(getElement(doc, 'biology-notebook-tool-buffer-hcl-output'), result?.phAdjustment?.hclText || '');
  }

  function renderReactionTableResult(result) {
    for (let index = 1; index <= reactionRowCount(); index += 1) {
      setPlaceholder(getElement(doc, `biology-notebook-tool-reaction-volume-${index}`), 'auto');
    }
    (Array.isArray(result?.details) ? result.details : []).forEach((detail) => {
      const rowIndex = Number(detail?.rowIndex) || 0;
      const volume = rowIndex ? getElement(doc, `biology-notebook-tool-reaction-volume-${rowIndex}`) : null;
      // A typed volume is the value; only an empty cell shows the calculated one.
      if (!volume || String(volume.value || '').trim()) {
        return;
      }
      const rowDetail = Array.isArray(detail.details) ? detail.details[0] : null;
      setPlaceholder(volume, rowDetail?.quantityText || resultTextAfterName(detail.resultText));
    });
    setText(getElement(doc, 'biology-notebook-tool-reaction-solvent-output'), result?.fill?.text || resultTextAfterName(result?.fill?.resultText || ''));
  }

  // The sheet is the whole readout: every number lands in a cell, so there is
  // no summary line, formula line or status line to keep in step with it.
  function renderCurrentTool() {
    setCurrentResult(calculateActiveTool());
    if (getActiveTool() === 'reaction') {
      renderReactionTableResult(getCurrentResult());
    } else {
      renderBufferTableResult(getCurrentResult());
    }
  }

  return {
    syncBufferCompound,
    collectBufferRows,
    calculateCurrentBuffer,
    collectReactionRows,
    calculateCurrentReaction,
    calculateActiveTool,
    resultTextAfterName,
    renderBufferTableResult,
    renderReactionTableResult,
    renderCurrentTool
  };
}

export { createToolCalculations };
