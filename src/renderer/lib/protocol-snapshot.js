export function cloneProtocolSnapshot(protocol) {
  if (!protocol || typeof protocol !== 'object') {
    return null;
  }
  const protocolId = String(protocol.id || '').trim();
  return {
    id: protocolId,
    name: String(protocol.name || '').trim() || 'Untitled Protocol',
    category: String(protocol.category || '').trim(),
    purpose: String(protocol.purpose || '').trim(),
    steps: Array.isArray(protocol.steps)
      ? protocol.steps.map((step, index) => ({
        text: String(step?.text || '').trim(),
        placeholders: Array.isArray(step?.placeholders)
          ? step.placeholders.map((placeholder, placeholderIndex) => ({
            id: String(placeholder?.id || '').trim() || `step_${index + 1}_placeholder_${placeholderIndex + 1}`,
            name: String(placeholder?.name || '').trim() || `Value ${placeholderIndex + 1}`
          }))
          : []
      }))
      : []
  };
}
