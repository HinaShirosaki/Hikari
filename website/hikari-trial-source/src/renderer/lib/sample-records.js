export function cloneMetadataObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return Object.entries(value).reduce((accumulator, [key, raw]) => {
    const cleanKey = String(key || '').trim();
    if (cleanKey) {
      accumulator[cleanKey] = raw === null || raw === undefined ? '' : raw;
    }
    return accumulator;
  }, {});
}

export function formatSampleRecordLabel(sample) {
  const code = String(sample?.code || '').trim();
  const name = String(sample?.name || '').trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || String(sample?.id || 'Sample').trim();
}
