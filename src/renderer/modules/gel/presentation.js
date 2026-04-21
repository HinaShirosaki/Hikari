export function notebookLabel(entry) {
  const typeLabel = entry.notebookType === 'biology' ? 'Biology' : 'Synthesis';
  const updated = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : '-';
  const pageName = String(entry.experimentName || entry.protocolName || '-').trim() || '-';
  return `${typeLabel}: ${pageName} (${updated})`;
}

export function formatAnalysisTypeLabel(type) {
  if (type === 'western') {
    return 'Western Blot';
  }
  if (type === 'agarose') {
    return 'DNA/RNA Agarose';
  }
  return 'SDS-PAGE';
}
