import {
  calculateBufferRecipe,
  calculateFixedReaction,
  resolveBufferCompound
} from '../../../lib/bench-calculations.js';
import { BUFFER_COMPOUNDS } from '../../../lib/chemistry/buffer-compounds.js';
import {
  buildFixedReactionCalculationTable,
  buildNotebookToolCalculationsHtml,
  normalizeNotebookToolCalculations
} from '../../../lib/notebook-tool-calculations.js';

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

  function extractCompoundPka(record) {
    const source = record && typeof record === 'object' ? record : {};
    const keys = ['pKa', 'pka', 'pkaValue', 'pka_value'];
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
          category: candidate.category || existing.category,
          pKa: candidate.pKa || existing.pKa
        });
        return;
      }
      candidates.set(key, {
        ...existing,
        mw: existing.mw || candidate.mw,
        form: existing.form || candidate.form,
        category: existing.category || candidate.category,
        pKa: existing.pKa || candidate.pKa
      });
    }

    (Array.isArray(getStoredCompounds?.()) ? getStoredCompounds() : []).forEach((record) => {
      mergeCandidate({
        source: 'Stored',
        name: record?.name,
        mw: extractCompoundMw(record),
        pKa: extractCompoundPka(record),
        form: inferCompoundForm(record),
        category: record?.casNumber ? `CAS ${record.casNumber}` : 'Stored compound'
      });
    });
    BUFFER_COMPOUNDS.forEach((compound) => {
      mergeCandidate({
        source: 'Tools',
        name: compound.name,
        mw: compound.mw,
        pKa: compound.pKa,
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

  function bufferRowCount() {
    return bufferRowTotal;
  }

  function closeBufferSuggestions(index = null) {
    for (let rowIndex = 1; rowIndex <= bufferRowCount(); rowIndex += 1) {
      if (index && rowIndex !== index) {
        continue;
      }
      const menu = getElement(doc, `biology-notebook-tool-buffer-suggestions-${rowIndex}`);
      if (menu) {
        menu.hidden = true;
        menu.innerHTML = '';
      }
      getElement(doc, `biology-notebook-tool-buffer-name-${rowIndex}`)?.setAttribute?.('aria-expanded', 'false');
    }
  }

  function closeOtherBufferSuggestions(activeIndex) {
    for (let rowIndex = 1; rowIndex <= bufferRowCount(); rowIndex += 1) {
      if (rowIndex !== activeIndex) {
        closeBufferSuggestions(rowIndex);
      }
    }
  }

  function positionBufferSuggestions(index) {
    const input = getElement(doc, `biology-notebook-tool-buffer-name-${index}`);
    const menu = getElement(doc, `biology-notebook-tool-buffer-suggestions-${index}`);
    const inputRect = input?.getBoundingClientRect?.();
    const viewportWidth = Number(doc?.documentElement?.clientWidth)
      || Number(win?.innerWidth)
      || 0;
    const viewportHeight = Number(doc?.documentElement?.clientHeight)
      || Number(win?.innerHeight)
      || 0;
    if (!inputRect || !viewportWidth || !viewportHeight || !menu?.style) {
      return false;
    }

    const overlayRoot = doc?.body;
    if (overlayRoot && typeof overlayRoot.appendChild === 'function' && menu.parentElement !== overlayRoot) {
      overlayRoot.appendChild(menu);
    }
    menu.classList?.add?.('biology-notebook-buffer-suggestions--floating');

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
    for (let index = 1; index <= bufferRowCount(); index += 1) {
      const menu = getElement(doc, `biology-notebook-tool-buffer-suggestions-${index}`);
      if (menu && !menu.hidden) {
        positionBufferSuggestions(index);
      }
    }
  }

  function renderBufferSuggestions(index) {
    const input = getElement(doc, `biology-notebook-tool-buffer-name-${index}`);
    const menu = getElement(doc, `biology-notebook-tool-buffer-suggestions-${index}`);
    if (!input || !menu) {
      return;
    }
    closeOtherBufferSuggestions(index);
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
        candidate.pKa ? `pKa ${candidate.pKa}` : '',
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
    input.setAttribute?.('aria-expanded', 'true');
    positionBufferSuggestions(index);
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

  function toolboxRect(element) {
    return typeof element?.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : null;
  }

  function clampToolboxPosition(left, top, layoutRect, sidebarRect) {
    const layoutWidth = Number(layoutRect?.width) || Math.max(0, Number(layoutRect?.right) - Number(layoutRect?.left));
    const layoutHeight = Number(layoutRect?.height) || Math.max(0, Number(layoutRect?.bottom) - Number(layoutRect?.top));
    const sidebarWidth = Number(sidebarRect?.width) || Math.max(0, Number(sidebarRect?.right) - Number(sidebarRect?.left));
    const sidebarHeight = Number(sidebarRect?.height) || Math.max(0, Number(sidebarRect?.bottom) - Number(sidebarRect?.top));
    return {
      left: Math.min(Math.max(0, left), Math.max(0, layoutWidth - sidebarWidth)),
      top: Math.min(Math.max(0, top), Math.max(0, layoutHeight - sidebarHeight))
    };
  }

  function applyToolboxPosition(left, top, layoutRect, sidebarRect, { markMoved = true } = {}) {
    if (!sidebar?.style) {
      return;
    }
    const position = clampToolboxPosition(left, top, layoutRect, sidebarRect);
    sidebar.style.left = `${Math.round(position.left)}px`;
    sidebar.style.top = `${Math.round(position.top)}px`;
    sidebar.style.right = 'auto';
    sidebar.style.bottom = 'auto';
    if (markMoved && sidebar.dataset) {
      sidebar.dataset.notebookToolboxMoved = 'true';
    }
    return position;
  }

  function foldedToolboxRect() {
    return {
      width: TOOLBOX_FOLDED_SIZE_PX,
      height: TOOLBOX_FOLDED_SIZE_PX,
      left: 0,
      top: 0,
      right: TOOLBOX_FOLDED_SIZE_PX,
      bottom: TOOLBOX_FOLDED_SIZE_PX
    };
  }

  function storeToolboxAnchor(position, layoutRect) {
    const layoutWidth = Number(layoutRect?.width) || Math.max(0, Number(layoutRect?.right) - Number(layoutRect?.left));
    const layoutHeight = Number(layoutRect?.height) || Math.max(0, Number(layoutRect?.bottom) - Number(layoutRect?.top));
    const clamped = clampToolboxPosition(position.left, position.top, layoutRect, foldedToolboxRect());
    const horizontalEdge = clamped.left + (TOOLBOX_FOLDED_SIZE_PX / 2) > layoutWidth / 2 ? 'right' : 'left';
    const verticalEdge = clamped.top + (TOOLBOX_FOLDED_SIZE_PX / 2) > layoutHeight / 2 ? 'bottom' : 'top';
    return {
      horizontalEdge,
      horizontalOffset: horizontalEdge === 'right'
        ? Math.max(0, layoutWidth - clamped.left - TOOLBOX_FOLDED_SIZE_PX)
        : clamped.left,
      verticalEdge,
      verticalOffset: verticalEdge === 'bottom'
        ? Math.max(0, layoutHeight - clamped.top - TOOLBOX_FOLDED_SIZE_PX)
        : clamped.top
    };
  }

  function resolveToolboxAnchor(anchor, layoutRect) {
    const layoutWidth = Number(layoutRect?.width) || Math.max(0, Number(layoutRect?.right) - Number(layoutRect?.left));
    const layoutHeight = Number(layoutRect?.height) || Math.max(0, Number(layoutRect?.bottom) - Number(layoutRect?.top));
    const left = anchor?.horizontalEdge === 'right'
      ? layoutWidth - TOOLBOX_FOLDED_SIZE_PX - Number(anchor?.horizontalOffset || 0)
      : Number(anchor?.horizontalOffset || 0);
    const top = anchor?.verticalEdge === 'bottom'
      ? layoutHeight - TOOLBOX_FOLDED_SIZE_PX - Number(anchor?.verticalOffset || 0)
      : Number(anchor?.verticalOffset || 0);
    return clampToolboxPosition(left, top, layoutRect, foldedToolboxRect());
  }

  function currentToolboxAnchor(layoutRect, sidebarRect) {
    const currentLeft = Number.parseFloat(sidebar?.style?.left);
    const currentTop = Number.parseFloat(sidebar?.style?.top);
    const left = Number.isFinite(currentLeft)
      ? currentLeft
      : Number(sidebarRect?.left) - Number(layoutRect?.left);
    const top = Number.isFinite(currentTop)
      ? currentTop
      : Number(sidebarRect?.top) - Number(layoutRect?.top);
    return storeToolboxAnchor({ left, top }, layoutRect);
  }

  function positionExpandedToolbox(anchor, layoutRect, sidebarRect) {
    const layoutWidth = Number(layoutRect?.width) || Math.max(0, Number(layoutRect?.right) - Number(layoutRect?.left));
    const layoutHeight = Number(layoutRect?.height) || Math.max(0, Number(layoutRect?.bottom) - Number(layoutRect?.top));
    const sidebarWidth = Number(sidebarRect?.width) || 132;
    const sidebarHeight = Number(sidebarRect?.height) || 132;
    const spaceRight = layoutWidth - anchor.left;
    const spaceLeft = anchor.left + TOOLBOX_FOLDED_SIZE_PX;
    const spaceDown = layoutHeight - anchor.top;
    const spaceUp = anchor.top + TOOLBOX_FOLDED_SIZE_PX;
    const expandX = spaceRight >= sidebarWidth || spaceRight >= spaceLeft ? 'right' : 'left';
    const expandY = spaceDown >= sidebarHeight || spaceDown >= spaceUp ? 'down' : 'up';
    const left = expandX === 'right'
      ? anchor.left
      : anchor.left + TOOLBOX_FOLDED_SIZE_PX - sidebarWidth;
    const top = expandY === 'down'
      ? anchor.top
      : anchor.top + TOOLBOX_FOLDED_SIZE_PX - sidebarHeight;
    if (sidebar?.dataset) {
      sidebar.dataset.toolboxExpandX = expandX;
      sidebar.dataset.toolboxExpandY = expandY;
    }
    applyToolboxPosition(left, top, layoutRect, sidebarRect, { markMoved: false });
  }

  function positionFoldedToolbox(anchor, layoutRect) {
    const position = resolveToolboxAnchor(anchor, layoutRect);
    applyToolboxPosition(
      position.left,
      position.top,
      layoutRect,
      foldedToolboxRect(),
      { markMoved: false }
    );
  }

  function constrainToolboxPosition() {
    if (!toolboxAnchor && sidebar?.dataset?.notebookToolboxMoved !== 'true') {
      return;
    }
    const layoutRect = toolboxRect(layout);
    const sidebarRect = toolboxRect(sidebar);
    if (!layoutRect || !sidebarRect) {
      return;
    }
    if (!toolboxAnchor) {
      toolboxAnchor = storeToolboxAnchor({
        left: Number.parseFloat(sidebar?.style?.left),
        top: Number.parseFloat(sidebar?.style?.top)
      }, layoutRect);
    }
    const anchorPosition = resolveToolboxAnchor(toolboxAnchor, layoutRect);
    if (layout?.classList?.contains?.('is-tool-sidebar-open')) {
      positionExpandedToolbox(anchorPosition, layoutRect, sidebarRect);
    } else {
      positionFoldedToolbox(toolboxAnchor, layoutRect);
    }
  }

  function beginToolboxDrag(event) {
    if (Number(event?.button) !== 0 || !Number.isFinite(Number(event?.clientX)) || !Number.isFinite(Number(event?.clientY))) {
      return;
    }
    const layoutRect = toolboxRect(layout);
    const sidebarRect = toolboxRect(sidebar);
    if (!layoutRect || !sidebarRect) {
      return;
    }
    suppressFoldToggleClick = false;
    toolboxDragState = {
      pointerId: event?.pointerId,
      startX: Number(event.clientX),
      startY: Number(event.clientY),
      startLeft: Number(sidebarRect.left) - Number(layoutRect.left),
      startTop: Number(sidebarRect.top) - Number(layoutRect.top),
      layoutRect,
      sidebarRect,
      moved: false
    };
    foldToggle?.setPointerCapture?.(event?.pointerId);
  }

  function moveToolbox(event) {
    if (!toolboxDragState || (toolboxDragState.pointerId != null && event?.pointerId !== toolboxDragState.pointerId)) {
      return;
    }
    const deltaX = Number(event?.clientX) - toolboxDragState.startX;
    const deltaY = Number(event?.clientY) - toolboxDragState.startY;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }
    if (!toolboxDragState.moved && Math.hypot(deltaX, deltaY) < TOOLBOX_DRAG_THRESHOLD_PX) {
      return;
    }
    toolboxDragState.moved = true;
    suppressFoldToggleClick = true;
    sidebar?.classList?.add('is-dragging');
    event?.preventDefault?.();
    const position = applyToolboxPosition(
      toolboxDragState.startLeft + deltaX,
      toolboxDragState.startTop + deltaY,
      toolboxDragState.layoutRect,
      toolboxDragState.sidebarRect
    );
    toolboxAnchor = storeToolboxAnchor(position, toolboxDragState.layoutRect);
  }

  function endToolboxDrag(event) {
    if (!toolboxDragState || (toolboxDragState.pointerId != null && event?.pointerId !== toolboxDragState.pointerId)) {
      return;
    }
    foldToggle?.releasePointerCapture?.(toolboxDragState.pointerId);
    sidebar?.classList?.remove('is-dragging');
    toolboxDragState = null;
  }

  function setSidebarOpen(isOpen) {
    const layoutRect = toolboxRect(layout);
    const sidebarRect = toolboxRect(sidebar);
    if (isOpen && layoutRect && sidebarRect) {
      toolboxAnchor = currentToolboxAnchor(layoutRect, sidebarRect);
    }
    layout?.classList?.toggle('is-tool-sidebar-open', Boolean(isOpen));
    layout?.classList?.toggle('is-tool-sidebar-collapsed', !isOpen);
    collapseBtn?.setAttribute?.('aria-expanded', isOpen ? 'true' : 'false');
    foldToggle?.setAttribute?.('aria-expanded', isOpen ? 'true' : 'false');
    sidebar?.setAttribute?.('aria-expanded', isOpen ? 'true' : 'false');
    if (layoutRect && toolboxAnchor) {
      const nextSidebarRect = toolboxRect(sidebar) || sidebarRect;
      const anchorPosition = resolveToolboxAnchor(toolboxAnchor, layoutRect);
      if (isOpen) {
        positionExpandedToolbox(anchorPosition, layoutRect, nextSidebarRect);
      } else {
        positionFoldedToolbox(toolboxAnchor, layoutRect);
      }
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
    return activeTool === 'reaction' ? calculateCurrentReaction() : calculateCurrentBuffer();
  }

  function resultTextAfterName(text) {
    const source = String(text || '').trim();
    const match = source.match(/^[^:]+:\s*(.+?)\.?$/s);
    return match ? match[1].trim() : source;
  }

  function renderBufferTableResult(result) {
    for (let index = 1; index <= bufferRowCount(); index += 1) {
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
    currentResult = calculateActiveTool();
    if (activeTool === 'reaction') {
      renderReactionTableResult(currentResult);
    } else {
      renderBufferTableResult(currentResult);
    }
    const hideSummaryOutput = activeTool !== 'reaction';
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
    const table = buildFixedReactionCalculationTable(result);
    return table && (table.rows.length || table.footerRows.some((row) => row.some(Boolean))) ? table : null;
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

  // Editing a cell rewrites that one input and runs the same engine again, so a
  // changed stock concentration flows through to every derived volume and to
  // the water that fills the tube.
  function applyCalculationEdit({ calculationId, rowIndex, field, value }) {
    const index = toolCalculations.findIndex((entry) => String(entry?.id || '') === String(calculationId || ''));
    const calculation = index >= 0 ? toolCalculations[index] : null;
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
    toolCalculations[index] = {
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
    toolCalculations = normalizeNotebookToolCalculations(toolCalculations);
    return true;
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
