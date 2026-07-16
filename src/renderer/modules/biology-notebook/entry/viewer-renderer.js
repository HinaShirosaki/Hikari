import {
  formatEntryTimestamp,
  notebookStateLabel,
  resolveEntryCollectionName,
  resolveEntryExecutedAt,
  resolveEntryExperimentName
} from './entry-helpers.js';
import {
  formatSampleLinkValue,
  getSampleTypeLabel,
  normalizeNotebookSampleLinks,
  resolveSampleTypeForPlaceholder
} from '../samples/sample-helpers.js';
import { renderStepSentence } from '../protocol/step-renderer.js';
import { summarizeNotebookResultTables } from '../../../lib/notebook-result-tables.js';
import { summarizeNotebookToolCalculations } from '../../../lib/notebook-tool-calculations.js';

export function buildViewerMeta({
  project,
  entry,
  isSavedEntry,
  projects = []
}) {
  const contextLabel = entry
    ? `${resolveEntryCollectionName(entry, projects)} / ${resolveEntryExperimentName(entry)}`
    : String(project?.name || '').trim() || 'Untitled Project';
  if (entry) {
    const updatedAt = entry.updatedAt ? formatEntryTimestamp(entry.updatedAt) : 'Unknown time';
    const stateLabel = notebookStateLabel(entry);
    const executedAt = resolveEntryExecutedAt(entry)
      ? ` Executed at ${formatEntryTimestamp(resolveEntryExecutedAt(entry))}.`
      : '';
    const resultFiles = Array.isArray(entry.resultFiles) && entry.resultFiles.length
      ? ` Result files: ${entry.resultFiles.join(', ')}.`
      : '';
    const resultTableSummary = summarizeNotebookResultTables(entry?.resultTables, entry?.resultTable);
    const resultTable = resultTableSummary
      ? ` Result table: ${resultTableSummary}.`
      : '';
    const toolCalculationSummary = summarizeNotebookToolCalculations(entry?.toolCalculations);
    const toolCalculations = toolCalculationSummary
      ? ` Tool calculations: ${toolCalculationSummary}.`
      : '';
    const sampleLinkCount = normalizeNotebookSampleLinks(entry?.sampleLinks).length;
    const sampleLinks = sampleLinkCount
      ? ` Linked samples: ${sampleLinkCount}.`
      : '';
    return `${contextLabel} notebook page. State: ${stateLabel}. Updated ${updatedAt}.${executedAt}${resultFiles}${resultTable}${toolCalculations}${sampleLinks}`;
  }
  if (isSavedEntry) {
    return `${contextLabel} notebook page.`;
  }
  return `${contextLabel} protocol draft. Fill placeholders and results, then save this notebook page.`;
}

export function buildProtocolStepsHtml({
  protocol,
  values,
  safeText,
  settings = {},
  samplePlaceholderTypeAliases,
  getSampleLink
}) {
  const helpers = {
    safeText,
    getSampleLink,
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
