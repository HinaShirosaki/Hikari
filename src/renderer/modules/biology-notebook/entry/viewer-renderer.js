import {
  notebookStateLabel,
  resolveEntryExecutedAt
} from './entry-helpers.js';
import {
  formatSampleLinkValue,
  getSampleTypeLabel,
  normalizeNotebookSampleLinks,
  resolveSampleTypeForPlaceholder
} from '../samples/sample-helpers.js';
import { renderStepSentence } from '../protocol/step-renderer.js';
import { summarizeNotebookToolCalculations } from '../../../lib/notebook-tool-calculations.js';

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

export function buildViewerMeta({
  project,
  entry,
  isSavedEntry
}) {
  if (entry) {
    const executedAt = resolveEntryExecutedAt(entry);
    const parts = [notebookStateLabel(entry)];
    if (executedAt) {
      parts.push(viewerTimestamp(executedAt));
    }
    if (!executedAt || new Date(entry.updatedAt).getTime() !== new Date(executedAt).getTime()) {
      parts.push(`Updated ${viewerTimestamp(entry.updatedAt, executedAt)}`);
    }
    const toolCalculationSummary = summarizeNotebookToolCalculations(entry?.toolCalculations);
    if (toolCalculationSummary) {
      parts.push(toolCalculationSummary);
    }
    const sampleLinkCount = normalizeNotebookSampleLinks(entry?.sampleLinks).length;
    if (sampleLinkCount) {
      parts.push(`${sampleLinkCount} linked sample${sampleLinkCount === 1 ? '' : 's'}`);
    }
    return parts.join(' · ');
  }
  const contextLabel = String(project?.name || '').trim() || 'Untitled Project';
  if (isSavedEntry) {
    return `${contextLabel} notebook page.`;
  }
  return `${contextLabel} protocol draft. Fill placeholders and results, then save this notebook page.`;
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
          <p class="notebook-step-line"><strong>Step ${index + 1}:</strong> <span class="notebook-step-content" data-selection-segment-id="notebook:step:${safeText(String(step?.id || `step_${index + 1}`))}" data-selection-segment-label="Step ${index + 1}">${sentenceHtml}</span></p>
        </article>
      `;
  }).join('');
}
