function defaultText(value, maxLength = 0) {
  const text = String(value || '').trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

export function normalizeIsoTimestamp(rawValue, fallback = '', { text = defaultText, maxLength = 120 } = {}) {
  const candidate = text(rawValue, maxLength);
  if (!candidate) return fallback;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

export function normalizeProtocolMaterials(rawMaterials, {
  text = defaultText,
  maxItems = Number.POSITIVE_INFINITY,
  itemMaxLength = 220
} = {}) {
  const items = Array.isArray(rawMaterials)
    ? rawMaterials.map((item) => text(item, itemMaxLength))
    : text(rawMaterials, 6000)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim());
  return items.filter(Boolean).slice(0, maxItems);
}

export function normalizeProtocolTroubleshooting(rawTroubleshooting, {
  text = defaultText,
  includeStringItems = true
} = {}) {
  if (!Array.isArray(rawTroubleshooting)) return text(rawTroubleshooting, 6000);
  return rawTroubleshooting
    .map((item) => {
      if (typeof item === 'string') return includeStringItems ? text(item, 1200) : '';
      if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
      return [
        text(item.problem, 400) ? `Problem: ${text(item.problem, 400)}` : '',
        text(item.possible_cause || item.possibleCause, 400)
          ? `Possible cause: ${text(item.possible_cause || item.possibleCause, 400)}`
          : '',
        text(item.solution, 400) ? `Solution: ${text(item.solution, 400)}` : ''
      ].filter(Boolean).join('; ');
    })
    .filter(Boolean)
    .join('\n');
}

// Notebook values are keyed by placeholder id alone, so a protocol must not
// reuse an id across steps (e.g. authored JSON numbering "ph1" per step).
export function uniquePlaceholderIds(steps, createId) {
  const seen = new Set();
  return steps.map((step) => {
    let text = step.text;
    const placeholders = step.placeholders.map((placeholder) => {
      if (!seen.has(placeholder.id)) {
        seen.add(placeholder.id);
        return placeholder;
      }
      const id = createId();
      seen.add(id);
      text = text.split(`{{ph:${placeholder.id}}}`).join(`{{ph:${id}}}`);
      return { ...placeholder, id };
    });
    return { ...step, text, placeholders };
  });
}
