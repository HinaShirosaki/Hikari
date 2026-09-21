import { DEFAULT_MAX_RECORDS } from '../constants.js';
import { parseInputRecords } from '../parsing.js';

// Opening a sequence file from disk (or starting a blank record) straight into
// the detail page, without going through the library.
function createHomeFileOpen({
  elements,
  pluginServices,
  readFileAsText,
  readFileAsArrayBuffer,
  onClearAll,
  setMode,
  setStatus,
  setInputComposerVisible,
  setHomeStatus,
  navigateToDetail,
  openParsedRecordsInDetail
} = {}) {
  function fileExtension(name) {
    const match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return match ? match[1].toLowerCase() : '';
  }

  // A service plugin may register a converter for a format the viewer cannot
  // parse natively (e.g. .dna -> GenBank). If one is installed for
  // this file's extension, hand it the raw bytes and continue with the text it
  // returns; otherwise read the file as text as usual.
  async function readSequenceFileText(file) {
    const converter = pluginServices?.getConverter?.(fileExtension(file.name));
    if (!converter) {
      return readFileAsText(file);
    }
    if (typeof readFileAsArrayBuffer !== 'function') {
      throw new Error(`Cannot read .${converter.from} files in this environment.`);
    }
    const buffer = await readFileAsArrayBuffer(file);
    const { text } = await pluginServices.convert({
      extension: converter.from,
      filename: file.name,
      bytes: new Uint8Array(buffer)
    });
    return text;
  }

  async function openSequenceFileInDetail(file) {
    if (!file) {
      return;
    }

    try {
      const text = await readSequenceFileText(file);
      const parsed = parseInputRecords(text, { maxRecords: DEFAULT_MAX_RECORDS });
      await openParsedRecordsInDetail(parsed, text, 'Loaded');
      setStatus(`Opened ${file.name} in detail workspace.`);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to open selected file.', true);
    }
  }

  let newSequenceReturnFocus = null;

  function openNewSequenceDetail() {
    onClearAll();
    navigateToDetail();
    setMode('paste');
    setInputComposerVisible(true);
    setStatus('Paste sequence text, then click Load.');
    elements.inputTextarea?.focus?.();
  }

  function setNewSequenceDialogStatus(message = '', isError = false) {
    if (!elements.newSequenceStatus) {
      return;
    }
    const text = String(message || '').trim();
    elements.newSequenceStatus.textContent = text;
    elements.newSequenceStatus.hidden = !text;
    elements.newSequenceStatus.classList?.toggle?.('is-error', Boolean(text && isError));
  }

  function openNewSequenceDialog(trigger = null) {
    // Partial test and embed surfaces may omit the global dialog. Keep the old
    // detail composer as a safe fallback in those environments.
    if (!elements.newSequenceOverlay) {
      openNewSequenceDetail();
      return;
    }
    newSequenceReturnFocus = trigger || null;
    if (elements.newSequenceTextarea) {
      elements.newSequenceTextarea.value = '';
    }
    setNewSequenceDialogStatus();
    elements.newSequenceOverlay.hidden = false;
    elements.newSequenceTextarea?.focus?.();
  }

  function closeNewSequenceDialog(options = {}) {
    if (elements.newSequenceOverlay) {
      elements.newSequenceOverlay.hidden = true;
    }
    setNewSequenceDialogStatus();
    if (options.restoreFocus !== false) {
      newSequenceReturnFocus?.focus?.();
    }
    newSequenceReturnFocus = null;
  }

  async function submitNewSequenceDialog() {
    const rawText = String(elements.newSequenceTextarea?.value || '');
    if (!rawText.trim()) {
      setNewSequenceDialogStatus('Paste a DNA sequence before loading.', true);
      elements.newSequenceTextarea?.focus?.();
      return false;
    }

    const topology = elements.newSequenceForm?.querySelector?.('input[name="sequence-viewer-new-topology"]:checked')?.value;
    const parsed = parseInputRecords(rawText, { maxRecords: DEFAULT_MAX_RECORDS, topology });
    if (!Array.isArray(parsed?.records) || !parsed.records.length) {
      setNewSequenceDialogStatus(parsed?.errors?.[0] || 'No valid DNA sequence was found.', true);
      elements.newSequenceTextarea?.focus?.();
      return false;
    }

    closeNewSequenceDialog({ restoreFocus: false });
    await openParsedRecordsInDetail(parsed, rawText, 'Loaded');
    return true;
  }

  function openSequenceFilePicker(input = elements.homeOpenInput) {
    input?.click?.();
  }

  async function openSelectedSequenceFile(input) {
    const file = input?.files?.[0];
    await openSequenceFileInDetail(file);
    if (input) {
      input.value = '';
    }
  }

  return {
    fileExtension,
    readSequenceFileText,
    openSequenceFileInDetail,
    openNewSequenceDetail,
    openNewSequenceDialog,
    closeNewSequenceDialog,
    submitNewSequenceDialog,
    openSequenceFilePicker,
    openSelectedSequenceFile
  };
}

export { createHomeFileOpen };
