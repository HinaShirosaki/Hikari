import { PLACEHOLDER_TOKEN_REGEX } from '../entry/entry-helpers.js';

export function replaceBracketPlaceholders(source, placeholders, renderPlaceholder, safeText) {
  let placeholderIndex = 0;
  let replaced = false;
  const rendered = String(source || '').replace(/\[([^[\]]+)\]/g, (match) => {
    const placeholder = placeholders[placeholderIndex];
    if (!placeholder) {
      return match;
    }
    placeholderIndex += 1;
    replaced = true;
    return renderPlaceholder(placeholder);
  });

  if (replaced) {
    return rendered;
  }

  const trailing = placeholders.map((placeholder) => renderPlaceholder(placeholder)).join(' ');
  return `${safeText(source)} ${trailing}`.trim();
}

export function buildInlinePlaceholderHtml({
  key,
  name,
  value,
  suggestion = '',
  sampleLink = null,
  safeText,
  resolveType,
  getSampleLabel,
  formatLinkValue
}) {
  const cleanName = safeText(name || 'value');
  const placeholderType = resolveType(name);
  const linkedValue = sampleLink ? formatLinkValue(sampleLink) : '';
  const cleanValue = safeText(value || linkedValue || '');
  // Ghost text: shown on the token and as the editor's native placeholder, but
  // never written to the hidden value until the user accepts it with Tab.
  const cleanSuggestion = cleanValue ? '' : safeText(suggestion || '');
  const tokenLabel = cleanValue || cleanSuggestion || `[${cleanName}]`;
  const isEmptyClass = cleanValue ? '' : ' is-empty';
  const isSuggestedClass = cleanSuggestion ? ' is-suggested' : '';
  const suggestionAttrs = cleanSuggestion ? ` data-suggested-value="${cleanSuggestion}"` : '';
  const isSampleClass = placeholderType ? ' is-sample-placeholder' : '';
  const isLinkedClass = sampleLink?.sampleId ? ' is-linked-sample' : '';
  const sampleTypeAttrs = placeholderType
    ? ` data-sample-placeholder-type="${safeText(placeholderType)}"`
    : '';
  const linkedAttrs = sampleLink?.sampleId
    ? ` data-linked-sample-id="${safeText(sampleLink.sampleId)}"`
    : '';
  const title = sampleLink?.sampleId
    ? `Linked sample: ${formatLinkValue(sampleLink)}. Click and type to replace.`
    : (placeholderType
      ? `Click and type to find a ${getSampleLabel(placeholderType)} sample.`
      : (cleanSuggestion ? 'Suggested from your recent runs of this protocol. Click, then press Tab to accept.' : ''));

  return `
      <span class="inline-placeholder-wrap" data-inline-placeholder data-placeholder-name="${cleanName}"${sampleTypeAttrs}${linkedAttrs}${suggestionAttrs}>
        <button type="button" class="inline-placeholder-token${isEmptyClass}${isSampleClass}${isLinkedClass}${isSuggestedClass}" data-inline-token data-nb-key-ref="${safeText(key)}" title="${safeText(title)}">${tokenLabel}</button>
        <input type="text" class="inline-placeholder-editor" data-inline-input data-nb-key-ref="${safeText(key)}" value="${cleanValue}" placeholder="${cleanSuggestion || cleanName}" hidden />
        <input type="hidden" data-nb-key="${safeText(key)}" value="${cleanValue}" />
      </span>
    `;
}

export function renderStepSentence(step, values, helpers) {
  const { safeText, getSampleLink, resolveType, getSampleLabel, formatLinkValue, getSuggestion = () => '' } = helpers;
  const source = String(step?.text || '');
  const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
  const matches = [...source.matchAll(PLACEHOLDER_TOKEN_REGEX)];

  const renderInline = (key, name, rawValue) => buildInlinePlaceholderHtml({
    key,
    name,
    value: rawValue,
    suggestion: getSuggestion(key),
    sampleLink: getSampleLink(key),
    safeText,
    resolveType,
    getSampleLabel,
    formatLinkValue
  });

  if (!matches.length) {
    if (!placeholders.length) {
      return safeText(source);
    }
    return replaceBracketPlaceholders(source, placeholders, (item) => (
      renderInline(item.id, item.name, values[item.id] || '')
    ), safeText);
  }

  let cursor = 0;
  let html = '';

  matches.forEach((match) => {
    const index = Number(match.index || 0);
    const placeholderId = match[1];
    const placeholder = placeholders.find((item) => item.id === placeholderId);
    html += safeText(source.slice(cursor, index));
    html += renderInline(placeholderId, placeholder?.name || 'value', values[placeholderId] || '');
    cursor = index + match[0].length;
  });

  html += safeText(source.slice(cursor));
  return html;
}
