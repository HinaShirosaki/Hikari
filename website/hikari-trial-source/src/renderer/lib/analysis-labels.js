export function formatGelAnalysisTypeLabel(type) {
  if (type === 'western') {
    return 'Western Blot';
  }
  if (type === 'agarose') {
    return 'DNA/RNA Agarose';
  }
  return 'SDS-PAGE';
}

export function formatAssayAnalysisMethodLabel(method) {
  const source = String(method || '').trim();
  if (!source) {
    return 'Analysis plot';
  }
  return source
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
