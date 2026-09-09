import { PLACEHOLDER_TOKEN_REGEX } from './constants.js';
import { formatTimestamp } from './doc-context.js';

function notebookEntryMeta(entry) {
  return [
    { label: 'Project', value: entry.projectName },
    { label: 'Protocol', value: entry.protocolName },
    { label: String(entry.executedAt || '').trim() ? 'Executed' : 'Updated', value: formatTimestamp(entry.executedAt || entry.updatedAt) }
  ];
}

function notebookStateLabel(entry) {
  const status = String(entry?.notebookState || '').trim().toLowerCase();
  return status === 'suggested' ? 'Suggested' : status === 'planned' ? 'Planned' : 'Executed';
}

function formatGelAnalysisTypeLabel(type) {
  if (type === 'western') {
    return 'Western Blot';
  }
  if (type === 'agarose') {
    return 'DNA/RNA Agarose';
  }
  return 'SDS-PAGE';
}

function formatAssayAnalysisMethodLabel(method) {
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

function hasSerialDilutionContent(summary) {
  return Boolean(
    summary
    && (
      (Array.isArray(summary.feedbackMessages) && summary.feedbackMessages.length)
      || (Array.isArray(summary.initialDilutionRows) && summary.initialDilutionRows.length)
      || (Array.isArray(summary.followingDilutionRows) && summary.followingDilutionRows.length)
      || summary.hasValidPlans
    )
  );
}

function renderStepText(step, values = null) {
  const source = String(step?.text || '');
  const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
  const matches = [...source.matchAll(PLACEHOLDER_TOKEN_REGEX)];

  if (!matches.length) {
    if (!placeholders.length) {
      return source.trim();
    }
    const trailing = placeholders.map((placeholder) => {
      const key = `${step.id}:${placeholder.id}`;
      const rawValue = values ? String(values[key] || '').trim() : '';
      return rawValue || `[${String(placeholder?.name || 'value').trim()}]`;
    }).join(' ');
    return `${source} ${trailing}`.trim();
  }

  let cursor = 0;
  let text = '';
  matches.forEach((match) => {
    const startIndex = Number(match.index || 0);
    const placeholderId = String(match[1] || '');
    const placeholder = placeholders.find((item) => String(item?.id || '') === placeholderId);
    const key = `${step.id}:${placeholderId}`;
    const rawValue = values ? String(values[key] || '').trim() : '';
    text += source.slice(cursor, startIndex);
    text += rawValue || `[${String(placeholder?.name || 'value').trim()}]`;
    cursor = startIndex + match[0].length;
  });
  text += source.slice(cursor);
  return text.trim();
}

export {
  notebookEntryMeta,
  notebookStateLabel,
  formatGelAnalysisTypeLabel,
  formatAssayAnalysisMethodLabel,
  hasSerialDilutionContent,
  renderStepText
};
