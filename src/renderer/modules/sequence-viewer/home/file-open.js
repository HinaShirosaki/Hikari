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
  // parse natively (e.g. SnapGene .dna -> GenBank). If one is installed for
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
    setHomeStatus(`Converting ${file.name} with the ${converter.pluginId} service...`);
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
      setHomeStatus(`Reading ${file.name}...`);
      const text = await readSequenceFileText(file);
      const parsed = parseInputRecords(text, { maxRecords: DEFAULT_MAX_RECORDS });
      await openParsedRecordsInDetail(parsed, text, 'Loaded');
      setStatus(`Opened ${file.name} in detail workspace.`);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to open selected file.', true);
    }
  }

  function openNewSequenceDetail() {
    onClearAll();
    navigateToDetail();
    setMode('paste');
    setInputComposerVisible(true);
    setStatus('Paste sequence text, then click Load.');
    elements.inputTextarea?.focus?.();
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
    openSequenceFilePicker,
    openSelectedSequenceFile
  };
}

export { createHomeFileOpen };
