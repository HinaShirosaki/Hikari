import { calculateFixedReaction } from './bench-calculations.js';

const REACTION_ROW_COUNT = 6;

function getElement(doc, id) {
  return doc?.getElementById?.(id) || null;
}

function addListener(element, eventName, handler) {
  if (element && typeof element.addEventListener === 'function') {
    element.addEventListener(eventName, handler);
  }
}

function setText(element, value) {
  if (element) {
    element.textContent = String(value || '');
  }
}

function inputValue(element) {
  return element?.value ?? '';
}

function isHidden(element) {
  return Boolean(element?.hidden);
}

function resultTextAfterName(text) {
  const source = String(text || '').trim();
  const match = source.match(/^[^:]+:\s*(.+?)\.?$/s);
  return match ? match[1].trim() : source;
}

function revealNextRow(doc) {
  for (let index = 1; index <= REACTION_ROW_COUNT; index += 1) {
    const row = getElement(doc, `fixed-reaction-row-${index}`);
    if (row?.hidden) {
      row.hidden = false;
      return true;
    }
  }
  return false;
}

export function initFixedReactionTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const rowsHost = getElement(rootDocument, 'fixed-reaction-rows');
  const addRowBtn = getElement(rootDocument, 'fixed-reaction-add-row-btn');
  const fillNameInput = getElement(rootDocument, 'fixed-reaction-fill-name');
  const totalVolumeInput = getElement(rootDocument, 'fixed-reaction-total-volume');
  if (!rowsHost || !addRowBtn || !fillNameInput || !totalVolumeInput) {
    return;
  }

  function collectReactionRows() {
    const rows = [];
    for (let index = 1; index <= REACTION_ROW_COUNT; index += 1) {
      if (isHidden(getElement(rootDocument, `fixed-reaction-row-${index}`))) {
        continue;
      }
      rows.push({
        rowIndex: index,
        name: inputValue(getElement(rootDocument, `fixed-reaction-name-${index}`)),
        stockConcentration: inputValue(getElement(rootDocument, `fixed-reaction-stock-${index}`)),
        finalConcentration: inputValue(getElement(rootDocument, `fixed-reaction-final-${index}`)),
        manualVolumeValue: inputValue(getElement(rootDocument, `fixed-reaction-volume-${index}`))
      });
    }
    return rows;
  }

  function renderReactionTableResult(result) {
    for (let index = 1; index <= REACTION_ROW_COUNT; index += 1) {
      setText(getElement(rootDocument, `fixed-reaction-output-${index}`), '');
    }
    (Array.isArray(result?.details) ? result.details : []).forEach((detail) => {
      const rowIndex = Number(detail?.rowIndex) || 0;
      const output = rowIndex ? getElement(rootDocument, `fixed-reaction-output-${rowIndex}`) : null;
      if (!output) {
        return;
      }
      const rowDetail = Array.isArray(detail.details) ? detail.details[0] : null;
      setText(output, rowDetail?.quantityText || resultTextAfterName(detail.resultText));
    });
    setText(getElement(rootDocument, 'fixed-reaction-solvent-output'), result?.fill?.text || resultTextAfterName(result?.fill?.resultText || ''));
  }

  function renderReaction() {
    const result = calculateFixedReaction({
      totalVolumeValue: inputValue(totalVolumeInput),
      totalVolumeUnit: 'uL',
      fillName: inputValue(fillNameInput) || 'Water / buffer',
      reagents: collectReactionRows()
    });
    renderReactionTableResult(result);
  }

  addRowBtn.addEventListener('click', () => {
    revealNextRow(rootDocument);
    renderReaction();
  });

  [
    'fixed-reaction-total-volume',
    'fixed-reaction-fill-name'
  ].forEach((id) => {
    const element = getElement(rootDocument, id);
    addListener(element, 'input', renderReaction);
    addListener(element, 'change', renderReaction);
  });

  for (let index = 1; index <= REACTION_ROW_COUNT; index += 1) {
    [
      `fixed-reaction-name-${index}`,
      `fixed-reaction-stock-${index}`,
      `fixed-reaction-final-${index}`,
      `fixed-reaction-volume-${index}`
    ].forEach((id) => {
      const element = getElement(rootDocument, id);
      addListener(element, 'input', renderReaction);
      addListener(element, 'change', renderReaction);
    });
  }

  renderReaction();
}
