const EDITOR_SOURCES = Object.freeze([
  { key: 'sampleRegistry', label: 'Sample' },
  { key: 'protocol', label: 'Protocol' },
  { key: 'assay', label: 'Assay' },
  { key: 'biologyNotebook', label: 'Notebook' }
]);

function safeHasUnsavedChanges(moduleApi) {
  try {
    return moduleApi?.hasUnsavedChanges?.() === true;
  } catch (error) {
    console.warn('Failed to inspect unsaved editor state:', error);
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
  const status = documentObject?.getElementById?.('unsaved-changes-status') || null;
  const cancelButton = documentObject?.getElementById?.('unsaved-changes-cancel-btn') || null;
  const discardButton = documentObject?.getElementById?.('unsaved-changes-discard-btn') || null;
  const saveButton = documentObject?.getElementById?.('unsaved-changes-save-btn') || null;
  let allowUnload = false;
  let saveInProgress = false;

  function getUnsavedSources() {
    let external = [];
    try {
      external = externalSources() || [];
    } catch (error) {
      console.warn('Failed to collect external unsaved sources:', error);
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

  function setBusy(isBusy) {
    saveInProgress = Boolean(isBusy);
    if (saveButton) {
      saveButton.disabled = saveInProgress;
      saveButton.textContent = saveInProgress ? 'Saving...' : 'Save and Quit';
    }
    if (discardButton) {
      discardButton.disabled = saveInProgress;
    }
    if (cancelButton) {
      cancelButton.disabled = saveInProgress;
    }
  }

  function renderSourceList(sources) {
    if (!list) {
      return;
    }
    list.replaceChildren(...sources.map((source) => {
      const item = documentObject.createElement('li');
      item.textContent = source.label;
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
    }
  }

  async function saveAndQuit() {
    if (saveInProgress) {
      return;
    }
    const sources = getUnsavedSources();
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
