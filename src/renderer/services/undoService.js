import { showTransientNotice } from '../lib/notify.js';
import { applyHistoryChanges, canApplyHistoryChanges, captureHistoryState, diffHistoryState,
  historyChangesOverlap, mergeHistoryChanges, removesReferencedHistoryRecord } from './history-patches.js';

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

// The shared controls route to one module's stack (or a plugin delegate). Each
// module receives a bound persist callback, so async completions retain their
// owner even after navigation. Cross-module records changed by one persist are
// one transaction in the initiating module's history.
export function createUndoService({
  state,
  persistState,
  renderAll,
  onRestore = renderAll,
  beforeRestore = () => true,
  getActiveOwner = () => 'app',
  delegate = null,
  documentObject = globalThis?.document || null,
  windowObject = documentObject?.defaultView || globalThis?.window || null,
  undoButtonId = 'global-undo-btn',
  redoButtonId = 'global-redo-btn',
  maxDepth = DEFAULT_MAX_DEPTH,
  maxBytes = DEFAULT_MAX_BYTES,
  coalesceMs = DEFAULT_COALESCE_MS
} = {}) {
  const histories = new Map();
  const scopes = new Map();
  const persistStateNow = typeof persistState === 'function' ? persistState : () => {};
  const undoButton = documentObject?.getElementById?.(undoButtonId) || null;
  const redoButton = documentObject?.getElementById?.(redoButtonId) || null;
  let baseline = captureHistoryState(state);
  let applying = false;
  let sequence = 0;
  let lastOwner = '';

  function historyFor(owner) {
    if (!histories.has(owner)) histories.set(owner, { undo: [], redo: [], at: 0, target: null });
    return histories.get(owner);
  }

  function clear(history) {
    history.undo.length = 0;
    history.redo.length = 0;
    history.at = 0;
    history.target = null;
  }

  function invalidate(changes, exceptOwner = null) {
    for (const [owner, history] of histories) {
      if (owner !== exceptOwner && [...history.undo, ...history.redo]
        .some(entry => historyChangesOverlap(entry.changes, changes))) clear(history);
    }
  }

  function trimHistory() {
    const stacks = [];
    for (const history of histories.values()) {
      for (const stack of [history.undo, history.redo]) {
        while (stack.length > maxDepth) stack.shift();
        stacks.push(stack);
      }
    }
    // One budget for all module histories, including large images/attachments.
    let bytes = stacks.flat().reduce((total, entry) => total + entry.bytes, 0);
    while (bytes > maxBytes) {
      // Only remove the far end of a stack, never a prerequisite for a retained
      // entry. Redo's farthest future change is at index zero.
      const stack = stacks.filter(items => items.length).sort((a, b) => a[0].order - b[0].order)[0];
      if (!stack) break;
      bytes -= stack.shift().bytes;
    }
  }

  function getDelegateClaim() {
    const claim = delegate?.claim?.();
    return claim && typeof claim === 'object' ? claim : null;
  }

  function getHistoryState(owner = getActiveOwner()) {
    const history = histories.get(owner);
    return { canUndo: Boolean(history?.undo.length), canRedo: Boolean(history?.redo.length),
      undoDepth: history?.undo.length || 0, redoDepth: history?.redo.length || 0 };
  }

  function syncButtons() {
    const history = getDelegateClaim() || getHistoryState();
    for (const [button, available, title] of [
      [undoButton, history.canUndo, 'Undo (Command+Z / Ctrl+Z)'],
      [redoButton, history.canRedo, 'Redo (Command+Shift+Z / Ctrl+Y)']
    ]) {
      if (!button) continue;
      button.disabled = !available;
      button.setAttribute('aria-disabled', String(!available));
      button.title = available ? title : button === undoButton ? 'Nothing to undo' : 'Nothing to redo';
    }
  }

  function reset() {
    histories.forEach(clear);
    baseline = captureHistoryState(state);
    lastOwner = '';
    syncButtons();
  }

  function acceptExternalChanges() {
    const after = captureHistoryState(state);
    if (after.settings?.storagePath !== baseline.settings?.storagePath) {
      reset();
      return;
    }
    invalidate(diffHistoryState(baseline, after));
    baseline = after;
    syncButtons();
  }

  function persist(options = {}) {
    const before = baseline;
    const result = persistStateNow();
    const after = captureHistoryState(state);
    baseline = after;
    if (applying) return result;
    if (before.settings?.storagePath !== after.settings?.storagePath || options.resetHistory === true) {
      reset();
      return result;
    }
    const owner = options.owner ?? getActiveOwner();
    const changes = diffHistoryState(before, after);
    if (options.external === true || options.barrier === true || !owner) {
      invalidate(changes);
      if (options.barrier === true && owner) clear(historyFor(owner));
      lastOwner = '';
      syncButtons();
      return result;
    }
    if (!changes.length) { syncButtons(); return result; }
    invalidate(changes, owner);
    const history = historyFor(owner);
    const now = Date.now();
    const target = getCoalesceTarget(documentObject);
    const previous = history.undo.at(-1);
    const merged = previous && target && target === history.target && lastOwner === owner
      && now - history.at <= coalesceMs && !history.redo.length
      ? mergeHistoryChanges(previous.changes, changes) : null;
    if (merged) {
      previous.changes = merged;
      previous.bytes = JSON.stringify(merged).length * 2;
      if (!merged.length) history.undo.pop();
    } else {
      history.undo.push({ changes, order: ++sequence, bytes: JSON.stringify(changes).length * 2 });
      history.at = now; // Keep the typing window fixed, not sliding.
    }
    history.target = target;
    lastOwner = owner;
    history.redo.length = 0;
    trimHistory();
    syncButtons();
    return result;
  }

  function run(direction, owner) {
    if (applying || !owner) return false;
    // Catch a save acknowledgment or external mutation that has not called
    // persist. Never apply an old history entry over changed live data.
    acceptExternalChanges();
    const history = histories.get(owner);
    const from = history?.[direction];
    const entry = from?.at(-1);
    if (!entry) { syncButtons(); return false; }
    const context = { owner, direction, changes: entry.changes };
    if (beforeRestore(context) === false) return false;
    if (!canApplyHistoryChanges(state, entry.changes, direction)) {
      clear(history);
      syncButtons();
      showTransientNotice('This history no longer matches the current records.', { type: 'error' });
      return false;
    }
    if (removesReferencedHistoryRecord(state, entry.changes, direction)) {
      showTransientNotice('Another record uses this item. Undo or remove that link first.', { type: 'error' });
      return false;
    }
    applying = true;
    const reverse = direction === 'undo' ? 'redo' : 'undo';
    try {
      applyHistoryChanges(state, entry.changes, direction);
      try {
        persistStateNow();
      } catch (error) {
        applyHistoryChanges(state, entry.changes, reverse);
        baseline = captureHistoryState(state);
        showTransientNotice(`Could not ${direction}: ${error.message}`, { type: 'error' });
        return false;
      }
      from.pop();
      history[reverse].push(entry);
      history.at = 0;
      history.target = null;
      lastOwner = '';
      baseline = captureHistoryState(state);
      onRestore?.(context);
      baseline = captureHistoryState(state);
    } finally {
      applying = false;
      syncButtons();
    }
    return true;
  }

  function command(direction) {
    if (getDelegateClaim()) {
      // A claiming editor with empty/busy history must never fall through to a
      // different module if delivery fails.
      const handled = delegate?.run?.(direction) === true;
      syncButtons();
      return handled;
    }
    return run(direction, getActiveOwner());
  }

  function forModule(owner) {
    if (!scopes.has(owner)) scopes.set(owner, {
      persist: (options = {}) => persist({ ...options, owner }),
      undo: () => run('undo', owner),
      redo: () => run('redo', owner),
      getHistoryState: () => getHistoryState(owner)
    });
    return scopes.get(owner);
  }

  undoButton?.addEventListener('click', () => command('undo'));
  redoButton?.addEventListener('click', () => command('redo'));
  documentObject?.addEventListener?.('keydown', event => {
    const direction = getKeyboardCommand(event);
    if (!direction) return;
    event.preventDefault();
    command(direction);
  });
  documentObject?.addEventListener?.('focusin', syncButtons);
  const Observer = windowObject?.MutationObserver;
  if (Observer && documentObject?.body) new Observer(syncButtons).observe(documentObject.body,
    { attributes: true, attributeFilter: ['data-active-view'] });
  syncButtons();

  return { persist, forModule, getHistoryState, acceptExternalChanges, reset, syncButtons,
    undo: () => command('undo'), redo: () => command('redo') };
}
