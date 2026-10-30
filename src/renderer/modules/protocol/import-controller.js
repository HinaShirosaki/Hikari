import { protocolUi, protocolError, protocolDisplayText, bindProtocolMessage, protocolNotice } from './localization.js';

export function createProtocolImportController({
  state,
  persist,
  createId,
  ui,
  localState,
  FileReaderClass,
  parseProtocolsFromJson,
  onProtocolsChanged,
  renderList
}) {
  function buildUniqueImportedProtocolName(baseName) {
    const takenNames = new Set(
      state.protocols
        .map((item) => String(item?.name || '').trim().toLowerCase())
        .filter(Boolean)
    );

    const resolvedBaseName = String(baseName || '').trim() || 'Imported Protocol';
    let candidate = resolvedBaseName;
    let suffix = 2;

    while (takenNames.has(candidate.toLowerCase())) {
      candidate = `${resolvedBaseName} ${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  function addImportedProtocol(incoming, copySuffixLabel = 'Imported Copy') {
    const idConflict = state.protocols.some((item) => String(item?.id || '') === String(incoming.id || ''));
    const nameConflict = state.protocols.some(
      (item) => String(item?.name || '').trim().toLowerCase() === String(incoming.name || '').trim().toLowerCase()
    );

    if (!idConflict && !nameConflict) {
      state.protocols.push(incoming);
      return incoming;
    }

    const suffixedName = `${incoming.name} (${String(copySuffixLabel || 'Imported Copy').trim() || 'Imported Copy'})`;
    const imported = {
      ...incoming,
      id: createId(),
      name: buildUniqueImportedProtocolName(suffixedName)
    };
    state.protocols.push(imported);
    return imported;
  }

  async function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const Reader = FileReaderClass || globalThis.FileReader;
      if (typeof Reader !== 'function') {
        reject(protocolError('import.readerUnavailable'));
        return;
      }
      const reader = new Reader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(protocolError('import.readFileError'));
      reader.readAsText(file);
    });
  }

  async function readProtocolJsonImportInput() {
    const directText = String(ui.protocolJsonImportInput?.value || '').trim();
    if (directText) {
      return directText;
    }

    const file = ui.protocolJsonImportFileInput?.files?.[0];
    if (!file) {
      return '';
    }
    return readTextFile(file);
  }

  function setProtocolJsonImportStatus(message, isError = false) {
    if (!ui.protocolJsonImportStatus) {
      return;
    }
    const text = protocolDisplayText(message).trim();
    bindProtocolMessage(ui.protocolJsonImportStatus, message);
    ui.protocolJsonImportStatus.hidden = !text;
    ui.protocolJsonImportStatus.classList.toggle('is-error', Boolean(isError && text));
  }

  function resetProtocolJsonImportUi() {
    if (ui.protocolJsonImportInput) {
      ui.protocolJsonImportInput.value = '';
    }
    if (ui.protocolJsonImportFileInput) {
      ui.protocolJsonImportFileInput.value = '';
    }
    setProtocolJsonImportStatus('');
    closeProtocolJsonImportOverlay();
  }

  function openProtocolJsonImportOverlay() {
    if (!ui.protocolJsonImportOverlay || localState.isCreateEditorMode !== true) {
      return;
    }
    ui.protocolJsonImportOverlay.hidden = false;
    ui.protocolJsonImportInput?.focus?.();
  }

  function closeProtocolJsonImportOverlay() {
    if (ui.protocolJsonImportOverlay) {
      ui.protocolJsonImportOverlay.hidden = true;
    }
  }

  function syncProtocolImportPanelVisibility() {
    if (!ui.protocolJsonImportPanel) {
      return;
    }
    ui.protocolJsonImportPanel.hidden = !localState.isCreateEditorMode;
    if (!localState.isCreateEditorMode) {
      closeProtocolJsonImportOverlay();
    }
  }

  function importProtocolsFromJson(rawInput, options = {}) {
    const incomingProtocols = parseProtocolsFromJson(rawInput);
    if (!incomingProtocols.length) {
      return {
        ok: false,
        error: 'Invalid protocol JSON payload. Use a protocol object, {"protocols":[...]}, or a protocol array.'
      };
    }

    const copySuffixLabel = String(options.copySuffixLabel || 'Imported Copy').trim() || 'Imported Copy';
    const importedProtocols = incomingProtocols.map((incoming) => addImportedProtocol(incoming, copySuffixLabel));

    persist();
    if (options.notifyChanged !== false) {
      onProtocolsChanged?.();
    }
    if (options.renderList !== false) {
      renderList?.();
    }

    return {
      ok: true,
      importedProtocols
    };
  }

  async function onImportProtocolJson() {
    let rawInput = '';

    try {
      rawInput = await readProtocolJsonImportInput();
    } catch (error) {
      const message = error || protocolUi('import.readError');
      setProtocolJsonImportStatus(message, true);
      protocolNotice(message, { type: 'error' });
      return;
    }

    if (!String(rawInput || '').trim()) {
      const message = protocolUi('import.required');
      setProtocolJsonImportStatus(message, true);
      protocolNotice(message, { type: 'error' });
      return;
    }

    const result = importProtocolsFromJson(rawInput, { copySuffixLabel: 'Imported Copy' });
    if (!result.ok) {
      // The public import result retains its English API error; this is its UI copy.
      const message = protocolUi(result.error ? 'import.invalid' : 'import.error');
      setProtocolJsonImportStatus(message, true);
      protocolNotice(message, { type: 'error' });
      return;
    }

    resetProtocolJsonImportUi();

    if (result.importedProtocols.length === 1) {
      setProtocolJsonImportStatus(protocolUi('import.one', { name: result.importedProtocols[0].name }));
      closeProtocolJsonImportOverlay();
      return;
    }
    setProtocolJsonImportStatus(protocolUi('import.many', { count: result.importedProtocols.length }));
    closeProtocolJsonImportOverlay();
  }

  closeProtocolJsonImportOverlay();

  return {
    setProtocolJsonImportStatus,
    resetProtocolJsonImportUi,
    openProtocolJsonImportOverlay,
    closeProtocolJsonImportOverlay,
    syncProtocolImportPanelVisibility,
    importProtocolsFromJson,
    onImportProtocolJson
  };
}
