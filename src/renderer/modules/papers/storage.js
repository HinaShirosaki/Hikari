export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read PDF file.'));
    reader.readAsDataURL(file);
  });
}

export function extractBase64Payload(dataUrl) {
  const source = String(dataUrl || '');
  const commaIndex = source.indexOf(',');
  if (commaIndex < 0) {
    return '';
  }
  return source.slice(commaIndex + 1).trim();
}

export function sanitizeFolderName(value) {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildPaperStorageFolder({ rootPath, linkedType, linkedName }) {
  const category = linkedType === 'journal-club' ? 'JournalClub' : 'Project';
  const safeLinkedName = sanitizeFolderName(linkedName) || 'Uncategorized';
  return `${String(rootPath || '').trim()}/${category}/${safeLinkedName}/Papers`;
}

export function resolveStoredPaperPath(paper, storagePath = '') {
  const directPath = String(paper?.storedFilePath || '').trim();
  if (directPath) {
    return directPath;
  }

  const relativePath = String(paper?.storedRelativePath || '').trim();
  const storageRoot = String(storagePath || '').trim();
  if (!relativePath || !storageRoot) {
    return '';
  }

  const rootClean = storageRoot.replace(/[\\/]+$/, '');
  const relativeParts = relativePath.split(/[\\/]+/).filter(Boolean);
  if (!rootClean || !relativeParts.length) {
    return '';
  }
  const separator = rootClean.includes('\\') ? '\\' : '/';
  return [rootClean, ...relativeParts].join(separator);
}

export function openPdfDataUrl(pdfDataUrl, targetWindow = window) {
  const source = String(pdfDataUrl || '').trim();
  if (!source) {
    return false;
  }

  const base64Match = source.match(/^data:application\/pdf(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (base64Match?.[1]) {
    try {
      const binary = atob(base64Match[1]);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const popup = targetWindow?.open?.(blobUrl, '_blank', 'noopener,noreferrer');
      targetWindow?.setTimeout?.(() => {
        URL.revokeObjectURL(blobUrl);
      }, 60_000);
      return Boolean(popup);
    } catch {
      // Fall through to direct open below.
    }
  }

  const popup = targetWindow?.open?.(source, '_blank', 'noopener,noreferrer');
  return Boolean(popup);
}

export function parsePdfDataUrl(pdfDataUrl) {
  const value = String(pdfDataUrl || '').trim();
  const match = value.match(/^data:application\/pdf(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match?.[1]) {
    return '';
  }
  return match[1];
}

export function decodeBase64Pdf(base64) {
  const binary = atob(String(base64 || '').trim());
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
