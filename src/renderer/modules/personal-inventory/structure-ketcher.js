export function installStructureKetcher(ctx) {
  const { sampleCompoundKetcherFrame } = ctx.elements;

async function getKetcherInstance() {
  if (!sampleCompoundKetcherFrame || !sampleCompoundKetcherFrame.contentWindow) {
    throw new Error('Ketcher frame is not loaded yet.');
  }
  let editorFrame = null;
  try {
    editorFrame = sampleCompoundKetcherFrame.contentWindow.document.getElementById('editor');
  } catch {
    throw new Error('Cannot access embedded Ketcher editor.');
  }
  const ketcher = editorFrame?.contentWindow?.ketcher;
  if (!ketcher) {
    throw new Error('Ketcher is still initializing.');
  }
  return ketcher;
}

async function syncStructureDraftToEditor(draft) {
  const molecule = draft?.molfile || draft?.smiles || '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const ketcher = await getKetcherInstance();
      await ketcher.setMolecule(molecule);
      return true;
    } catch {
      await delay(180);
    }
  }
  return false;
}

async function captureStructureDraftFromEditor() {
  const ketcher = await getKetcherInstance();
  const smiles = String(await ketcher.getSmiles()).trim();
  const molfile = String(await ketcher.getMolfile('v3000')).trim();
  const imageDataUrl = await generateStructurePreview(ketcher, molfile || smiles);
  return toStructureDraft({ smiles, molfile, imageDataUrl });
}

async function waitForKetcherInstance() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await getKetcherInstance();
    } catch {
      await delay(180);
    }
  }
  throw new Error('Ketcher is still initializing.');
}

function buildStructureEditorContextFromButton(button, pasteDatasetKey) {
  const mode = String(button.dataset[pasteDatasetKey] || '');
  const typeInput = getStructureTypeInput(mode);
  if (!isChemicalSampleType(typeInput?.value)) {
    syncStructureButtons();
    return null;
  }

  const sampleId = String(button.dataset.sampleId || '');
  return {
    mode,
    sampleId,
    pendingKey: getPendingStructureKey(mode)
  };
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function generateStructurePreview(ketcher, structureSource) {
  if (!ketcher || !structureSource) {
    return '';
  }
  try {
    const svgBlob = await ketcher.generateImage(structureSource, {
      outputFormat: 'svg',
      backgroundColor: '#ffffff',
      bondThickness: 1
    });
    return normalizeImagePayload(svgBlob, 'image/svg+xml');
  } catch {
    // Fall through to PNG generation.
  }
  try {
    const pngBlob = await ketcher.generateImage(structureSource, {
      outputFormat: 'png',
      backgroundColor: '#ffffff',
      bondThickness: 1
    });
    return normalizeImagePayload(pngBlob, 'image/png');
  } catch {
    return '';
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Cannot convert image blob to data URL.'));
    reader.readAsDataURL(blob);
  });
}

async function normalizeImagePayload(payload, mimeType) {
  if (!payload) {
    return '';
  }
  if (typeof payload === 'string') {
    if (payload.startsWith('data:')) {
      return payload;
    }
    return `data:${mimeType};base64,${payload}`;
  }
  if (payload instanceof Blob) {
    return blobToDataUrl(payload);
  }
  if (payload instanceof ArrayBuffer) {
    return `data:${mimeType};base64,${arrayBufferToBase64(payload)}`;
  }
  if (ArrayBuffer.isView(payload)) {
    return `data:${mimeType};base64,${arrayBufferToBase64(payload.buffer)}`;
  }
  return '';
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

  Object.assign(ctx, {
    getKetcherInstance,
    syncStructureDraftToEditor,
    captureStructureDraftFromEditor,
    waitForKetcherInstance,
    delay,
    generateStructurePreview,
    blobToDataUrl,
    normalizeImagePayload,
    arrayBufferToBase64
  });
}
