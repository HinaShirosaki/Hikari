function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultText(value, maxLength = 0) {
  const text = String(value || '').trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function normalizeLink(rawLink) {
  return rawLink && typeof rawLink === 'object' && !Array.isArray(rawLink) ? rawLink : {};
}

export function paperExperimentLinkKey(rawLink, prefix, index, { text = defaultText } = {}) {
  const link = normalizeLink(rawLink);
  const substantiveKey = [
    text(link.paperId, 220),
    text(link.entryId, 220),
    text(link.projectId, 220),
    text(link.note, 600)
  ].join('::');
  return substantiveKey || `${prefix}_${index + 1}`;
}

export function addPaperExperimentLinks(targetMap, links, {
  prefix = 'paper_link',
  text = defaultText,
  mergeExisting = false,
  skipEmpty = false
} = {}) {
  asArray(links).forEach((rawLink, index) => {
    const link = normalizeLink(rawLink);
    if (skipEmpty && !Object.keys(link).length) return;
    const key = paperExperimentLinkKey(link, prefix, index, { text });
    targetMap.set(key, mergeExisting ? { ...(targetMap.get(key) || {}), ...link } : link);
  });
  return targetMap;
}

export function mergePaperExperimentLinks(existingLinks, importedLinks, options = {}) {
  const merged = new Map();
  addPaperExperimentLinks(merged, existingLinks, {
    ...options,
    prefix: 'existing',
    mergeExisting: true
  });
  addPaperExperimentLinks(merged, importedLinks, {
    ...options,
    prefix: 'imported',
    mergeExisting: true
  });
  return [...merged.values()];
}
