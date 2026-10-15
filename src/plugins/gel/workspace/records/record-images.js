import { SOURCE_GRAY16_FILE_NAME } from '../constants.js';
import { applySourceGray16 } from '../images/image-io.js';

// Reading a saved gel's image back off disk so a stored record can be reopened.
function createGelRecordImages({
  deps,
  getStorageRoot
} = {}) {
  function resolveStoredImagePath(pathValue, relativePathValue) {
    const storedPath = String(pathValue || '').trim();
    if (storedPath) {
      return storedPath;
    }
    const relativePath = String(relativePathValue || '').trim();
    const storageRoot = getStorageRoot();
    if (!relativePath || !storageRoot) {
      return '';
    }
    return `${storageRoot.replace(/[\\/]+$/, '')}/${relativePath.replace(/^[\\/]+/, '')}`;
  }

  function inferImageMimeType(pathValue) {
    const normalizedPath = String(pathValue || '').toLowerCase();
    if (normalizedPath.endsWith('.jpg') || normalizedPath.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (normalizedPath.endsWith('.webp')) {
      return 'image/webp';
    }
    if (normalizedPath.endsWith('.gif')) {
      return 'image/gif';
    }
    return 'image/png';
  }

  async function readStoredImageDataUrl(pathValue) {
    const storedPath = String(pathValue || '').trim();
    if (!storedPath || typeof window.hikariApi?.readFileBase64 !== 'function') {
      return '';
    }
    const response = await window.hikariApi.readFileBase64(storedPath);
    if (!response?.ok || !response.dataBase64) {
      return '';
    }
    return `data:${inferImageMimeType(storedPath)};base64,${response.dataBase64}`;
  }

  // A 16-bit gel's full-precision grey sits beside source.png. A missing or
  // unreadable one leaves the 8-bit image source.png decodes to.
  async function restoreSourceGray16(image, sourcePath, sourceDataUrl) {
    try {
      const sidecarDataUrl = await readStoredImageDataUrl(sourcePath.replace(/[^\\/]+$/, SOURCE_GRAY16_FILE_NAME));
      return sidecarDataUrl
        ? await applySourceGray16(
          image,
          sidecarDataUrl.slice(sidecarDataUrl.indexOf(',') + 1),
          sourceDataUrl.slice(sourceDataUrl.indexOf(',') + 1)
        )
        : image;
    } catch {
      return image;
    }
  }

  async function restoreRecordImage(record) {
    const sourcePath = resolveStoredImagePath(record.sourceImagePath, record.sourceImageRelativePath);
    const previewPath = resolveStoredImagePath(record.previewImagePath, record.previewImageRelativePath);
    const candidates = [
      {
        kind: 'source',
        dataUrl: String(record.sourceImageDataUrl || '').trim(),
        path: ''
      },
      {
        kind: 'source',
        dataUrl: '',
        path: sourcePath
      },
      {
        kind: record.previewImageIsSource ? 'source' : 'preview',
        dataUrl: String(record.previewImageDataUrl || '').trim(),
        path: ''
      },
      {
        kind: record.previewImageIsSource ? 'source' : 'preview',
        dataUrl: '',
        path: previewPath
      }
    ].filter((candidate) => candidate.dataUrl || candidate.path);

    let lastError = null;
    for (const candidate of candidates) {
      try {
        const dataUrl = candidate.dataUrl || await readStoredImageDataUrl(candidate.path);
        if (!dataUrl) {
          continue;
        }
        const image = await deps.decodeImageSource(
          dataUrl,
          String(record.imageName || candidate.path || 'saved-gel.png')
        );
        return {
          image: candidate.kind === 'source' && candidate.path
            ? await restoreSourceGray16(image, candidate.path, dataUrl)
            : image,
          kind: candidate.kind,
          hadCandidate: true,
          error: null
        };
      } catch (error) {
        lastError = error;
      }
    }

    return {
      image: null,
      kind: '',
      hadCandidate: candidates.length > 0,
      error: lastError
    };
  }

  return {
    resolveStoredImagePath,
    inferImageMimeType,
    readStoredImageDataUrl,
    restoreRecordImage
  };
}

export { createGelRecordImages };
