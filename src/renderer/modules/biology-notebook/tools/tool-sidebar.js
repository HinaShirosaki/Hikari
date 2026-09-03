import {
  buildNotebookToolCalculationsHtml,
  normalizeNotebookToolCalculations
} from '../../../lib/notebook-tool-calculations.js';
import { createBufferSuggestions } from './buffer-suggestions.js';
import { createToolboxDrag } from './toolbox-drag.js';
import { createCalculationRecords } from './calculation-records.js';
import { createToolCalculations } from './tool-calculations.js';

const INITIAL_BUFFER_ROW_COUNT = 6;
const REACTION_ROW_COUNT = 6;
const BUFFER_SUGGESTION_MAX_HEIGHT = 230;
const BUFFER_SUGGESTION_VIEWPORT_GAP = 8;
const TOOLBOX_DRAG_THRESHOLD_PX = 4;
const TOOLBOX_FOLDED_SIZE_PX = 42;

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

function inputValue(element) {
  return element?.value ?? '';
}

function isHidden(element) {
  return Boolean(element?.hidden);
}

function createNoopController() {
  return {
    getCalculations: () => [],
    setCalculations: () => {},
    renderCalculations: () => {},
    getCurrentResult: () => null,
    clearSelection: () => {}
  };
}

export function createNotebookToolSidebarController({
  doc = globalThis?.document || null,
  win = globalThis?.window || null,
  safeText,
  createId,
  notesInput,
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
  const toolWorkspace = getElement(doc, 'biology-notebook-tool-workspace');
  const toolBody = typeof sidebar.querySelector === 'function' ? sidebar.querySelector('.biology-notebook-tool-body') : null;
  const toolOutput = typeof sidebar.querySelector === 'function' ? sidebar.querySelector('.biology-notebook-tool-output') : null;
  const toolActions = typeof sidebar.querySelector === 'function' ? sidebar.querySelector('.biology-notebook-tool-actions') : null;
  const outputEl = getElement(doc, 'biology-notebook-tool-output');
  const formulaEl = getElement(doc, 'biology-notebook-tool-formula');
  const statusEl = getElement(doc, 'biology-notebook-tool-status');
  const insertNotesBtn = getElement(doc, 'biology-notebook-tool-insert-notes-btn');
  const bufferRows = getElement(doc, 'biology-notebook-tool-buffer-rows');
  const bufferRowTemplate = getElement(doc, 'biology-notebook-tool-buffer-row-1')?.cloneNode?.(true) || null;

  let activeTool = '';
  let currentResult = null;
  let toolCalculations = [];
  let bufferRowTotal = INITIAL_BUFFER_ROW_COUNT;
  let toolboxDragState = null;
  let toolboxAnchor = null;
  let suppressFoldToggleClick = false;

  const {
    findBufferCandidate,
    bufferCandidateForm,
    bufferRowCount,
    closeBufferSuggestions,
    repositionOpenBufferSuggestions,
    renderBufferSuggestions,
    selectBufferCandidate
  } = createBufferSuggestions({
    doc,
    win,
    safeText,
    getElement,
    getStoredCompounds,
    BUFFER_SUGGESTION_MAX_HEIGHT,
    BUFFER_SUGGESTION_VIEWPORT_GAP,
    getBufferRowTotal: () => bufferRowTotal,
    renderCurrentTool: () => renderCurrentTool()
  });

  const {
    constrainToolboxPosition,
    beginToolboxDrag,
    moveToolbox,
    endToolboxDrag,
    setSidebarOpen
  } = createToolboxDrag({
    layout,
    sidebar,
    collapseBtn,
    foldToggle,
    toolboxAnchor,
    toolboxDragState,
    TOOLBOX_DRAG_THRESHOLD_PX,
    TOOLBOX_FOLDED_SIZE_PX,
    setSuppressFoldToggleClick: (value) => { suppressFoldToggleClick = value; }
  });

  function setStatus(message) {
    setText(statusEl, message);
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

  function renderSavedCalculations() {
    if (calculationsHost) {
      calculationsHost.innerHTML = buildNotebookToolCalculationsHtml({
        calculations: toolCalculations,
        safeText
      });
    }
  }


  function syncToolSelection() {
    ['buffer', 'reaction'].forEach((id) => {
      const tab = getElement(doc, `biology-notebook-tool-tab-${id}`);
      const panel = getElement(doc, `biology-notebook-tool-panel-${id}`);
      const isActive = id === activeTool;
      tab?.classList?.toggle('is-active', isActive);
      tab?.setAttribute?.('aria-selected', isActive ? 'true' : 'false');
      if (panel) {
        panel.hidden = !isActive;
      }
    });
  }

  function clearToolSelection() {
    activeTool = '';
    closeBufferSuggestions();
    syncToolSelection();
    currentResult = null;
    if (toolWorkspace) {
      toolWorkspace.hidden = true;
    }
  }

  function togglePanel(toolId) {
    activeTool = ['buffer', 'reaction'].includes(toolId) ? toolId : 'buffer';
    if (activeTool !== 'buffer') {
      closeBufferSuggestions();
    }
    showToolWorkspace();
    syncToolSelection();
    renderCurrentTool();
  }



  const {
    syncBufferCompound,
    calculateActiveTool,
    resultTextAfterName,
    renderCurrentTool
  } = createToolCalculations({
    doc,
    getElement,
    inputValue,
    isHidden,
    setText,
    setStatus: (message) => setStatus(message),
    REACTION_ROW_COUNT,
    outputEl,
    formulaEl,
    toolOutput,
    getActiveTool: () => activeTool,
    getCurrentResult: () => currentResult,
    setCurrentResult: (next) => { currentResult = next; },
    bufferRowCount,
    bufferCandidateForm,
    findBufferCandidate
  });

  const {
    applyCalculationEdit,
    insertCurrentIntoNotes
  } = createCalculationRecords({
    createId,
    notesInput,
    onAppendNote,
    getToolCalculations: () => toolCalculations,
    setToolCalculations: (next) => { toolCalculations = next; },
    getCurrentResult: () => currentResult,
    calculateActiveTool: () => calculateActiveTool(),
    resultTextAfterName: (text) => resultTextAfterName(text),
    renderSavedCalculations: () => renderSavedCalculations(),
    setStatus: (message) => setStatus(message)
  });

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

  function insertBufferRowBeforeAddRow(row) {
    const addRow = getElement(doc, 'biology-notebook-tool-buffer-add-row-anchor');
    if (
      addRow?.parentElement === bufferRows
      && typeof bufferRows?.insertBefore === 'function'
    ) {
      bufferRows.insertBefore(row, addRow);
      return true;
    }
    if (typeof bufferRows?.appendChild === 'function') {
      bufferRows.appendChild(row);
      return true;
    }
    return false;
  }

  function bindBufferRow(index) {
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
    [
      `biology-notebook-tool-buffer-mw-${index}`,
      `biology-notebook-tool-buffer-stock-${index}`,
      `biology-notebook-tool-buffer-final-${index}`
    ].forEach((id) => {
      const element = getElement(doc, id);
      addListener(element, 'input', renderCurrentTool);
      addListener(element, 'change', renderCurrentTool);
    });
  }

  function appendBufferRow() {
    if (!bufferRowTemplate?.cloneNode) {
      return;
    }
    const index = bufferRowCount() + 1;
    const row = bufferRowTemplate.cloneNode(true);
    row.hidden = false;
    row.id = `biology-notebook-tool-buffer-row-${index}`;
    row.querySelectorAll?.('[id]').forEach((element) => {
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
    const menu = row.querySelector?.('.biology-notebook-buffer-suggestions');
    if (menu) {
      menu.hidden = true;
      menu.innerHTML = '';
    }
    if (!insertBufferRowBeforeAddRow(row)) {
      return;
    }
    bufferRowTotal = index;
    bindBufferRow(index);
  }

  function revealOrAddBufferRow() {
    for (let index = 1; index <= bufferRowCount(); index += 1) {
      const row = getElement(doc, `biology-notebook-tool-buffer-row-${index}`);
      if (row?.hidden) {
        row.hidden = false;
        renderCurrentTool();
        return;
      }
    }
    appendBufferRow();
    renderCurrentTool();
  }

  ['buffer', 'reaction'].forEach((id) => {
    addListener(getElement(doc, `biology-notebook-tool-tab-${id}`), 'click', () => togglePanel(id));
  });
  addListener(getElement(doc, 'biology-notebook-tool-buffer-add-row'), 'click', () => {
    revealOrAddBufferRow();
  });
  addListener(getElement(doc, 'biology-notebook-tool-reaction-add-row'), 'click', () => {
    revealNextRow('biology-notebook-tool-reaction-row', REACTION_ROW_COUNT);
  });
  for (let index = 1; index <= bufferRowCount(); index += 1) {
    bindBufferRow(index);
  }
  addListener(insertNotesBtn, 'click', insertCurrentIntoNotes);
  addListener(collapseBtn, 'click', () => {
    setSidebarOpen(false);
    foldToggle?.focus?.();
  });
  addListener(foldToggle, 'pointerdown', beginToolboxDrag);
  addListener(win, 'pointermove', moveToolbox);
  addListener(win, 'pointerup', endToolboxDrag);
  addListener(win, 'pointercancel', endToolboxDrag);
  addListener(foldToggle, 'click', (event) => {
    if (suppressFoldToggleClick) {
      suppressFoldToggleClick = false;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }
    setSidebarOpen(true);
    const focusTarget = activeTool
      ? getElement(doc, `biology-notebook-tool-tab-${activeTool}`)
      : sidebar.querySelector?.('[data-notebook-tool-tab]');
    focusTarget?.focus?.();
  });
  const interactiveIds = [
    'biology-notebook-tool-buffer-volume',
    'biology-notebook-tool-buffer-volume-unit',
    'biology-notebook-tool-buffer-ph',
    'biology-notebook-tool-reaction-total-volume',
    'biology-notebook-tool-reaction-fill-name'
  ];
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

  // Cells are inputs, so a committed change is what triggers the recompute; the
  // focused cell is restored because the whole table is re-rendered.
  addListener(calculationsHost, 'change', (event) => {
    const field = event?.target?.dataset?.toolCalculationField;
    if (!field) {
      return;
    }
    const changed = applyCalculationEdit({
      calculationId: event.target.dataset.toolCalculationId,
      rowIndex: Math.max(0, Number(event.target.dataset.toolCalculationRow) || 0),
      field,
      value: event.target.value
    });
    if (!changed) {
      return;
    }
    const focusKey = `${event.target.dataset.toolCalculationRow}:${field}`;
    renderSavedCalculations();
    const next = typeof calculationsHost?.querySelector === 'function'
      ? calculationsHost.querySelector(`[data-tool-calculation-row="${focusKey.split(':')[0]}"][data-tool-calculation-field="${field}"]`)
      : null;
    next?.focus?.();
    setStatus('Reaction updated. Save the notebook page to keep it.');
  });

  addListener(doc, 'click', (event) => {
    if (!event?.target?.closest?.('.biology-notebook-buffer-autocomplete, .biology-notebook-buffer-suggestions')) {
      closeBufferSuggestions();
    }
  });
  addListener(doc, 'scroll', repositionOpenBufferSuggestions, true);
  addListener(win, 'resize', () => {
    repositionOpenBufferSuggestions();
    constrainToolboxPosition();
  });
  addListener(doc, 'keydown', (event) => {
    if (event?.key === 'Escape' && layout?.classList?.contains?.('is-tool-sidebar-open')) {
      setSidebarOpen(false);
      foldToggle?.focus?.();
    }
  });

  mountToolWorkspace();
  setSidebarOpen(layout?.classList?.contains?.('is-tool-sidebar-open'));
  renderCurrentTool();
  renderSavedCalculations();

  return {
    getCalculations: () => normalizeNotebookToolCalculations(toolCalculations),
    setCalculations: (calculations) => {
      toolCalculations = normalizeNotebookToolCalculations(calculations);
      renderSavedCalculations();
    },
    renderCalculations: renderSavedCalculations,
    getCurrentResult: () => currentResult,
    clearSelection: clearToolSelection
  };
}
