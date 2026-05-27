import { normalizeCompoundStructureData } from './compound-model.js';
import { escapeHtml } from './sample-utils.js';

export async function generateCompoundStructurePreview(ketcher, structureSource) {
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
    // Fall through to PNG preview generation.
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

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Cannot convert image blob to data URL.'));
    reader.readAsDataURL(blob);
  });
}

export async function normalizeImagePayload(payload, mimeType) {
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
  if (payload && typeof payload === 'object') {
    if (payload.data && typeof payload.data === 'string') {
      if (payload.data.startsWith('data:')) {
        return payload.data;
      }
      return `data:${mimeType};base64,${payload.data}`;
    }
    if (payload.blob instanceof Blob) {
      return blobToDataUrl(payload.blob);
    }
  }
  return '';
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function renderCompoundPreviewMarkup(structure, label, safeText) {
  const normalized = normalizeCompoundStructureData(structure);
  if (!normalized) {
    return `
      <section class="sample-structure-card">
        <h4>Structure Snapshot</h4>
        <p class="small-note">No structure has been saved for this chemical yet.</p>
      </section>
    `;
  }

  const imageMarkup = normalized.imageDataUrl
    ? `
      <div class="sample-structure-preview">
        <img src="${escapeHtml(normalized.imageDataUrl)}" alt="${escapeHtml(`${label} structure preview`)}" />
      </div>
    `
    : '<p class="small-note">Structure saved without an image preview.</p>';

  const smilesMarkup = normalized.smiles
    ? `<p><strong>SMILES:</strong> ${safeText(normalized.smiles)}</p>`
    : '';

  return `
    <section class="sample-structure-card">
      <h4>Structure Snapshot</h4>
      ${imageMarkup}
      ${smilesMarkup}
    </section>
  `;
}
