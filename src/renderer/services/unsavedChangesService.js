import { showTransientNotice } from '../lib/notify.js';

const EDITOR_SOURCES = Object.freeze([
  { key: 'protocol', label: 'Protocol' },
  { key: 'assay', label: 'Plate' },
  { key: 'biologyNotebook', label: 'Notebook' }
]);

function safeHasUnsavedChanges(moduleApi) {
  try {
    return moduleApi?.hasUnsavedChanges?.() === true;
  } catch (error) {
    console.warn('Failed to inspect unsaved editor state:', error);
    showTransientNotice('Could not check an editor for unsaved changes.', { type: 'error' });
    return false;
  }
}

export function createUnsavedChangesService({
  moduleRegistry,
  api,
  // Sources that are not modules in this registry — today, plugin frames, which
  // report their dirty state over the bridge because the host cannot reach into
  // them. Same { key, label, moduleApi } shape as EDITOR_SOURCES.
  externalSources = () => [],
  documentObject = globalThis?.document || null,
  windowObject = globalThis?.window || globalThis
} = {}) {
  const overlay = documentObject?.getElementById?.('unsaved-changes-overlay') || null;
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

  function getUnsavedSources() {
    let external = [];
    try {
      external = externalSources() || [];
    } catch (error) {
      console.warn('Failed to collect external unsaved sources:', error);
      showTransientNotice('Could not check plugin panels for unsaved changes.', { type: 'error' });
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
    status.textContent = String(message || '');
    status.classList.toggle('is-error', isError);
  }

  function syncActions() {
    if (saveButton) {
      saveButton.disabled = saveInProgress || selectedKeys.size === 0;
      saveButton.textContent = saveInProgress
        ? 'Saving...'
        : (selectedKeys.size > 1 ? `Save ${selectedKeys.size} & Quit` : 'Save & Quit');
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
    text.textContent = source.label;
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
    if (description) {
      description.textContent = selectable
        ? 'Pick what to save. Anything left unchecked is discarded on quit.'
        : 'The following work has not been saved.';
    }
    if (discardButton) {
      // "Discard" has to own up to dropping the checked rows too.
      discardButton.textContent = selectable ? 'Discard All & Quit' : 'Discard & Quit';
    }
    list.replaceChildren(...sources.map((source) => {
      const item = documentObject.createElement('li');
      if (selectable) {
        item.appendChild(renderOption(source));
      } else {
        item.textContent = source.label;
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
    api?.respondToAppClose?.(action);
  }

  function handleCloseRequested() {
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

  async function saveAndQuit() {
    if (saveInProgress) {
      return;
    }
    // Unchecked editors are left dirty on purpose: quitting drops them.
    const sources = getUnsavedSources().filter((source) => selectedKeys.has(source.key));
    if (!sources.length) {
      hideDialog();
      respondToClose('quit');
      return;
    }

    setBusy(true);
    for (const source of sources) {
      setStatus(`Saving ${source.label}...`);
      try {
        const saved = await source.moduleApi?.saveUnsavedChanges?.();
        if (saved === false || safeHasUnsavedChanges(source.moduleApi)) {
          setStatus(`Could not save ${source.label}. Check the required fields and try again.`, true);
          setBusy(false);
          return;
        }
      } catch (error) {
        setStatus(`Could not save ${source.label}: ${String(error?.message || error || 'Unknown error')}`, true);
        setBusy(false);
        return;
      }
    }

    hideDialog();
    respondToClose('quit');
  }

  function discardAndQuit() {
    if (saveInProgress) {
      return;
    }
    hideDialog();
    respondToClose('quit');
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
  discardButton?.addEventListener('click', discardAndQuit);
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
  windowObject?.addEventListener?.('beforeunload', (event) => {
    if (allowUnload || !getUnsavedSources().length) {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  });

  api?.onAppCloseRequested?.(handleCloseRequested);

  return {
    getUnsavedSources,
    handleCloseRequested,
    saveAndQuit
  };
}
