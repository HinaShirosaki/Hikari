const recordTypes = new Set(['protocol', 'notebook']);

export function recordCitationTarget(type, id) {
  if (!recordTypes.has(type) || typeof id !== 'string' || !id || id !== id.trim()
    || Array.from(id).some(char => char.charCodeAt(0) < 32)) return '';
  try {
    return `hikari://${type}/${encodeURIComponent(id).replaceAll('(', '%28').replaceAll(')', '%29')}`;
  } catch {
    return '';
  }
}

export function normalizeRecordEvidence(block) {
  const { source_type: type, record_id: id } = block || {};
  const target = recordCitationTarget(type, id);
  if (!target) return null;
  return {
    source_type: type,
    record_id: id,
    target,
    title: typeof block.title === 'string' ? block.title.trim().slice(0, 220) : '',
    excerpt: typeof block.excerpt === 'string' ? block.excerpt.trim().slice(0, 1200) : ''
  };
}
