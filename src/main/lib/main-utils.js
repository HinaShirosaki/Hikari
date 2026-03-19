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

function sanitizeOutputName(value, fallback = 'plasmid') {
  const raw = String(value || '').trim();
  const normalized = raw.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function sanitizeSuffix(value) {
  const raw = String(value ?? '_pLann').trim();
  return raw.replace(/[^A-Za-z0-9._-]/g, '');
}

function normalizeSequenceInput(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  if (raw.startsWith('>')) {
    return raw;
  }

  const cleaned = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (!cleaned) {
    return '';
  }

  const lines = [];
  for (let i = 0; i < cleaned.length; i += 80) {
    lines.push(cleaned.slice(i, i + 80));
  }
  return `>sequence\n${lines.join('\n')}\n`;
}

module.exports = {
  hasSupportedDataExtension,
  normalizeDataFilePath,
  sanitizeOutputName,
  sanitizeSuffix,
  normalizeSequenceInput
};
