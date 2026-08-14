import { showTransientNotice } from '../lib/notify.js';

const DEFAULT_MAX_DEPTH = 80;
const DEFAULT_MAX_BYTES = 24 * 1024 * 1024;
const DEFAULT_COALESCE_MS = 700;
const COALESCED_INPUT_TYPES = new Set([
  'color',
  'date',
  'datetime-local',
  'email',
  'month',
  'number',
  'password',
  'range',
  'search',
  'tel',
  'text',
  'time',
  'url',
  'week'
]);

function serializeHistoryState(state) {
  if (!state || typeof state !== 'object') {
    return null;
  }
  try {
    return JSON.stringify(state);
  } catch (error) {
    console.warn('Unable to serialize undo history snapshot:', error);
    showTransientNotice('Undo history could not be saved.', { type: 'error' });
    return null;
  }
}

function parseHistorySnapshot(serialized) {
  try {
    const parsed = JSON.parse(serialized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    console.warn('Unable to restore undo history snapshot:', error);
    showTransientNotice('Undo history could not be restored.', { type: 'error' });
    return null;
  }
}

function replaceStateContents(target, nextState) {
  if (!target || typeof target !== 'object' || !nextState || typeof nextState !== 'object') {
    return;
  }
  Object.keys(target).forEach((key) => {
    delete target[key];
  });
  Object.assign(target, nextState);
}

function estimateBytes(value) {
  return String(value || '').length * 2;
}

function isEditableTarget(target) {
  if (typeof Element === 'undefined' || !(target instanceof Element)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const editable = target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
  return Boolean(editable);
}

// Returns the element whose edits may coalesce into one undo entry, or null.
// The identity matters, not just the type: two fields edited inside the same
// window are separate user intents and must not merge into one undo step.
function getCoalesceTarget(documentObject) {
  const active = documentObject?.activeElement;
  if (typeof Element === 'undefined' || !(active instanceof Element)) {
    return null;
  }
  if (
    (typeof HTMLTextAreaElement !== 'undefined' && active instanceof HTMLTextAreaElement)
    || (typeof HTMLSelectElement !== 'undefined' && active instanceof HTMLSelectElement)
    || active.isContentEditable
  ) {
    return active;
  }
  if (typeof HTMLInputElement !== 'undefined' && active instanceof HTMLInputElement) {
    return COALESCED_INPUT_TYPES.has(String(active.type || 'text').toLowerCase()) ? active : null;
  }
  return null;
}

function getKeyboardCommand(event) {
  if (!event || event.defaultPrevented || isEditableTarget(event.target)) {
    return '';
  }
  const key = String(event.key || '').toLowerCase();
  if (key !== 'z' && key !== 'y') {
    return '';
  }
  const hasPrimaryModifier = event.metaKey || event.ctrlKey;
  if (!hasPrimaryModifier || event.altKey) {
    return '';
  }
  if (key === 'y') {
    return 'redo';
  }
  return event.shiftKey ? 'redo' : 'undo';
}

export function createUndoService({
  state,
  persistState,
  renderAll,
  documentObject = globalThis?.document || null,
  undoButtonId = 'global-undo-btn',
  redoButtonId = 'global-redo-btn',
  maxDepth = DEFAULT_MAX_DEPTH,
  maxBytes = DEFAULT_MAX_BYTES,
  coalesceMs = DEFAULT_COALESCE_MS
} = {}) {
  const undoStack = [];
  const redoStack = [];
  const persistStateNow = typeof persistState === 'function' ? persistState : () => {};
  const renderCurrentState = typeof renderAll === 'function' ? renderAll : () => {};
  const undoButton = documentObject?.getElementById?.(undoButtonId) || null;
  const redoButton = documentObject?.getElementById?.(redoButtonId) || null;
  let lastSnapshot = serializeHistoryState(state);
  let lastHistoryPushAt = 0;
  let lastCoalesceTarget = null;
  let applyingSnapshot = false;

  function historyBytes() {
    return [...undoStack, ...redoStack].reduce((sum, item) => sum + estimateBytes(item), 0);
  }

  function trimStackDepth(stack) {
    while (stack.length > maxDepth) {
      stack.shift();
    }
  }

  function trimHistoryBudget() {
    trimStackDepth(undoStack);
    trimStackDepth(redoStack);
    while (historyBytes() > maxBytes && undoStack.length > 1) {
      undoStack.shift();
    }
    while (historyBytes() > maxBytes && redoStack.length > 1) {
      redoStack.shift();
    }
  }

  function getHistoryState() {
    return {
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undoDepth: undoStack.length,
      redoDepth: redoStack.length
    };
  }

  function syncButtons() {
    const historyState = getHistoryState();
    if (undoButton) {
      undoButton.disabled = !historyState.canUndo;
      undoButton.setAttribute('aria-disabled', String(!historyState.canUndo));
      undoButton.title = historyState.canUndo ? 'Undo (Command+Z)' : 'Nothing to undo';
    }
    if (redoButton) {
      redoButton.disabled = !historyState.canRedo;
      redoButton.setAttribute('aria-disabled', String(!historyState.canRedo));
      redoButton.title = historyState.canRedo ? 'Redo (Command+Shift+Z)' : 'Nothing to redo';
    }
  }

  function pushUndoSnapshot(serialized) {
    if (!serialized) {
      return;
    }
    const now = Date.now();
    const coalesceTarget = getCoalesceTarget(documentObject);
    const withinCoalesceWindow = Boolean(coalesceTarget)
      && coalesceTarget === lastCoalesceTarget
      && undoStack.length > 0
      && now - lastHistoryPushAt <= coalesceMs;
    lastCoalesceTarget = coalesceTarget;
    if (withinCoalesceWindow || undoStack[undoStack.length - 1] === serialized) {
      return;
    }
    undoStack.push(serialized);
    // Only a real push advances the window. Advancing it on a dropped push makes
    // the window slide with every keystroke, so sustained typing never
    // checkpoints and one undo reverts the whole burst.
    lastHistoryPushAt = now;
    trimHistoryBudget();
  }

  // options.external — the change came from the main process (an agent write, an
  //   IPC push), not the user. Save it, but leave both stacks alone: it is not
  //   the user's to undo, and clearing redo would destroy history they own.
  // options.barrier — the change accompanies a side effect outside `state` that
  //   undo cannot reverse (a moved or written file). Undoing across it would
  //   desynchronize state from disk, so history is dropped instead.
  function persist(options = {}) {
    const before = lastSnapshot || serializeHistoryState(state);
    const result = persistStateNow();
    const after = serializeHistoryState(state);
    if (!after) {
      syncButtons();
      return result;
    }
    if (applyingSnapshot || options.external === true) {
      lastSnapshot = after;
      syncButtons();
      return result;
    }
    if (options.barrier === true) {
      reset();
      return result;
    }
    if (before && after !== before) {
      pushUndoSnapshot(before);
      redoStack.length = 0;
      lastSnapshot = after;
      syncButtons();
      return result;
    }
    lastSnapshot = after;
    syncButtons();
    return result;
  }

  function applySnapshot(serialized) {
    const snapshot = parseHistorySnapshot(serialized);
    if (!snapshot) {
      syncButtons();
      return false;
    }
    applyingSnapshot = true;
    try {
      replaceStateContents(state, snapshot);
      persistStateNow();
      lastSnapshot = serializeHistoryState(state) || serialized;
      lastHistoryPushAt = 0;
      lastCoalesceTarget = null;
      renderCurrentState();
    } finally {
      applyingSnapshot = false;
    }
    syncButtons();
    return true;
  }

  function undo() {
    const targetSnapshot = undoStack.pop();
    if (!targetSnapshot) {
      syncButtons();
      return false;
    }
    const currentSnapshot = serializeHistoryState(state) || lastSnapshot;
    if (currentSnapshot && currentSnapshot !== targetSnapshot) {
      redoStack.push(currentSnapshot);
    }
    trimHistoryBudget();
    return applySnapshot(targetSnapshot);
  }

  function redo() {
    const targetSnapshot = redoStack.pop();
    if (!targetSnapshot) {
      syncButtons();
      return false;
    }
    const currentSnapshot = serializeHistoryState(state) || lastSnapshot;
    if (currentSnapshot && currentSnapshot !== targetSnapshot) {
      undoStack.push(currentSnapshot);
    }
    trimHistoryBudget();
    return applySnapshot(targetSnapshot);
  }

  function reset() {
    undoStack.length = 0;
    redoStack.length = 0;
    lastSnapshot = serializeHistoryState(state);
    lastHistoryPushAt = 0;
    lastCoalesceTarget = null;
    syncButtons();
  }

  undoButton?.addEventListener('click', () => {
    undo();
  });
  redoButton?.addEventListener('click', () => {
    redo();
  });
  documentObject?.addEventListener?.('keydown', (event) => {
    const command = getKeyboardCommand(event);
    if (!command) {
      return;
    }
    event.preventDefault();
    if (command === 'redo') {
      redo();
    } else {
      undo();
    }
  });

  syncButtons();

  return {
    persist,
    redo,
    reset,
    undo
  };
}
