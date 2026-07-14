function hasSupportedDataExtension(filePath) {
  return /\.(?:json|ena)$/i.test(String(filePath || '').trim());
}

function normalizeDataFilePath(filePath, fallbackPath = '') {
  const preferred = String(filePath || '').trim();
  const fallback = String(fallbackPath || '').trim();
  const resolved = preferred || fallback;
  if (!resolved) {
    return '';
  }
  return hasSupportedDataExtension(resolved) ? resolved : `${resolved}.json`;
}

module.exports = {
  hasSupportedDataExtension,
  normalizeDataFilePath
};
