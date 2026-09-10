import { BUFFER_COMPOUNDS } from '../../lib/chemistry/buffer-compounds.js';
import { escapeHtml } from './common.js';
import {
  calculateBufferRecipe,
  resolveBufferCompound
} from '../../lib/bench-calculations.js';

const BUFFER_STATIC_ROW_COUNT = 6;
const BUFFER_SUGGESTION_MAX_HEIGHT = 230;
const BUFFER_SUGGESTION_VIEWPORT_GAP = 8;

function getElement(doc, id) {
  return doc?.getElementById?.(id) || null;
}

function addListener(element, eventName, handler, options) {
  if (element && typeof element.addEventListener === 'function') {
    element.addEventListener(eventName, handler, options);
  }
}

function setText(element, value) {
  if (element) {
    element.textContent = String(value || '');
  }
}

function setPlaceholder(element, value) {
  if (element) {
    element.placeholder = String(value || '');
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

function normalizeCandidateName(value) {
  return String(value || '').trim().toLowerCase();
}

function extractCompoundMw(record) {
  const source = record && typeof record === 'object' ? record : {};
  const keys = ['mw', 'molecularWeight', 'molecular_weight', 'formulaWeight', 'formula_weight', 'formulaMass', 'molarMass', 'fw'];
  for (const key of keys) {
    const parsed = Number(source[key]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return '';
}

function inferCompoundForm(record) {
  const source = record && typeof record === 'object' ? record : {};
  const formText = [
    source.form,
    source.physicalForm,
    source.state,
    source.type,
    source.unitSize,
    source.amountInStock
  ].map((item) => String(item || '').toLowerCase()).join(' ');
  return /\b(liquid|solution|ml|ul|l)\b/.test(formText) ? 'liquid' : 'solid';
}

export function initBufferTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const bufferVolumeInput = getElement(rootDocument, 'buffer-volume-ml');
  const bufferVolumeUnit = getElement(rootDocument, 'buffer-volume-unit');
  const bufferPhInput = getElement(rootDocument, 'buffer-ph');
  const bufferRows = getElement(rootDocument, 'buffer-rows');
  const addBufferChemicalBtn = getElement(rootDocument, 'add-buffer-chemical-btn');
  const bufferTotalResult = getElement(rootDocument, 'buffer-total-result');
  if (!bufferVolumeInput || !bufferVolumeUnit || !bufferRows || !addBufferChemicalBtn || !bufferTotalResult) {
    return;
  }

  // ponytail: snapshot row 1 now — its suggestion menu gets reparented to <body> once it floats.
  const rowTemplate = getElement(rootDocument, 'buffer-row-1')?.cloneNode?.(true) || null;
  let rowTotal = BUFFER_STATIC_ROW_COUNT;

  function rowCount() {
    return rowTotal;
  }

  function insertBufferRowBeforeAdjustment(row) {
    const anchorRow = ['buffer-add-row', 'buffer-adjustment-row']
      .map((id) => getElement(rootDocument, id))
      .find((candidate) => candidate?.parentElement === bufferRows);
    if (anchorRow && typeof bufferRows.insertBefore === 'function') {
      bufferRows.insertBefore(row, anchorRow);
      return;
    }
    bufferRows.appendChild(row);
  }

  function appendBufferRow() {
    if (!rowTemplate?.cloneNode) {
      return;
    }
    const index = rowTotal + 1;
    const row = rowTemplate.cloneNode(true);
    row.hidden = false;
    row.id = `buffer-row-${index}`;
    row.querySelectorAll('[id]').forEach((element) => {
      element.id = `${element.id.replace(/-\d+$/, '')}-${index}`;
      element.value = '';
      element.textContent = '';
      const label = element.getAttribute?.('aria-label');
      if (label) {
        element.setAttribute('aria-label', label.replace(/\d+/, String(index)));
      }
      const controls = element.getAttribute?.('aria-controls');
      if (controls) {
        element.setAttribute('aria-controls', controls.replace(/-\d+$/, `-${index}`));
      }
      if (element.dataset?.bufferChemicalIndex) {
        element.dataset.bufferChemicalIndex = String(index);
      }
    });
    insertBufferRowBeforeAdjustment(row);
    rowTotal = index;
    bindBufferRow(index);
  }

  function revealOrAddRow() {
    for (let index = 1; index <= rowTotal; index += 1) {
      const row = getElement(rootDocument, `buffer-row-${index}`);
      if (row?.hidden) {
        row.hidden = false;
        return;
      }
    }
    appendBufferRow();
  }

  function removeBufferRow(index) {
    const row = getElement(rootDocument, `buffer-row-${index}`);
    if (!row || row.hidden) {
      return;
    }
    closeBufferSuggestions(index);
    [
      `buffer-name-${index}`,
      `buffer-mw-${index}`,
      `buffer-stock-${index}`,
      `buffer-final-${index}`,
      `buffer-amount-${index}`,
      `buffer-note-${index}`
    ].forEach((id) => {
      const input = getElement(rootDocument, id);
      if (input) {
        input.value = '';
      }
    });
    row.hidden = true;
  }

  function buildBufferCandidates() {
    const candidates = new Map();
    function mergeCandidate(candidate) {
      const name = String(candidate?.name || '').trim();
      if (!name) {
        return;
      }
      const key = normalizeCandidateName(name);
      const existing = candidates.get(key);
      if (!existing) {
        candidates.set(key, { ...candidate, name });
        return;
      }
      if (candidate.source === 'Stored') {
        candidates.set(key, {
          ...existing,
          ...candidate,
          mw: candidate.mw || existing.mw,
          form: candidate.form || existing.form,
          category: candidate.category || existing.category
        });
        return;
      }
      candidates.set(key, {
        ...existing,
        mw: existing.mw || candidate.mw,
        form: existing.form || candidate.form,
        category: existing.category || candidate.category
      });
    }

    (Array.isArray(options.getStoredCompounds?.()) ? options.getStoredCompounds() : []).forEach((record) => {
      mergeCandidate({
        source: 'Stored',
        name: record?.name,
        mw: extractCompoundMw(record),
        form: inferCompoundForm(record),
        category: record?.casNumber ? `CAS ${record.casNumber}` : 'Stored compound'
      });
    });
    BUFFER_COMPOUNDS.forEach((compound) => {
      mergeCandidate({
        source: 'Tools',
        name: compound.name,
        mw: compound.mw,
        form: compound.form === 'liquid' ? 'liquid' : 'solid',
        category: compound.category || 'Buffer compound'
      });
    });
    return [...candidates.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  function findBufferCandidate(name) {
    const key = normalizeCandidateName(name);
    if (!key) {
      return null;
    }
    return buildBufferCandidates().find((candidate) => normalizeCandidateName(candidate.name) === key)
      || resolveBufferCompound(name)
      || null;
  }

  function bufferCandidateForm(name) {
    const candidate = findBufferCandidate(name);
    return candidate?.form === 'liquid' ? 'liquid' : 'solid';
  }

  function closeBufferSuggestions(index = null) {
    for (let rowIndex = 1; rowIndex <= rowCount(); rowIndex += 1) {
      if (index && rowIndex !== index) {
        continue;
      }
      const menu = getElement(rootDocument, `buffer-suggestions-${rowIndex}`);
      if (menu) {
        menu.hidden = true;
        menu.innerHTML = '';
      }
      getElement(rootDocument, `buffer-name-${rowIndex}`)?.setAttribute?.('aria-expanded', 'false');
    }
  }

  function positionBufferSuggestions(index) {
    const input = getElement(rootDocument, `buffer-name-${index}`);
    const menu = getElement(rootDocument, `buffer-suggestions-${index}`);
    const inputRect = input?.getBoundingClientRect?.();
    const viewportWidth = Number(rootDocument?.documentElement?.clientWidth)
      || Number(rootDocument?.defaultView?.innerWidth)
      || 0;
    const viewportHeight = Number(rootDocument?.documentElement?.clientHeight)
      || Number(rootDocument?.defaultView?.innerHeight)
      || 0;
    if (!inputRect || !viewportWidth || !viewportHeight || !menu?.style) {
      return false;
    }

    const overlayRoot = rootDocument?.body;
    if (overlayRoot && typeof overlayRoot.appendChild === 'function' && menu.parentElement !== overlayRoot) {
      overlayRoot.appendChild(menu);
    }
    menu.classList?.add?.('tool-box-buffer-suggestions--floating');

    const width = Math.min(
      Math.max(Number(inputRect.width) || 0, 1) + 2,
      Math.max(viewportWidth - (BUFFER_SUGGESTION_VIEWPORT_GAP * 2), 1)
    );
    const left = Math.min(
      Math.max((Number(inputRect.left) || 0) - 1, BUFFER_SUGGESTION_VIEWPORT_GAP),
      Math.max(BUFFER_SUGGESTION_VIEWPORT_GAP, viewportWidth - width - BUFFER_SUGGESTION_VIEWPORT_GAP)
    );
    const spaceBelow = Math.max(0, viewportHeight - Number(inputRect.bottom) - BUFFER_SUGGESTION_VIEWPORT_GAP);
    const spaceAbove = Math.max(0, Number(inputRect.top) - BUFFER_SUGGESTION_VIEWPORT_GAP);

    menu.style.left = `${Math.round(left)}px`;
    menu.style.right = 'auto';
    menu.style.width = `${Math.round(width)}px`;
    menu.style.maxHeight = `${Math.round(Math.min(BUFFER_SUGGESTION_MAX_HEIGHT, Math.max(spaceAbove, spaceBelow)))}px`;
    menu.hidden = false;

    const menuHeight = Math.min(
      BUFFER_SUGGESTION_MAX_HEIGHT,
      Number(menu.scrollHeight) || BUFFER_SUGGESTION_MAX_HEIGHT
    );
    if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
      menu.style.top = 'auto';
      menu.style.bottom = `${Math.round(viewportHeight - Number(inputRect.top) + 1)}px`;
      menu.style.maxHeight = `${Math.round(Math.min(BUFFER_SUGGESTION_MAX_HEIGHT, spaceAbove))}px`;
    } else {
      menu.style.top = `${Math.round(Number(inputRect.bottom) - 1)}px`;
      menu.style.bottom = 'auto';
      menu.style.maxHeight = `${Math.round(Math.min(BUFFER_SUGGESTION_MAX_HEIGHT, spaceBelow))}px`;
    }
    return true;
  }

  function repositionOpenBufferSuggestions() {
    for (let index = 1; index <= rowCount(); index += 1) {
      const menu = getElement(rootDocument, `buffer-suggestions-${index}`);
      if (menu && !menu.hidden) {
        positionBufferSuggestions(index);
      }
    }
  }

  function renderBufferSuggestions(index) {
    const input = getElement(rootDocument, `buffer-name-${index}`);
    const menu = getElement(rootDocument, `buffer-suggestions-${index}`);
    if (!input || !menu) {
      return;
    }
    closeBufferSuggestions();
    const query = String(input.value || '').trim().toLowerCase();
    const matches = buildBufferCandidates()
      .filter((candidate) => {
        if (!query) {
          return true;
        }
        return candidate.name.toLowerCase().includes(query)
          || String(candidate.category || '').toLowerCase().includes(query);
      })
      .slice(0, 8);
    if (!matches.length) {
      closeBufferSuggestions(index);
      return;
    }
    menu.innerHTML = matches.map((candidate) => {
      const meta = [
        candidate.mw ? `${candidate.mw} g/mol` : '',
        candidate.category,
        candidate.source
      ].filter(Boolean).join(' / ');
      return `
        <button type="button" class="tool-box-buffer-suggestion" data-buffer-candidate="${escapeHtml(candidate.name)}" role="option">
          <strong>${escapeHtml(candidate.name)}</strong>
          <span>${escapeHtml(meta)}</span>
        </button>
      `;
    }).join('');
    menu.hidden = false;
    input.setAttribute?.('aria-expanded', 'true');
    positionBufferSuggestions(index);
  }

  function selectBufferCandidate(index, candidateName) {
    const candidate = findBufferCandidate(candidateName);
    const nameInput = getElement(rootDocument, `buffer-name-${index}`);
    const mwInput = getElement(rootDocument, `buffer-mw-${index}`);
    if (!candidate || !nameInput) {
      return;
    }
    nameInput.value = candidate.name;
    if (mwInput && candidate.mw) {
      mwInput.value = candidate.mw;
    }
    closeBufferSuggestions(index);
    renderBuffer();
  }

  function syncBufferCompound(index, { overwriteMw = false } = {}) {
    const nameInput = getElement(rootDocument, `buffer-name-${index}`);
    const mwInput = getElement(rootDocument, `buffer-mw-${index}`);
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
    for (let index = 1; index <= rowCount(); index += 1) {
      if (isHidden(getElement(rootDocument, `buffer-row-${index}`))) {
        continue;
      }
      syncBufferCompound(index);
      const name = inputValue(getElement(rootDocument, `buffer-name-${index}`));
      rows.push({
        rowIndex: index,
        name,
        form: bufferCandidateForm(name),
        molecularWeight: inputValue(getElement(rootDocument, `buffer-mw-${index}`)),
        stockConcentration: inputValue(getElement(rootDocument, `buffer-stock-${index}`)),
        finalConcentration: inputValue(getElement(rootDocument, `buffer-final-${index}`)),
        manualQuantity: inputValue(getElement(rootDocument, `buffer-amount-${index}`)),
        note: inputValue(getElement(rootDocument, `buffer-note-${index}`))
      });
    }
    return rows;
  }

  // The calculated amount is the cell's placeholder, so a weighed-out value can
  // be typed straight over it instead of sitting on a second line.
  function renderBufferTableResult(result) {
    for (let index = 1; index <= rowCount(); index += 1) {
      setPlaceholder(getElement(rootDocument, `buffer-amount-${index}`), 'auto');
    }
    (Array.isArray(result?.details) ? result.details : []).forEach((detail) => {
      const rowIndex = Number(detail?.rowIndex) || 0;
      const amount = rowIndex ? getElement(rootDocument, `buffer-amount-${rowIndex}`) : null;
      if (!amount || String(amount.value || '').trim()) {
        return;
      }
      const rowDetail = Array.isArray(detail.details) ? detail.details[0] : null;
      const suffix = detail.resultText && /\bstock\./i.test(detail.resultText) ? ' stock' : '';
      setPlaceholder(amount, rowDetail?.quantityText ? `${rowDetail.quantityText}${suffix}` : resultTextAfterName(detail.resultText));
    });
    setText(getElement(rootDocument, 'buffer-solvent-output'), result?.solvent?.text || '');
    setText(getElement(rootDocument, 'buffer-naoh-output'), result?.phAdjustment?.naohText || '');
    setText(getElement(rootDocument, 'buffer-hcl-output'), result?.phAdjustment?.hclText || '');
  }

  function renderBuffer() {
    const result = calculateBufferRecipe({
      volumeValue: inputValue(bufferVolumeInput),
      volumeUnit: inputValue(bufferVolumeUnit) || 'mL',
      pH: inputValue(bufferPhInput),
      rows: collectBufferRows()
    });
    renderBufferTableResult(result);
    bufferTotalResult.textContent = result?.resultText || '';
    bufferTotalResult.hidden = true;
  }

  function bindBufferRow(index) {
    const nameInput = getElement(rootDocument, `buffer-name-${index}`);
    const suggestions = getElement(rootDocument, `buffer-suggestions-${index}`);
    addListener(nameInput, 'focus', () => renderBufferSuggestions(index));
    addListener(nameInput, 'input', () => {
      syncBufferCompound(index, { overwriteMw: true });
      renderBufferSuggestions(index);
      renderBuffer();
    });
    addListener(nameInput, 'keydown', (event) => {
      if (event?.key === 'Escape') {
        closeBufferSuggestions(index);
      }
    });
    addListener(suggestions, 'mousedown', (event) => {
      event?.preventDefault?.();
    });
    addListener(suggestions, 'click', (event) => {
      const button = event?.target?.closest?.('[data-buffer-candidate]')
        || (event?.target?.dataset?.bufferCandidate ? event.target : null);
      const candidateName = button?.dataset?.bufferCandidate || '';
      if (candidateName) {
        selectBufferCandidate(index, candidateName);
      }
    });
    [
      `buffer-mw-${index}`,
      `buffer-stock-${index}`,
      `buffer-final-${index}`,
      `buffer-amount-${index}`,
      `buffer-note-${index}`
    ].forEach((id) => {
      const element = getElement(rootDocument, id);
      addListener(element, 'input', renderBuffer);
      addListener(element, 'change', renderBuffer);
    });
  }

  addBufferChemicalBtn.addEventListener('click', () => {
    revealOrAddRow();
    renderBuffer();
  });

  addListener(bufferRows, 'click', (event) => {
    const removeButton = event?.target?.closest?.('[data-buffer-row-remove]');
    const row = removeButton?.closest?.('.tool-box-buffer-row');
    const rowIndex = Number(String(row?.id || '').match(/^buffer-row-(\d+)$/)?.[1]);
    if (!rowIndex) {
      return;
    }
    removeBufferRow(rowIndex);
    renderBuffer();
  });

  addListener(bufferVolumeInput, 'input', renderBuffer);
  addListener(bufferVolumeUnit, 'change', renderBuffer);
  addListener(bufferPhInput, 'input', renderBuffer);

  for (let index = 1; index <= rowCount(); index += 1) {
    bindBufferRow(index);
  }

  addListener(rootDocument, 'click', (event) => {
    if (!event?.target?.closest?.('.tool-box-buffer-autocomplete, .tool-box-buffer-suggestions')) {
      closeBufferSuggestions();
    }
  });
  addListener(rootDocument, 'scroll', repositionOpenBufferSuggestions, true);
  addListener(rootDocument?.defaultView, 'resize', repositionOpenBufferSuggestions);

  renderBuffer();
}
