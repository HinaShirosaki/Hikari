import { dateSpan } from '../../../lib/i18n/markup.js';
import { notebookMessage } from '../localization.js';
import { resolveEntryExecutedAt } from './entry-helpers.js';
import {
  formatSampleLinkValue,
  getSampleTypeLabel,
  resolveSampleTypeForPlaceholder
} from '../samples/sample-helpers.js';
import { renderStepSentence } from '../protocol/step-renderer.js';

function viewerTimestamp(rawValue, sameDayAs = '') {
  const date = new Date(String(rawValue || '').trim());
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }
  const reference = new Date(String(sameDayAs || '').trim());
  const sameDay = !Number.isNaN(reference.getTime())
    && date.toDateString() === reference.toDateString();
  return date.toLocaleString(undefined, {
    ...(sameDay ? {} : { dateStyle: 'medium' }),
    timeStyle: 'short'
  });
}

// The line under a page title carries times only; an unsaved draft has none.
export function buildViewerMeta({ entry }) {
  if (!entry) {
    return '';
  }
  const executedAt = resolveEntryExecutedAt(entry);
  const parts = [];
  if (executedAt) {
    parts.push(`Executed ${viewerTimestamp(executedAt)}`);
  }
  if (!executedAt || new Date(entry.updatedAt).getTime() !== new Date(executedAt).getTime()) {
    parts.push(`Updated ${viewerTimestamp(entry.updatedAt, executedAt)}`);
  }
  return parts.join(' · ');
}

// Live display bindings preserve the original OS date format in English.
export function buildViewerMetaHtml({ entry }) {
  if (!entry) return '';
  const executedAt = resolveEntryExecutedAt(entry);
  const part = (key, value, sameDayAs = '') => {
    const date = new Date(String(value || '').trim());
    if (Number.isNaN(date.getTime())) return `${notebookMessage(key)} ${notebookMessage('meta.unknown')}`;
    const reference = new Date(sameDayAs);
    const sameDay = !Number.isNaN(reference.getTime()) && date.toDateString() === reference.toDateString();
    return `${notebookMessage(key)} ${dateSpan(date.toISOString(), viewerTimestamp(value, sameDayAs), {
      ...(sameDay ? {} : { dateStyle: 'medium' }), timeStyle: 'short'
    })}`;
  };
  const parts = [];
  if (executedAt) parts.push(part('meta.executed', executedAt));
  if (!executedAt || new Date(entry.updatedAt).getTime() !== new Date(executedAt).getTime()) parts.push(part('meta.updated', entry.updatedAt, executedAt));
  return parts.join(' · ');
}

export function buildProtocolStepsHtml({
  protocol,
  values,
  prefill = {},
  safeText,
  settings = {},
  samplePlaceholderTypeAliases,
  getSampleLink
}) {
  const helpers = {
    safeText,
    getSampleLink,
    getSuggestion: (key) => String(prefill?.[key]?.suggestion || ''),
    resolveType: (name) => resolveSampleTypeForPlaceholder(name, samplePlaceholderTypeAliases),
    getSampleLabel: (type) => getSampleTypeLabel(type, settings),
    formatLinkValue: formatSampleLinkValue
  };
  return (Array.isArray(protocol?.steps) ? protocol.steps : []).map((step, index) => {
    const sentenceHtml = renderStepSentence(step, values || {}, helpers);
    return `
        <article class="card">
          <p class="notebook-step-line"><strong>${notebookMessage('step.number', { index: index + 1 })}</strong> <span class="notebook-step-content" data-selection-segment-id="notebook:step:${index + 1}" data-selection-segment-label="Step ${index + 1}">${sentenceHtml}</span></p>
        </article>
      `;
  }).join('');
}
