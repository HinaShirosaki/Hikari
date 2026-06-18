import {
  calculateBufferRecipe,
  calculateFixedReaction,
  calculateMolarity,
  resolveBufferCompound
} from '../tool-box/bench-calculations.js';
import {
  buildNotebookToolCalculationsHtml,
  formatNotebookToolCalculationLine,
  normalizeNotebookToolCalculations
} from './tool-calculations.js';

const BUFFER_ROW_COUNT = 4;
const REACTION_ROW_COUNT = 4;

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

  function syncBufferCompound(index) {
    const nameInput = getElement(doc, `biology-notebook-tool-buffer-name-${index}`);
    const mwInput = getElement(doc, `biology-notebook-tool-buffer-mw-${index}`);
    const formSelect = getElement(doc, `biology-notebook-tool-buffer-form-${index}`);
    const compound = resolveBufferCompound(inputValue(nameInput));
    if (!compound) {
      return;
    }
    if (mwInput && !String(mwInput.value || '').trim()) {
      mwInput.value = compound.mw;
    }
    if (formSelect && compound.form === 'liquid') {
      formSelect.value = 'liquid';
    }
  }

  function collectBufferRows() {
    const rows = [];
    for (let index = 1; index <= BUFFER_ROW_COUNT; index += 1) {
      if (isHidden(getElement(doc, `biology-notebook-tool-buffer-row-${index}`))) {
        continue;
      }
      syncBufferCompound(index);
      rows.push({
        name: inputValue(getElement(doc, `biology-notebook-tool-buffer-name-${index}`)),
        form: inputValue(getElement(doc, `biology-notebook-tool-buffer-form-${index}`)) || 'solid',
        molecularWeight: inputValue(getElement(doc, `biology-notebook-tool-buffer-mw-${index}`)),
        concentrationValue: inputValue(getElement(doc, `biology-notebook-tool-buffer-concentration-${index}`))
      });
    }
    return rows;
  }

  function calculateCurrentBuffer() {
    return calculateBufferRecipe({
      volumeMl: inputValue(getElement(doc, 'biology-notebook-tool-buffer-volume')),
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
        name: inputValue(getElement(doc, `biology-notebook-tool-reaction-name-${index}`)),
        stockValue: inputValue(getElement(doc, `biology-notebook-tool-reaction-stock-${index}`)),
        stockUnit: inputValue(getElement(doc, `biology-notebook-tool-reaction-stock-unit-${index}`)) || 'mM',
        finalValue: inputValue(getElement(doc, `biology-notebook-tool-reaction-final-${index}`)),
        finalUnit: inputValue(getElement(doc, `biology-notebook-tool-reaction-final-unit-${index}`)) || 'uM',
        manualVolumeValue: inputValue(getElement(doc, `biology-notebook-tool-reaction-volume-${index}`)),
        manualVolumeUnit: inputValue(getElement(doc, `biology-notebook-tool-reaction-volume-unit-${index}`)) || 'uL'
      });
    }
    return rows;
  }

  function calculateCurrentReaction() {
    return calculateFixedReaction({
      totalVolumeValue: inputValue(getElement(doc, 'biology-notebook-tool-reaction-total-volume')),
      totalVolumeUnit: inputValue(getElement(doc, 'biology-notebook-tool-reaction-total-unit')) || 'uL',
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

  function renderCurrentTool() {
    syncMolarityMode();
    currentResult = calculateActiveTool();
    const output = currentResult?.resultText || 'Use the formula below with bench values.';
    setText(outputEl, output);
    setText(formulaEl, currentResult?.formulaText || '');
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
    'biology-notebook-tool-reaction-total-volume',
    'biology-notebook-tool-reaction-total-unit',
    'biology-notebook-tool-reaction-fill-name'
  ];
  for (let index = 1; index <= BUFFER_ROW_COUNT; index += 1) {
    interactiveIds.push(
      `biology-notebook-tool-buffer-name-${index}`,
      `biology-notebook-tool-buffer-form-${index}`,
      `biology-notebook-tool-buffer-mw-${index}`,
      `biology-notebook-tool-buffer-concentration-${index}`
    );
  }
  for (let index = 1; index <= REACTION_ROW_COUNT; index += 1) {
    interactiveIds.push(
      `biology-notebook-tool-reaction-name-${index}`,
      `biology-notebook-tool-reaction-stock-${index}`,
      `biology-notebook-tool-reaction-stock-unit-${index}`,
      `biology-notebook-tool-reaction-final-${index}`,
      `biology-notebook-tool-reaction-final-unit-${index}`,
      `biology-notebook-tool-reaction-volume-${index}`,
      `biology-notebook-tool-reaction-volume-unit-${index}`
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
