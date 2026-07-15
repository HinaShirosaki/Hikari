import { BUFFER_COMPOUNDS } from '../../lib/chemistry/buffer-compounds.js';
import { escapeHtml } from './common.js';
import {
  calculateBufferRecipe,
  resolveBufferCompound
} from '../../lib/bench-calculations.js';

const BUFFER_ROW_COUNT = 6;

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

function revealNextRow(doc) {
  for (let index = 1; index <= BUFFER_ROW_COUNT; index += 1) {
    const row = getElement(doc, `buffer-row-${index}`);
    if (row?.hidden) {
      row.hidden = false;
      return true;
    }
  }
  return false;
}

export function initBufferTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const bufferVolumeInput = getElement(rootDocument, 'buffer-volume-ml');
  const bufferPhInput = getElement(rootDocument, 'buffer-ph');
  const bufferRows = getElement(rootDocument, 'buffer-rows');
  const addBufferChemicalBtn = getElement(rootDocument, 'add-buffer-chemical-btn');
  const bufferTotalResult = getElement(rootDocument, 'buffer-total-result');
  if (!bufferVolumeInput || !bufferRows || !addBufferChemicalBtn || !bufferTotalResult) {
    return;
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
    for (let rowIndex = 1; rowIndex <= BUFFER_ROW_COUNT; rowIndex += 1) {
      if (index && rowIndex !== index) {
        continue;
      }
      const menu = getElement(rootDocument, `buffer-suggestions-${rowIndex}`);
      if (menu) {
        menu.hidden = true;
        menu.innerHTML = '';
      }
    }
  }

  function renderBufferSuggestions(index) {
    const input = getElement(rootDocument, `buffer-name-${index}`);
    const menu = getElement(rootDocument, `buffer-suggestions-${index}`);
    if (!input || !menu) {
      return;
    }
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
    for (let index = 1; index <= BUFFER_ROW_COUNT; index += 1) {
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
        finalConcentration: inputValue(getElement(rootDocument, `buffer-final-${index}`))
      });
    }
    return rows;
  }

  function renderBufferTableResult(result) {
    for (let index = 1; index <= BUFFER_ROW_COUNT; index += 1) {
      setText(getElement(rootDocument, `buffer-output-${index}`), '');
    }
    (Array.isArray(result?.details) ? result.details : []).forEach((detail) => {
      const rowIndex = Number(detail?.rowIndex) || 0;
      const output = rowIndex ? getElement(rootDocument, `buffer-output-${rowIndex}`) : null;
      if (!output) {
        return;
      }
      const rowDetail = Array.isArray(detail.details) ? detail.details[0] : null;
      const suffix = detail.resultText && /\bstock\./i.test(detail.resultText) ? ' stock' : '';
      setText(output, rowDetail?.quantityText ? `${rowDetail.quantityText}${suffix}` : resultTextAfterName(detail.resultText));
    });
    setText(getElement(rootDocument, 'buffer-solvent-output'), result?.solvent?.text || '');
    setText(getElement(rootDocument, 'buffer-naoh-output'), result?.phAdjustment?.naohText || '');
    setText(getElement(rootDocument, 'buffer-hcl-output'), result?.phAdjustment?.hclText || '');
  }

  function renderBuffer() {
    const result = calculateBufferRecipe({
      volumeMl: inputValue(bufferVolumeInput),
      pH: inputValue(bufferPhInput),
      rows: collectBufferRows()
    });
    renderBufferTableResult(result);
    bufferTotalResult.textContent = result?.resultText || '';
    bufferTotalResult.hidden = true;
  }

  addBufferChemicalBtn.addEventListener('click', () => {
    revealNextRow(rootDocument);
    renderBuffer();
  });

  addListener(bufferVolumeInput, 'input', renderBuffer);
  addListener(bufferPhInput, 'input', renderBuffer);

  for (let index = 1; index <= BUFFER_ROW_COUNT; index += 1) {
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
      `buffer-final-${index}`
    ].forEach((id) => {
      const element = getElement(rootDocument, id);
      addListener(element, 'input', renderBuffer);
      addListener(element, 'change', renderBuffer);
    });
  }

  addListener(rootDocument, 'click', (event) => {
    if (!event?.target?.closest?.('.tool-box-buffer-autocomplete')) {
      closeBufferSuggestions();
    }
  });

  renderBuffer();
}
