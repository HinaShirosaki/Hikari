export function notebookLabel(entry) {
  const typeLabel = entry.notebookType === 'biology' ? 'Biology' : 'Synthesis';
  const updated = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : '-';
  return `${typeLabel}: ${entry.protocolName || '-'} (${updated})`;
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
