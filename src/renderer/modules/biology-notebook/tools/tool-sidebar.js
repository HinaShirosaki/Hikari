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
  calculationsHost,
  getStoredCompounds = () => []
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
  const bufferRows = getElement(doc, 'biology-notebook-tool-buffer-rows');
  const bufferRowTemplate = getElement(doc, 'biology-notebook-tool-buffer-row-1')?.cloneNode?.(true) || null;
  const reactionRowTemplate = getElement(doc, 'biology-notebook-tool-reaction-row-1')?.cloneNode?.(true) || null;

  let activeTool = '';
  let currentResult = null;
  let toolCalculations = [];
  let boundPageId = '';
  // Which recorded table each tool is writing to on the open page.
  const boundCalculationIds = new Map();
  let bufferRowTotal = INITIAL_BUFFER_ROW_COUNT;
  let reactionRowTotal = REACTION_ROW_COUNT;
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

  function mountToolWorkspace() {
    if (!toolWorkspace || !toolBody || toolBody.parentElement === toolWorkspace) {
      return;
    }
    [toolBody].filter(Boolean).forEach((element) => {
      toolWorkspace.appendChild(element);
    });
  }

  function showToolWorkspace() {
    mountToolWorkspace();
    if (toolWorkspace) {
      toolWorkspace.hidden = false;
    }
  }

  // The open sheet and its table on the page are the same numbers twice. While a
  // tool is open its own table steps aside; closing the tool brings it back.
  function renderSavedCalculations() {
    if (calculationsHost) {
      const openId = String((activeTool && boundCalculationIds.get(activeTool)) || '');
      calculationsHost.innerHTML = buildNotebookToolCalculationsHtml({
        calculations: openId
          ? toolCalculations.filter((calculation) => String(calculation?.id || '') !== openId)
          : toolCalculations,
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
    renderSavedCalculations();
  }

  function togglePanel(toolId) {
    const nextTool = ['buffer', 'reaction'].includes(toolId) ? toolId : 'buffer';
    // Clicking the open tool closes its sheet, which is how its table comes
    // back onto the page.
    if (nextTool === activeTool) {
      clearToolSelection();
      return;
    }
    // A tool tab always starts a new table -- a page can hold as many as the
    // bench needs. An existing one is reopened from its own edit button.
    boundCalculationIds.delete(nextTool);
    resetToolSheet(nextTool);
    activeTool = nextTool;
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
    renderCurrentTool: computeCurrentTool
  } = createToolCalculations({
    doc,
    getElement,
    inputValue,
    isHidden,
    setText,
    reactionRowCount,
    getActiveTool: () => activeTool,
    getCurrentResult: () => currentResult,
    setCurrentResult: (next) => { currentResult = next; },
    bufferRowCount,
    bufferCandidateForm,
    findBufferCandidate
  });

  const {
    applyCalculationEdit,
    upsertToolCalculation,
    removeToolCalculation
  } = createCalculationRecords({
    createId,
    getToolCalculations: () => toolCalculations,
    setToolCalculations: (next) => { toolCalculations = next; },
    getCurrentResult: () => currentResult,
    calculateActiveTool: () => calculateActiveTool(),
    resultTextAfterName: (text) => resultTextAfterName(text),
    renderSavedCalculations: () => renderSavedCalculations()
  });

  function reactionRowCount() {
    return reactionRowTotal;
  }

  // Opening a tool puts its table on the page and every edit rewrites it, so
  // the sheet and the page never disagree and nothing has to be pressed.
  function renderCurrentTool() {
    computeCurrentTool();
    if (!activeTool) {
      return;
    }
    boundCalculationIds.set(activeTool, upsertToolCalculation(boundCalculationIds.get(activeTool)));
    renderSavedCalculations();
  }

  // The toolbox is a scratchpad for the page in the viewer, but its sheet lives
  // in one shared bit of DOM. Without this, the previous page's reagents sit in
  // the form and its result stays one "Insert" away from the wrong page.
  function eachToolFieldId(visit, tool = '') {
    if (tool !== 'reaction') {
      [
        'biology-notebook-tool-buffer-volume',
        'biology-notebook-tool-buffer-volume-unit',
        'biology-notebook-tool-buffer-ph'
      ].forEach(visit);
      for (let index = 1; index <= bufferRowCount(); index += 1) {
        ['name', 'mw', 'stock', 'final', 'amount', 'note'].forEach((field) => visit(`biology-notebook-tool-buffer-${field}-${index}`));
      }
    }
    if (tool !== 'buffer') {
      [
        'biology-notebook-tool-reaction-total-volume',
        'biology-notebook-tool-reaction-fill-name'
      ].forEach(visit);
      for (let index = 1; index <= reactionRowCount(); index += 1) {
        ['name', 'stock', 'final', 'volume', 'note'].forEach((field) => visit(`biology-notebook-tool-reaction-${field}-${index}`));
      }
    }
  }

  function eachToolRowId(visit, tool = '') {
    if (tool !== 'reaction') {
      for (let index = 1; index <= bufferRowCount(); index += 1) {
        visit(`biology-notebook-tool-buffer-row-${index}`);
      }
    }
    if (tool !== 'buffer') {
      for (let index = 1; index <= reactionRowCount(); index += 1) {
        visit(`biology-notebook-tool-reaction-row-${index}`);
      }
    }
  }

  // Captured before anyone types: the markup ships a default total volume and
  // solvent name, so "empty" is what the sheet started as, not blank.
  const toolFieldDefaults = new Map();
  const toolRowDefaults = new Map();
  eachToolFieldId((id) => toolFieldDefaults.set(id, inputValue(getElement(doc, id))));
  eachToolRowId((id) => toolRowDefaults.set(id, isHidden(getElement(doc, id))));

  function resetToolSheet(tool = '') {
    eachToolFieldId((id) => {
      const element = getElement(doc, id);
      if (element) {
        // Rows added since load are not in the snapshot; they start empty.
        element.value = toolFieldDefaults.get(id) ?? '';
      }
    }, tool);
    eachToolRowId((id) => {
      const row = getElement(doc, id);
      if (row) {
        row.hidden = toolRowDefaults.get(id) ?? true;
      }
    }, tool);
    if (tool !== 'reaction') {
      closeBufferSuggestions();
    }
  }

  function resetToolInputs() {
    resetToolSheet();
    boundCalculationIds.clear();
    computeCurrentTool();
    clearToolSelection();
  }

  // Reopening a table puts its own numbers back in the sheet, so a table made
  // earlier can still gain a row or have its reagents corrected.
  function setFieldValue(id, value) {
    const element = getElement(doc, id);
    if (element) {
      element.value = String(value ?? '');
    }
  }

  function ensureSheetRows(tool, needed) {
    const isReaction = tool === 'reaction';
    for (let index = 1; index <= needed; index += 1) {
      if (index > (isReaction ? reactionRowCount() : bufferRowCount())) {
        if (isReaction) {
          appendReactionRow();
        } else {
          appendBufferRow();
        }
      }
      const row = getElement(doc, `biology-notebook-tool-${isReaction ? 'reaction' : 'buffer'}-row-${index}`);
      if (row) {
        row.hidden = false;
      }
    }
  }

  function loadCalculationIntoSheet(tool, inputs = {}) {
    if (tool === 'reaction') {
      const reagents = Array.isArray(inputs?.reagents) ? inputs.reagents : [];
      setFieldValue('biology-notebook-tool-reaction-total-volume', inputs?.totalVolumeValue);
      setFieldValue('biology-notebook-tool-reaction-fill-name', inputs?.fillName);
      ensureSheetRows('reaction', reagents.length);
      reagents.forEach((reagent, index) => {
        const row = index + 1;
        setFieldValue(`biology-notebook-tool-reaction-name-${row}`, reagent?.name);
        setFieldValue(`biology-notebook-tool-reaction-stock-${row}`, reagent?.stockConcentration);
        setFieldValue(`biology-notebook-tool-reaction-final-${row}`, reagent?.finalConcentration);
        setFieldValue(`biology-notebook-tool-reaction-volume-${row}`, reagent?.manualVolumeValue);
        setFieldValue(`biology-notebook-tool-reaction-note-${row}`, reagent?.note);
      });
      return;
    }
    const rows = Array.isArray(inputs?.rows) ? inputs.rows : [];
    setFieldValue('biology-notebook-tool-buffer-volume', inputs?.volumeValue);
    setFieldValue('biology-notebook-tool-buffer-volume-unit', inputs?.volumeUnit);
    setFieldValue('biology-notebook-tool-buffer-ph', inputs?.pH);
    ensureSheetRows('buffer', rows.length);
    rows.forEach((row, index) => {
      const line = index + 1;
      setFieldValue(`biology-notebook-tool-buffer-name-${line}`, row?.name);
      setFieldValue(`biology-notebook-tool-buffer-mw-${line}`, row?.molecularWeight);
      setFieldValue(`biology-notebook-tool-buffer-stock-${line}`, row?.stockConcentration);
      setFieldValue(`biology-notebook-tool-buffer-final-${line}`, row?.finalConcentration);
      setFieldValue(`biology-notebook-tool-buffer-amount-${line}`, row?.manualQuantity);
      setFieldValue(`biology-notebook-tool-buffer-note-${line}`, row?.note);
    });
  }

  function openCalculationInTool(calculationId) {
    const calculation = toolCalculations
      .find((item) => String(item?.id || '') === String(calculationId || ''));
    if (!calculation) {
      return;
    }
    const tool = calculation.type === 'fixed-reaction' ? 'reaction' : 'buffer';
    activeTool = tool;
    boundCalculationIds.set(tool, calculation.id);
    resetToolSheet(tool);
    loadCalculationIntoSheet(tool, calculation.inputs);
    showToolWorkspace();
    syncToolSelection();
    renderCurrentTool();
  }

  function bindReactionRow(index) {
    [
      `biology-notebook-tool-reaction-name-${index}`,
      `biology-notebook-tool-reaction-stock-${index}`,
      `biology-notebook-tool-reaction-final-${index}`,
      `biology-notebook-tool-reaction-volume-${index}`,
      `biology-notebook-tool-reaction-note-${index}`
    ].forEach((id) => {
      const element = getElement(doc, id);
      addListener(element, 'input', renderCurrentTool);
      addListener(element, 'change', renderCurrentTool);
    });
  }

  function appendReactionRow() {
    const addRow = getElement(doc, 'biology-notebook-tool-reaction-add-row-anchor');
    const rowsHost = addRow?.parentElement;
    if (!reactionRowTemplate?.cloneNode || typeof rowsHost?.insertBefore !== 'function') {
      return;
    }
    const index = reactionRowTotal + 1;
    const row = reactionRowTemplate.cloneNode(true);
    row.hidden = false;
    row.id = `biology-notebook-tool-reaction-row-${index}`;
    row.querySelectorAll?.('[id]').forEach((element) => {
      element.id = `${element.id.replace(/-\d+$/, '')}-${index}`;
      element.value = '';
      element.textContent = '';
      const label = element.getAttribute?.('aria-label');
      if (label) {
        element.setAttribute('aria-label', label.replace(/\d+/, String(index)));
      }
    });
    rowsHost.insertBefore(row, addRow);
    reactionRowTotal = index;
    bindReactionRow(index);
  }

  function revealOrAddReactionRow() {
    for (let index = 1; index <= reactionRowCount(); index += 1) {
      const row = getElement(doc, `biology-notebook-tool-reaction-row-${index}`);
      if (row?.hidden) {
        row.hidden = false;
        renderCurrentTool();
        return;
      }
    }
    appendReactionRow();
    renderCurrentTool();
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
      `biology-notebook-tool-buffer-final-${index}`,
      `biology-notebook-tool-buffer-amount-${index}`,
      `biology-notebook-tool-buffer-note-${index}`
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
    revealOrAddReactionRow();
  });
  for (let index = 1; index <= bufferRowCount(); index += 1) {
    bindBufferRow(index);
  }
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
  interactiveIds.forEach((id) => {
    const element = getElement(doc, id);
    addListener(element, 'input', renderCurrentTool);
    addListener(element, 'change', renderCurrentTool);
  });
  for (let index = 1; index <= reactionRowCount(); index += 1) {
    bindReactionRow(index);
  }

  // Deleting the table the open tool is writing to also closes that tool: left
  // open, the next keystroke would put the table straight back.
  addListener(calculationsHost, 'click', (event) => {
    const editButton = event?.target?.closest?.('[data-tool-calculation-edit]')
      || (event?.target?.dataset?.toolCalculationEdit ? event.target : null);
    if (editButton?.dataset?.toolCalculationEdit) {
      openCalculationInTool(editButton.dataset.toolCalculationEdit);
      return;
    }
    const button = event?.target?.closest?.('[data-tool-calculation-remove]')
      || (event?.target?.dataset?.toolCalculationRemove ? event.target : null);
    const calculationId = String(button?.dataset?.toolCalculationRemove || '');
    if (!calculationId || !removeToolCalculation(calculationId)) {
      return;
    }
    boundCalculationIds.forEach((boundId, toolId) => {
      if (String(boundId) === calculationId) {
        boundCalculationIds.delete(toolId);
        if (toolId === activeTool) {
          clearToolSelection();
        }
      }
    });
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
    // pageId identifies the page now in the viewer; re-rendering the same page
    // (a save, a mark-executed) keeps whatever is half-typed in the sheet.
    setCalculations: (calculations, pageId = '') => {
      const next = normalizeNotebookToolCalculations(calculations);
      // Saving a draft hands the page a real id, but it is the same page with
      // the same tables: an open tool keeps writing to the table it opened
      // rather than starting a second copy of it.
      const keepsOpenTables = boundCalculationIds.size > 0
        && Array.from(boundCalculationIds.values())
          .every((id) => next.some((calculation) => String(calculation?.id || '') === String(id)));
      const samePage = String(pageId) === boundPageId || keepsOpenTables;
      boundPageId = String(pageId);
      toolCalculations = next;
      if (!samePage) {
        resetToolInputs();
      }
      renderSavedCalculations();
    },
    renderCalculations: renderSavedCalculations,
    getCurrentResult: () => currentResult,
    clearSelection: clearToolSelection
  };
}
