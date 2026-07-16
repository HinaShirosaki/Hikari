import {
  calculateBufferRecipe,
  calculateFixedReaction,
  calculateMolarity,
  resolveBufferCompound
} from '../../../lib/bench-calculations.js';
import { BUFFER_COMPOUNDS } from '../../../lib/chemistry/buffer-compounds.js';
import {
  buildNotebookToolCalculationsHtml,
  normalizeNotebookToolCalculations
} from '../../../lib/notebook-tool-calculations.js';

const BUFFER_ROW_COUNT = 6;
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

function extractPrimaryValue(text) {
  const source = String(text || '').trim();
  const colonMatch = source.match(/:\s*([^.\n]+)\.?/);
  if (colonMatch) {
    return colonMatch[1].trim();
  }
  return source.replace(/\.$/, '');
}

function createNoopController() {
  return {
    getCalculations: () => [],
    setCalculations: () => {},
    renderCalculations: () => {},
    getCurrentResult: () => null
  };
}

export function createNotebookToolSidebarController({
  doc = globalThis?.document || null,
  win = globalThis?.window || null,
  safeText,
  createId,
  notesInput,
  stepsHost,
  calculationsHost,
  getStoredCompounds = () => [],
  onAppendNote
} = {}) {
  const sidebar = typeof doc?.querySelector === 'function'
    ? doc.querySelector('[data-notebook-tool-sidebar]')
    : null;
  if (!sidebar) {
    return createNoopController();
  }

  const layout = getElement(doc, 'biology-notebook-layout');
  const collapseBtn = getElement(doc, 'biology-notebook-tool-collapse-btn');
  const foldToggle = getElement(doc, 'biology-notebook-tool-fold-toggle');
  const mobileToggle = getElement(doc, 'biology-notebook-tool-mobile-toggle');
  const toolWorkspace = getElement(doc, 'biology-notebook-tool-workspace');
  const toolBody = typeof sidebar.querySelector === 'function' ? sidebar.querySelector('.biology-notebook-tool-body') : null;
  const toolOutput = typeof sidebar.querySelector === 'function' ? sidebar.querySelector('.biology-notebook-tool-output') : null;
  const toolActions = typeof sidebar.querySelector === 'function' ? sidebar.querySelector('.biology-notebook-tool-actions') : null;
  const outputEl = getElement(doc, 'biology-notebook-tool-output');
  const formulaEl = getElement(doc, 'biology-notebook-tool-formula');
  const statusEl = getElement(doc, 'biology-notebook-tool-status');
  const insertNotesBtn = getElement(doc, 'biology-notebook-tool-insert-notes-btn');
  const usePlaceholderBtn = getElement(doc, 'biology-notebook-tool-use-placeholder-btn');
  const recordBtn = getElement(doc, 'biology-notebook-tool-record-btn');

  let activeTool = 'molarity';
  let activePlaceholderKey = '';
  let currentResult = null;
  let toolCalculations = [];

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

  function normalizeCandidateName(value) {
    return String(value || '').trim().toLowerCase();
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
        candidates.set(key, {
          ...candidate,
          name
        });
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

    (Array.isArray(getStoredCompounds?.()) ? getStoredCompounds() : []).forEach((record) => {
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
      const menu = getElement(doc, `biology-notebook-tool-buffer-suggestions-${rowIndex}`);
      if (menu) {
        menu.hidden = true;
        menu.innerHTML = '';
      }
    }
  }

  function renderBufferSuggestions(index) {
    const input = getElement(doc, `biology-notebook-tool-buffer-name-${index}`);
    const menu = getElement(doc, `biology-notebook-tool-buffer-suggestions-${index}`);
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
    const escapeText = typeof safeText === 'function' ? safeText : (value) => String(value || '');
    menu.innerHTML = matches.map((candidate) => {
      const meta = [
        candidate.mw ? `${candidate.mw} g/mol` : '',
        candidate.category,
        candidate.source
      ].filter(Boolean).join(' · ');
      return `
        <button type="button" class="biology-notebook-buffer-suggestion" data-buffer-candidate="${escapeText(candidate.name)}" role="option">
          <strong>${escapeText(candidate.name)}</strong>
          <span>${escapeText(meta)}</span>
        </button>
      `;
    }).join('');
    menu.hidden = false;
  }

  function selectBufferCandidate(index, candidateName) {
    const candidate = findBufferCandidate(candidateName);
    const nameInput = getElement(doc, `biology-notebook-tool-buffer-name-${index}`);
    const mwInput = getElement(doc, `biology-notebook-tool-buffer-mw-${index}`);
    if (!candidate || !nameInput) {
      return;
    }
    nameInput.value = candidate.name;
    if (mwInput && candidate.mw) {
      mwInput.value = candidate.mw;
    }
    closeBufferSuggestions(index);
    renderCurrentTool();
  }

  function mountToolWorkspace() {
    if (!toolWorkspace || !toolBody || toolBody.parentElement === toolWorkspace) {
      return;
    }
    [toolBody, toolOutput, toolActions, statusEl].filter(Boolean).forEach((element) => {
      toolWorkspace.appendChild(element);
    });
  }

  function showToolWorkspace() {
    mountToolWorkspace();
    if (toolWorkspace) {
      toolWorkspace.hidden = false;
    }
  }

  function setStatus(message) {
    setText(statusEl, message);
  }

  function renderSavedCalculations() {
    if (calculationsHost) {
      calculationsHost.innerHTML = buildNotebookToolCalculationsHtml({
        calculations: toolCalculations,
        safeText
      });
    }
  }

  function setSidebarOpen(isOpen) {
    layout?.classList?.toggle('is-tool-sidebar-open', Boolean(isOpen));
    layout?.classList?.toggle('is-tool-sidebar-collapsed', !isOpen);
    mobileToggle?.setAttribute?.('aria-expanded', isOpen ? 'true' : 'false');
    collapseBtn?.setAttribute?.('aria-expanded', isOpen ? 'true' : 'false');
    foldToggle?.setAttribute?.('aria-expanded', isOpen ? 'true' : 'false');
    setText(collapseBtn, isOpen ? 'Fold' : 'Open');
  }

  function togglePanel(toolId) {
    activeTool = toolId || 'molarity';
    showToolWorkspace();
    ['molarity', 'buffer', 'reaction'].forEach((id) => {
      const tab = getElement(doc, `biology-notebook-tool-tab-${id}`);
      const panel = getElement(doc, `biology-notebook-tool-panel-${id}`);
      const isActive = id === activeTool;
      tab?.classList?.toggle('is-active', isActive);
      tab?.setAttribute?.('aria-selected', isActive ? 'true' : 'false');
      if (panel) {
        panel.hidden = !isActive;
      }
    });
    renderCurrentTool();
  }

  function syncMolarityMode() {
    const mode = inputValue(getElement(doc, 'biology-notebook-tool-molarity-mode')) || 'mass';
    ['mass', 'volume', 'concentration', 'dilution'].forEach((id) => {
      const block = getElement(doc, `biology-notebook-tool-molarity-${id}`);
      if (block) {
        block.hidden = id !== mode;
      }
    });
  }

  function collectMolarityInputs() {
    const mode = inputValue(getElement(doc, 'biology-notebook-tool-molarity-mode')) || 'mass';
    if (mode === 'volume') {
      return {
        mode,
        inputs: {
          massValue: inputValue(getElement(doc, 'biology-notebook-tool-volume-mass')),
          massUnit: inputValue(getElement(doc, 'biology-notebook-tool-volume-mass-unit')) || 'mg',
          molecularWeight: inputValue(getElement(doc, 'biology-notebook-tool-volume-mw')),
          concentrationValue: inputValue(getElement(doc, 'biology-notebook-tool-volume-concentration')),
          concentrationUnit: inputValue(getElement(doc, 'biology-notebook-tool-volume-concentration-unit')) || 'mM',
          outputUnit: inputValue(getElement(doc, 'biology-notebook-tool-volume-output-unit')) || 'mL'
        }
      };
    }
    if (mode === 'concentration') {
      return {
        mode,
        inputs: {
          massValue: inputValue(getElement(doc, 'biology-notebook-tool-concentration-mass')),
          massUnit: inputValue(getElement(doc, 'biology-notebook-tool-concentration-mass-unit')) || 'mg',
          molecularWeight: inputValue(getElement(doc, 'biology-notebook-tool-concentration-mw')),
          volumeValue: inputValue(getElement(doc, 'biology-notebook-tool-concentration-volume')),
          volumeUnit: inputValue(getElement(doc, 'biology-notebook-tool-concentration-volume-unit')) || 'mL',
          outputUnit: inputValue(getElement(doc, 'biology-notebook-tool-concentration-output-unit')) || 'mM'
        }
      };
    }
    if (mode === 'dilution') {
      return {
        mode,
        inputs: {
          stockConcentrationValue: inputValue(getElement(doc, 'biology-notebook-tool-dilution-stock')),
          stockConcentrationUnit: inputValue(getElement(doc, 'biology-notebook-tool-dilution-stock-unit')) || 'mM',
          targetConcentrationValue: inputValue(getElement(doc, 'biology-notebook-tool-dilution-target')),
          targetConcentrationUnit: inputValue(getElement(doc, 'biology-notebook-tool-dilution-target-unit')) || 'mM',
          finalVolumeValue: inputValue(getElement(doc, 'biology-notebook-tool-dilution-volume')),
          finalVolumeUnit: inputValue(getElement(doc, 'biology-notebook-tool-dilution-volume-unit')) || 'mL',
          outputUnit: inputValue(getElement(doc, 'biology-notebook-tool-dilution-output-unit')) || 'mL'
        }
      };
    }
    return {
      mode: 'mass',
      inputs: {
        concentrationValue: inputValue(getElement(doc, 'biology-notebook-tool-mass-concentration')),
        concentrationUnit: inputValue(getElement(doc, 'biology-notebook-tool-mass-concentration-unit')) || 'mM',
        molecularWeight: inputValue(getElement(doc, 'biology-notebook-tool-mass-mw')),
        volumeValue: inputValue(getElement(doc, 'biology-notebook-tool-mass-volume')),
        volumeUnit: inputValue(getElement(doc, 'biology-notebook-tool-mass-volume-unit')) || 'mL',
        outputUnit: inputValue(getElement(doc, 'biology-notebook-tool-mass-output-unit')) || 'mg'
      }
    };
  }

  function calculateCurrentMolarity() {
    const { mode, inputs } = collectMolarityInputs();
    return calculateMolarity(mode, inputs);
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
    for (let index = 1; index <= BUFFER_ROW_COUNT; index += 1) {
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
        finalConcentration: inputValue(getElement(doc, `biology-notebook-tool-buffer-final-${index}`))
      });
    }
    return rows;
  }

  function calculateCurrentBuffer() {
    return calculateBufferRecipe({
      volumeMl: inputValue(getElement(doc, 'biology-notebook-tool-buffer-volume')),
      pH: inputValue(getElement(doc, 'biology-notebook-tool-buffer-ph')),
      rows: collectBufferRows()
    });
  }

  function collectReactionRows() {
    const rows = [];
    for (let index = 1; index <= REACTION_ROW_COUNT; index += 1) {
      if (isHidden(getElement(doc, `biology-notebook-tool-reaction-row-${index}`))) {
        continue;
      }
      rows.push({
        rowIndex: index,
        name: inputValue(getElement(doc, `biology-notebook-tool-reaction-name-${index}`)),
        stockConcentration: inputValue(getElement(doc, `biology-notebook-tool-reaction-stock-${index}`)),
        finalConcentration: inputValue(getElement(doc, `biology-notebook-tool-reaction-final-${index}`)),
        manualVolumeValue: inputValue(getElement(doc, `biology-notebook-tool-reaction-volume-${index}`))
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
    if (activeTool === 'buffer') {
      return calculateCurrentBuffer();
    }
    if (activeTool === 'reaction') {
      return calculateCurrentReaction();
    }
    return calculateCurrentMolarity();
  }

  function resultTextAfterName(text) {
    const source = String(text || '').trim();
    const match = source.match(/^[^:]+:\s*(.+?)\.?$/s);
    return match ? match[1].trim() : source;
  }

  function renderBufferTableResult(result) {
    for (let index = 1; index <= BUFFER_ROW_COUNT; index += 1) {
      setText(getElement(doc, `biology-notebook-tool-buffer-output-${index}`), '');
    }
    (Array.isArray(result?.details) ? result.details : []).forEach((detail) => {
      const rowIndex = Number(detail?.rowIndex) || 0;
      const output = rowIndex ? getElement(doc, `biology-notebook-tool-buffer-output-${rowIndex}`) : null;
      if (!output) {
        return;
      }
      const rowDetail = Array.isArray(detail.details) ? detail.details[0] : null;
      const suffix = detail.resultText && /\bstock\./i.test(detail.resultText) ? ' stock' : '';
      setText(output, rowDetail?.quantityText ? `${rowDetail.quantityText}${suffix}` : resultTextAfterName(detail.resultText));
    });
    setText(getElement(doc, 'biology-notebook-tool-buffer-solvent-output'), result?.solvent?.text || '');
    setText(getElement(doc, 'biology-notebook-tool-buffer-naoh-output'), result?.phAdjustment?.naohText || '');
    setText(getElement(doc, 'biology-notebook-tool-buffer-hcl-output'), result?.phAdjustment?.hclText || '');
  }

  function renderReactionTableResult(result) {
    for (let index = 1; index <= REACTION_ROW_COUNT; index += 1) {
      setText(getElement(doc, `biology-notebook-tool-reaction-output-${index}`), '');
    }
    (Array.isArray(result?.details) ? result.details : []).forEach((detail) => {
      const rowIndex = Number(detail?.rowIndex) || 0;
      const output = rowIndex ? getElement(doc, `biology-notebook-tool-reaction-output-${rowIndex}`) : null;
      if (!output) {
        return;
      }
      const rowDetail = Array.isArray(detail.details) ? detail.details[0] : null;
      setText(output, rowDetail?.quantityText || resultTextAfterName(detail.resultText));
    });
    setText(getElement(doc, 'biology-notebook-tool-reaction-solvent-output'), result?.fill?.text || resultTextAfterName(result?.fill?.resultText || ''));
  }

  function renderCurrentTool() {
    syncMolarityMode();
    currentResult = calculateActiveTool();
    if (activeTool === 'buffer') {
      renderBufferTableResult(currentResult);
    } else if (activeTool === 'reaction') {
      renderReactionTableResult(currentResult);
    }
    const hideSummaryOutput = activeTool === 'buffer';
    if (toolOutput) {
      toolOutput.hidden = hideSummaryOutput;
    }
    if (hideSummaryOutput) {
      setText(outputEl, '');
      setText(formulaEl, '');
    } else {
      const output = currentResult?.resultText || 'Use the formula below with bench values.';
      setText(outputEl, output);
      setText(formulaEl, currentResult?.formulaText || '');
    }
    if (currentResult?.status === 'warning') {
      setStatus(currentResult.resultText || 'Check the input values.');
    } else if (currentResult?.missing?.length) {
      setStatus(`Formula shown for: ${currentResult.missing.join(', ')}.`);
    } else {
      setStatus('');
    }
  }

  function getCurrentLine() {
    const result = currentResult || calculateActiveTool();
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
    const volumeValue = cleanCell(result.inputs?.volumeMl);
    return {
      caption: 'Buffer Preparer',
      metaRows: [[
        'Volume',
        volumeValue ? `${volumeValue} mL` : '',
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
    if (!result || result.type !== 'fixed-reaction' || result.mode !== 'reaction') {
      return null;
    }
    const rows = (Array.isArray(result.details) ? result.details : []).map((detail) => {
      const rowDetail = Array.isArray(detail.details) ? detail.details[0] : null;
      return [
        cleanCell(rowDetail?.name || detail.inputs?.name),
        concentrationText(rowDetail?.stockConcentration, detail.inputs?.stockConcentration),
        concentrationText(rowDetail?.finalConcentration, detail.inputs?.finalConcentration),
        cleanCell(rowDetail?.quantityText || resultTextAfterName(detail.resultText))
      ];
    }).filter((row) => row.some(Boolean));
    if (!rows.length && !result.fill?.text) {
      return null;
    }
    const totalVolume = cleanCell(result.inputs?.totalVolumeValue);
    const totalUnit = cleanCell(result.inputs?.totalVolumeUnit);
    return {
      caption: 'Fixed Volume Reaction',
      metaRows: [[
        'Total volume',
        totalVolume && /\D/u.test(totalVolume) ? totalVolume : [totalVolume, totalUnit].filter(Boolean).join(' '),
        '',
        ''
      ]],
      headers: ['Item', 'Stock Conc.', 'Final Conc.', 'Volume'],
      rows,
      footerRows: [[cleanCell(result.fill?.name || result.inputs?.fillName || 'Solvent'), '', '', cleanCell(result.fill?.text || resultTextAfterName(result.fill?.resultText || ''))]]
    };
  }

  function calculationTableForResult(result) {
    return bufferCalculationTable(result) || reactionCalculationTable(result);
  }

  function makeCalculationRecord() {
    const result = currentResult || calculateActiveTool();
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

  function recordCurrentCalculation() {
    const record = makeCalculationRecord();
    if (!record) {
      setStatus('Enter a calculation or formula before recording.');
      return null;
    }
    toolCalculations = normalizeNotebookToolCalculations(toolCalculations.concat(record));
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

  function rememberActivePlaceholder(event) {
    const target = event?.target;
    const placeholderElement = target?.closest?.('[data-inline-token], [data-inline-input], [data-nb-key]');
    const key = String(
      placeholderElement?.dataset?.nbKey
      || placeholderElement?.dataset?.nbKeyRef
      || ''
    ).trim();
    if (key) {
      activePlaceholderKey = key;
    }
  }

  function useForActivePlaceholder() {
    if (!activePlaceholderKey || !stepsHost?.querySelector) {
      setStatus('Click a protocol placeholder first.');
      return;
    }
    const result = currentResult || calculateActiveTool();
    const value = extractPrimaryValue(result?.resultText || result?.formulaText || '');
    if (!value) {
      setStatus('Enter a calculation before filling a placeholder.');
      return;
    }
    const hiddenInput = stepsHost.querySelector(`[data-nb-key="${activePlaceholderKey}"]`);
    if (!hiddenInput) {
      setStatus('Click a protocol placeholder first.');
      return;
    }
    hiddenInput.value = value;
    const wrap = hiddenInput.closest?.('[data-inline-placeholder]');
    const token = wrap?.querySelector?.('[data-inline-token]');
    const editor = wrap?.querySelector?.('[data-inline-input]');
    if (token) {
      token.textContent = value;
      token.hidden = false;
      token.classList?.toggle('is-empty', false);
    }
    if (editor) {
      editor.value = value;
      editor.hidden = true;
    }
    if (typeof win?.Event === 'function') {
      hiddenInput.dispatchEvent?.(new win.Event('input', { bubbles: true }));
    }
    const record = recordCurrentCalculation();
    if (record) {
      setStatus('Placeholder filled and calculation recorded for the next save.');
    }
  }

  function revealNextRow(prefix, count) {
    for (let index = 1; index <= count; index += 1) {
      const row = getElement(doc, `${prefix}-${index}`);
      if (row?.hidden) {
        row.hidden = false;
        renderCurrentTool();
        return;
      }
    }
    setStatus('All available rows are already visible.');
  }

  ['molarity', 'buffer', 'reaction'].forEach((id) => {
    addListener(getElement(doc, `biology-notebook-tool-tab-${id}`), 'click', () => togglePanel(id));
  });
  addListener(getElement(doc, 'biology-notebook-tool-molarity-mode'), 'change', renderCurrentTool);
  addListener(getElement(doc, 'biology-notebook-tool-buffer-add-row'), 'click', () => {
    revealNextRow('biology-notebook-tool-buffer-row', BUFFER_ROW_COUNT);
  });
  addListener(getElement(doc, 'biology-notebook-tool-reaction-add-row'), 'click', () => {
    revealNextRow('biology-notebook-tool-reaction-row', REACTION_ROW_COUNT);
  });
  for (let index = 1; index <= BUFFER_ROW_COUNT; index += 1) {
    const nameInput = getElement(doc, `biology-notebook-tool-buffer-name-${index}`);
    const suggestions = getElement(doc, `biology-notebook-tool-buffer-suggestions-${index}`);
    addListener(nameInput, 'focus', () => renderBufferSuggestions(index));
    addListener(nameInput, 'input', () => {
      syncBufferCompound(index, { overwriteMw: true });
      renderBufferSuggestions(index);
      renderCurrentTool();
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
  }
  addListener(recordBtn, 'click', recordCurrentCalculation);
  addListener(insertNotesBtn, 'click', insertCurrentIntoNotes);
  addListener(usePlaceholderBtn, 'click', useForActivePlaceholder);
  addListener(collapseBtn, 'click', () => setSidebarOpen(false));
  addListener(foldToggle, 'click', () => setSidebarOpen(true));
  addListener(mobileToggle, 'click', () => {
    const isOpen = layout?.classList?.contains?.('is-tool-sidebar-open');
    setSidebarOpen(!isOpen);
  });
  addListener(stepsHost, 'click', rememberActivePlaceholder);
  addListener(stepsHost, 'focusin', rememberActivePlaceholder);

  const interactiveIds = [
    'biology-notebook-tool-molarity-mode',
    'biology-notebook-tool-mass-concentration',
    'biology-notebook-tool-mass-concentration-unit',
    'biology-notebook-tool-mass-mw',
    'biology-notebook-tool-mass-volume',
    'biology-notebook-tool-mass-volume-unit',
    'biology-notebook-tool-mass-output-unit',
    'biology-notebook-tool-volume-mass',
    'biology-notebook-tool-volume-mass-unit',
    'biology-notebook-tool-volume-mw',
    'biology-notebook-tool-volume-concentration',
    'biology-notebook-tool-volume-concentration-unit',
    'biology-notebook-tool-volume-output-unit',
    'biology-notebook-tool-concentration-mass',
    'biology-notebook-tool-concentration-mass-unit',
    'biology-notebook-tool-concentration-mw',
    'biology-notebook-tool-concentration-volume',
    'biology-notebook-tool-concentration-volume-unit',
    'biology-notebook-tool-concentration-output-unit',
    'biology-notebook-tool-dilution-stock',
    'biology-notebook-tool-dilution-stock-unit',
    'biology-notebook-tool-dilution-target',
    'biology-notebook-tool-dilution-target-unit',
    'biology-notebook-tool-dilution-volume',
    'biology-notebook-tool-dilution-volume-unit',
    'biology-notebook-tool-dilution-output-unit',
    'biology-notebook-tool-buffer-volume',
    'biology-notebook-tool-buffer-ph',
    'biology-notebook-tool-reaction-total-volume',
    'biology-notebook-tool-reaction-fill-name'
  ];
  for (let index = 1; index <= BUFFER_ROW_COUNT; index += 1) {
    interactiveIds.push(
      `biology-notebook-tool-buffer-name-${index}`,
      `biology-notebook-tool-buffer-mw-${index}`,
      `biology-notebook-tool-buffer-stock-${index}`,
      `biology-notebook-tool-buffer-final-${index}`
    );
  }
  for (let index = 1; index <= REACTION_ROW_COUNT; index += 1) {
    interactiveIds.push(
      `biology-notebook-tool-reaction-name-${index}`,
      `biology-notebook-tool-reaction-stock-${index}`,
      `biology-notebook-tool-reaction-final-${index}`,
      `biology-notebook-tool-reaction-volume-${index}`
    );
  }
  interactiveIds.forEach((id) => {
    const element = getElement(doc, id);
    addListener(element, 'input', renderCurrentTool);
    addListener(element, 'change', renderCurrentTool);
  });

  syncMolarityMode();
  renderCurrentTool();
  renderSavedCalculations();

  return {
    getCalculations: () => normalizeNotebookToolCalculations(toolCalculations),
    setCalculations: (calculations) => {
      toolCalculations = normalizeNotebookToolCalculations(calculations);
      renderSavedCalculations();
    },
    renderCalculations: renderSavedCalculations,
    getCurrentResult: () => currentResult
  };
}
