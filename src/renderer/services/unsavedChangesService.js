import { createPresentation } from "../lib/i18n/presentation.js";
import "../lib/i18n/shell.js";
const i18nUi = createPresentation("shell");
import { bindShellMessage, setShellText, shellNotice, shellUi } from '../lib/i18n/shell.js';

const EDITOR_SOURCES = Object.freeze([
  { key: 'protocol', label: 'Protocol' },
  { key: 'assay', label: 'Plate' },
  { key: 'biologyNotebook', label: 'Notebook' }
]);

// External/plugin labels remain literal; built-in labels translate with the sentence.
function builtInSource(source) {
  return EDITOR_SOURCES.some(item => item.key === source.key);
}
function sourceMessage(kind, source, params = {}) {
  return shellUi(`unsaved.${kind}${builtInSource(source) ? '.' + source.key : ''}`, { ...params, label: source.label });
}
function bindSourceLabel(element, source) {
  if (builtInSource(source)) setShellText(element, `unsaved.source.${source.key}`);
  else i18nUi.setText(element, source.label);
}

function safeHasUnsavedChanges(moduleApi) {
  try {
    return moduleApi?.hasUnsavedChanges?.() === true;
  } catch (error) {
    console.warn('Failed to inspect unsaved editor state:', error);
    shellNotice(shellUi('unsaved.inspectError'), { type: 'error' });
    return false;
  }
}

export function createUnsavedChangesService({
  moduleRegistry,
  api,
  flushPendingSaves = () => {},
  hasPendingSaves = () => false,
  // Sources that are not modules in this registry — today, plugin frames, which
  // report their dirty state over the bridge because the host cannot reach into
  // them. Same { key, label, moduleApi } shape as EDITOR_SOURCES.
  externalSources = () => [],
  documentObject = globalThis?.document || null,
  windowObject = globalThis?.window || globalThis
} = {}) {
  const overlay = documentObject?.getElementById?.('unsaved-changes-overlay') || null;
  const title = documentObject?.getElementById?.('unsaved-changes-title') || null;
  const list = documentObject?.getElementById?.('unsaved-changes-list') || null;
  const description = documentObject?.getElementById?.('unsaved-changes-description') || null;
  const status = documentObject?.getElementById?.('unsaved-changes-status') || null;
  const closeButton = documentObject?.getElementById?.('unsaved-changes-close-btn') || null;
  const cancelButton = documentObject?.getElementById?.('unsaved-changes-cancel-btn') || null;
  const discardButton = documentObject?.getElementById?.('unsaved-changes-discard-btn') || null;
  const saveButton = documentObject?.getElementById?.('unsaved-changes-save-btn') || null;
  const checkboxes = [];
  const selectedKeys = new Set();
  let allowUnload = false;
  let saveInProgress = false;
  let pendingAction = 'quit';

  function getUnsavedSources() {
    let external = [];
    try {
      external = externalSources() || [];
    } catch (error) {
      console.warn('Failed to collect external unsaved sources:', error);
      shellNotice(shellUi('unsaved.pluginError'), { type: 'error' });
    }
    return [
      ...EDITOR_SOURCES.map((source) => ({
        ...source,
        moduleApi: moduleRegistry?.get?.(source.key)
      })),
      ...external
    ].filter((source) => safeHasUnsavedChanges(source.moduleApi));
  }

  function setStatus(message, isError = false) {
    if (!status) {
      return;
    }
    bindShellMessage(status, message);
    status.classList.toggle('is-error', isError);
  }

  function syncActions() {
    const actionKey = pendingAction === 'reload' ? 'Reload' : 'Quit';
    if (saveButton) {
      saveButton.disabled = saveInProgress || (checkboxes.length > 0 && selectedKeys.size === 0);
      setShellText(saveButton, saveInProgress ? 'unsaved.saving'
        : `unsaved.${selectedKeys.size > 1 ? 'saveCount' : 'save'}${actionKey}`, { count: selectedKeys.size });
    }
    if (discardButton) {
      discardButton.disabled = saveInProgress;
    }
    if (cancelButton) {
      cancelButton.disabled = saveInProgress;
    }
    if (closeButton) {
      closeButton.disabled = saveInProgress;
    }
    checkboxes.forEach((checkbox) => {
      checkbox.disabled = saveInProgress;
    });
  }

  function setBusy(isBusy) {
    saveInProgress = Boolean(isBusy);
    syncActions();
  }

  function renderOption(source) {
    const option = documentObject.createElement('label');
    option.className = 'unsaved-changes-option';
    const checkbox = documentObject.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedKeys.add(source.key);
      } else {
        selectedKeys.delete(source.key);
      }
      syncActions();
    });
    const text = documentObject.createElement('span');
    bindSourceLabel(text, source);
    option.appendChild(checkbox);
    option.appendChild(text);
    checkboxes.push(checkbox);
    return option;
  }

  function renderSourceList(sources) {
    checkboxes.length = 0;
    selectedKeys.clear();
    sources.forEach((source) => selectedKeys.add(source.key));
    if (!list) {
      return;
    }
    // A single dirty editor needs no chooser: unchecking the only box would
    // just be "Discard & Quit", which is already a button.
    const selectable = sources.length > 1;
    const actionKey = pendingAction === 'reload' ? 'Reload' : 'Quit';
    if (title) {
      setShellText(title, `unsaved.title${actionKey}`);
    }
    if (description) {
      setShellText(description, selectable ? `unsaved.pick${actionKey}` : (sources.length ? 'unsaved.description' : 'unsaved.pending'));
    }
    if (discardButton) {
      // "Discard" has to own up to dropping the checked rows too.
      setShellText(discardButton, `unsaved.${selectable ? 'discardAll' : 'discard'}${actionKey}`);
    }
    list.replaceChildren(...sources.map((source) => {
      const item = documentObject.createElement('li');
      if (selectable) {
        item.appendChild(renderOption(source));
      } else {
        bindSourceLabel(item, source);
      }
      return item;
    }));
  }

  function showDialog(sources = getUnsavedSources()) {
    if (!overlay) {
      return false;
    }
    renderSourceList(sources);
    setStatus('');
    setBusy(false);
    overlay.hidden = false;
    saveButton?.focus?.();
    return true;
  }

  function hideDialog() {
    if (overlay) {
      overlay.hidden = true;
    }
    setStatus('');
    setBusy(false);
  }

  function respondToClose(action) {
    allowUnload = action === 'quit';
    if (pendingAction === 'reload') {
      pendingAction = 'quit';
      if (allowUnload) windowObject.location.reload();
      return;
    }
    api?.respondToAppClose?.(action);
  }

  function handleCloseRequested() {
    pendingAction = 'quit';
    if (saveInProgress) {
      syncActions();
      api?.respondToAppClose?.('pending');
      return;
    }
    const sources = getUnsavedSources();
    if (!sources.length) {
      respondToClose('quit');
      return;
    }
    if (!showDialog(sources)) {
      respondToClose('cancel');
      return;
    }
    // Main gives us 3s to answer before it assumes the window hung. The user
    // deciding in our dialog takes longer than that, so tell main we're alive
    // and waiting; the real answer follows when they click.
    api?.respondToAppClose?.('pending');
  }

  // location.reload() alone is silently vetoed by our beforeunload listener
  // when an editor is dirty. Resolve the same save/discard choice first.
  async function requestReload() {
    if (saveInProgress || overlay?.hidden === false) return;
    pendingAction = 'reload';
    const sources = getUnsavedSources();
    if (!sources.length) {
      await finishClose();
    } else if (!showDialog(sources)) {
      respondToClose('cancel');
      shellNotice(shellUi('unsaved.reloadError'), { type: 'error' });
    }
  }

  async function finishClose() {
    if (overlay?.hidden !== false) showDialog([]);
    setBusy(true);
    setStatus(shellUi('unsaved.storageSaving'));
    try {
      await flushPendingSaves();
    } catch (error) {
      if (overlay?.hidden !== false) showDialog([]);
      const message = shellUi('unsaved.storageError', { error: String(error?.message || error || 'Unknown error') });
      setStatus(message, true);
      setBusy(false);
      if (!overlay) shellNotice(message, { type: 'error' });
      return;
    }
    hideDialog();
    respondToClose('quit');
  }

  async function saveAndQuit() {
    if (saveInProgress) {
      return;
    }
    // Unchecked editors are left dirty on purpose: quitting drops them.
    const sources = getUnsavedSources().filter((source) => selectedKeys.has(source.key));
    setBusy(true);
    for (const source of sources) {
      setStatus(sourceMessage('savingSource', source));
      try {
        const saved = await source.moduleApi?.saveUnsavedChanges?.();
        if (saved === false || safeHasUnsavedChanges(source.moduleApi)) {
          setStatus(sourceMessage('validation', source), true);
          setBusy(false);
          return;
        }
      } catch (error) {
        setStatus(sourceMessage('saveError', source, { error: String(error?.message || error || 'Unknown error') }), true);
        setBusy(false);
        return;
      }
    }

    await finishClose();
  }

  async function discardAndQuit() {
    if (saveInProgress) {
      return;
    }
    await finishClose();
  }

  function cancelClose() {
    if (saveInProgress) {
      return;
    }
    hideDialog();
    respondToClose('cancel');
  }

  closeButton?.addEventListener('click', cancelClose);
  cancelButton?.addEventListener('click', cancelClose);
  discardButton?.addEventListener('click', () => { void discardAndQuit(); });
  saveButton?.addEventListener('click', () => {
    void saveAndQuit();
  });
  overlay?.addEventListener('click', (event) => {
    if (event.target === overlay) {
      cancelClose();
    }
  });
  documentObject?.addEventListener?.('keydown', (event) => {
    if (event.key === 'Escape' && overlay?.hidden === false) {
      event.preventDefault();
      cancelClose();
    }
  });
  // Every quit answers the close handshake first, so a veto here only stops a
  // direct reload (macOS View > Reload) that would race a queued storage save.
  windowObject?.addEventListener?.('beforeunload', (event) => {
    if (allowUnload || (!saveInProgress && !hasPendingSaves() && !getUnsavedSources().length)) {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  });

  api?.onAppCloseRequested?.(handleCloseRequested);

  return {
    getUnsavedSources,
    handleCloseRequested,
    requestReload,
    saveAndQuit
  };
}
