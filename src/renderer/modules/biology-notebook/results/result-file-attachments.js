import { joinStoragePath } from '../../../lib/storage-paths.js';
import { blobToDataUrl, extractBase64Payload } from '../storage/file-import.js';

const IMAGE_MIME_BY_EXTENSION = Object.freeze({
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp'
});

function cleanText(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extensionForName(value) {
  const name = cleanText(value).toLowerCase();
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex) : '';
}

export function inferAttachmentImageMimeType(attachment = {}) {
  const declaredType = cleanText(attachment?.mimeType || attachment?.type).toLowerCase();
  if (declaredType.startsWith('image/')) {
    return declaredType;
  }
  return IMAGE_MIME_BY_EXTENSION[extensionForName(attachment?.name)] || '';
}

export function isImageAttachment(attachment = {}) {
  return Boolean(inferAttachmentImageMimeType(attachment));
}

export function resolveResultFileRecordPath(record = {}, storagePath = '') {
  const directPath = cleanText(record?.path);
  if (directPath) {
    return directPath;
  }
  const relativePath = cleanText(record?.relativePath);
  return relativePath ? joinStoragePath(storagePath, relativePath) : '';
}

export function buildAttachmentDisplayItems(entry = null, pendingFiles = []) {
  const records = Array.isArray(entry?.resultFileRecords)
    ? entry.resultFileRecords.filter((record) => record && typeof record === 'object')
    : [];
  const recordedNames = new Set(records.map((record) => cleanText(record?.name)).filter(Boolean));
  const legacyNames = (Array.isArray(entry?.resultFiles) ? entry.resultFiles : [])
    .map((name) => cleanText(name))
    .filter((name) => name && !recordedNames.has(name));

  return [
    ...records.map((record) => ({
      key: `saved:${cleanText(record.path || record.relativePath || record.name)}`,
      kind: 'saved',
      name: cleanText(record.name) || 'Attached file',
      source: record,
      imageMimeType: inferAttachmentImageMimeType(record),
      dataUrl: ''
    })),
    ...legacyNames.map((name) => ({
      key: `legacy:${name}`,
      kind: 'saved',
      name,
      source: null,
      imageMimeType: inferAttachmentImageMimeType({ name }),
      dataUrl: ''
    })),
    ...Array.from(pendingFiles || []).filter(Boolean).map((file, index) => ({
      key: `pending:${cleanText(file?.name)}:${Number(file?.size) || 0}:${Number(file?.lastModified) || index}`,
      kind: 'pending',
      name: cleanText(file?.name) || 'Dropped file',
      source: file,
      imageMimeType: inferAttachmentImageMimeType(file),
      dataUrl: ''
    }))
  ];
}

export function createResultFileAttachmentLoader({
  readFileBase64,
  getStoragePath = () => ''
} = {}) {
  const storedImageCache = new Map();

  async function resolveRecordImage(record = {}) {
    const mimeType = inferAttachmentImageMimeType(record);
    const path = resolveResultFileRecordPath(record, getStoragePath?.());
    if (!mimeType || !path || typeof readFileBase64 !== 'function') {
      return null;
    }
    if (storedImageCache.has(path)) {
      return storedImageCache.get(path);
    }
    const response = await readFileBase64(path);
    if (!response?.ok || !response.dataBase64) {
      return null;
    }
    const image = {
      name: cleanText(record?.name) || 'Attached image',
      dataUrl: `data:${mimeType};base64,${response.dataBase64}`,
      mimeType,
      path
    };
    storedImageCache.set(path, image);
    return image;
  }

  async function resolvePendingImage(file) {
    const mimeType = inferAttachmentImageMimeType(file);
    if (!mimeType || !file) {
      return null;
    }
    const dataUrl = await blobToDataUrl(file);
    const base64Payload = extractBase64Payload(dataUrl);
    if (!base64Payload) {
      return null;
    }
    return {
      name: cleanText(file?.name) || 'Dropped image',
      dataUrl: cleanText(dataUrl).startsWith('data:image/')
        ? dataUrl
        : `data:${mimeType};base64,${base64Payload}`,
      mimeType,
      path: ''
    };
  }

  async function resolveEntryImages(entry = null) {
    const records = Array.isArray(entry?.resultFileRecords) ? entry.resultFileRecords : [];
    const images = await Promise.all(records.map((record) => resolveRecordImage(record)));
    return images.filter(Boolean);
  }

  function clearCache() {
    storedImageCache.clear();
  }

  return {
    clearCache,
    resolveEntryImages,
    resolvePendingImage,
    resolveRecordImage
  };
}

function renderAttachmentItems(host, items = []) {
  if (!host) {
    return;
  }
  host.hidden = !items.length;
  if (!items.length) {
    host.innerHTML = '';
    return;
  }

  const imageCount = items.filter((item) => item.imageMimeType).length;
  host.innerHTML = `
    <div class="biology-notebook-attachment-head">
      <span>Attachments</span>
      <span class="small-note">${items.length} file${items.length === 1 ? '' : 's'}${imageCount ? ` · ${imageCount} image${imageCount === 1 ? '' : 's'}` : ''}</span>
    </div>
    <div class="biology-notebook-attachment-grid">
      ${items.map((item) => {
        const name = escapeHtml(item.name);
        const status = item.kind === 'pending' ? 'Ready to save' : 'Saved';
        if (item.imageMimeType && item.dataUrl) {
          return `
            <figure class="biology-notebook-attachment biology-notebook-attachment-image">
              <img src="${escapeHtml(item.dataUrl)}" alt="Attached image: ${name}" loading="lazy" />
              <figcaption>
                <span class="biology-notebook-attachment-name">${name}</span>
                <span class="small-note">${status}</span>
              </figcaption>
            </figure>
          `;
        }
        return `
          <div class="biology-notebook-attachment biology-notebook-attachment-file${item.imageMimeType ? ' is-image-loading' : ''}">
            <span class="biology-notebook-attachment-file-icon" aria-hidden="true">${item.imageMimeType ? '▧' : '↳'}</span>
            <span class="biology-notebook-attachment-name">${name}</span>
            <span class="small-note">${item.imageMimeType && !item.previewResolved ? 'Loading preview' : status}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

export function createResultFileAttachmentController({ host, loader } = {}) {
  let renderToken = 0;

  async function render({ entry = null, pendingFiles = [] } = {}) {
    const token = renderToken += 1;
    const items = buildAttachmentDisplayItems(entry, pendingFiles);
    renderAttachmentItems(host, items);
    if (!host || !items.some((item) => item.imageMimeType)) {
      return items;
    }

    const resolvedItems = await Promise.all(items.map(async (item) => {
      if (!item.imageMimeType || !item.source) {
        return { ...item, previewResolved: true };
      }
      try {
        const image = item.kind === 'pending'
          ? await loader?.resolvePendingImage?.(item.source)
          : await loader?.resolveRecordImage?.(item.source);
        return {
          ...item,
          dataUrl: cleanText(image?.dataUrl),
          previewResolved: true
        };
      } catch {
        return { ...item, previewResolved: true };
      }
    }));

    if (token === renderToken) {
      renderAttachmentItems(host, resolvedItems);
    }
    return resolvedItems;
  }

  function clear() {
    renderToken += 1;
    renderAttachmentItems(host, []);
  }

  return { clear, render };
}
