import { getGelAnalyses } from '../../../lib/gel-records.js';
import { findLatestLinkedRecord } from '../../../services/notebook-linked-previews.js';
import {
  mergeNotebookValues,
  normalizeNotebookState,
  pruneNotebookValuesForProtocol,
  resolveEntryExperimentName
} from '../entry/entry-helpers.js';
import {
  formatSampleLinkValue,
  normalizeNotebookSampleLinks
} from '../samples/sample-helpers.js';
import { serializeDraftSnapshot } from '../../../lib/unsaved-draft.js';
import { flattenNotebookResultTablesText } from '../../../lib/notebook-result-tables.js';
import { resolveNotebookResultTablesValues } from '../../../lib/notebook-table-formulas.js';

// The hidden context the Agent reads for the open notebook page, plus the draft
// snapshot used to tell a dirty page from a saved one.
function createNotebookAgentContext({
  state,
  elements,
  protocolEditor,
  resultTableController,
  toolSidebarController,
  getActiveEntry,
  getSelectedNotebookResultFiles,
  collectNotebookSampleLinks,
  resolveViewerProject,
  resolveViewerProtocol,
  findDashboardProject,
  findSelectedProject,
  getEditingEntryId,
  getActiveProjectDashboardId,
  getSampleLinkDrafts,
  setSavedDraftSnapshot,
  onActiveNotebookPageChanged
} = {}) {
  const {
    notebookProjectSelect,
    notebookProtocolSelect,
    notebookProtocolArea,
    notebookProtocolDraftName,
    notebookProtocolDraftSteps,
    notebookExperimentName,
    notebookResult,
    notebookSteps
  } = elements;

  function collectNotebookValues() {
    const values = {};
    notebookSteps.querySelectorAll('[data-nb-key]').forEach((input) => {
      values[input.dataset.nbKey] = input.value.trim();
    });
    return values;
  }

  // Placeholders whose value was accepted from a previous run rather than typed.
  function collectCarriedOverKeys() {
    return [...notebookSteps.querySelectorAll('[data-inline-placeholder][data-carried-over]')]
      .map((wrap) => String(wrap.querySelector('[data-nb-key]')?.dataset.nbKey || '').trim())
      .filter(Boolean);
  }

  function compactContextLine(value, maxLength = 900) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      return '';
    }
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
  }

  function compactContextBlock(value, maxLength = 12000) {
    const text = String(value || '').trim();
    if (!text) {
      return '';
    }
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}\n...` : text;
  }

  function getProtocolStepText(step) {
    return compactContextLine(step?.text || step?.instruction || step?.action || step?.description, 1200);
  }

  function buildStepContextLines(protocol, values = {}) {
    const steps = Array.isArray(protocol?.steps) ? protocol.steps : [];
    return steps.slice(0, 80).map((step, index) => {
      const stepId = String(step?.id || `step_${index + 1}`).trim();
      const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
      const filledValues = placeholders.map((placeholder) => {
        const placeholderId = String(placeholder?.id || '').trim();
        const placeholderName = String(placeholder?.name || placeholderId || 'value').trim();
        const value = compactContextLine(values[`${stepId}:${placeholderId}`] || values[placeholderId] || '', 180);
        return value ? `${placeholderName}=${value}` : '';
      }).filter(Boolean);
      const suffix = filledValues.length ? ` Filled values: ${filledValues.join('; ')}.` : '';
      return `Step ${index + 1}: ${getProtocolStepText(step)}${suffix}`;
    }).filter(Boolean);
  }

  function buildSampleLinkContextLines(entry = null, protocol = null) {
    const links = collectNotebookSampleLinks(entry, protocol);
    return normalizeNotebookSampleLinks(links)
      .slice(0, 24)
      .map((link) => {
        const placeholder = compactContextLine(link.placeholderName || link.placeholderKey, 120);
        const details = [
          `sample=${compactContextLine(formatSampleLinkValue(link), 180)}`,
          link.sampleId ? `id=${compactContextLine(link.sampleId, 120)}` : '',
          link.sampleType ? `type=${compactContextLine(link.sampleType, 80)}` : '',
          link.sampleLot ? `lot=${compactContextLine(link.sampleLot, 120)}` : '',
          link.sampleConcentration ? `recorded concentration=${compactContextLine(link.sampleConcentration, 120)}` : '',
          link.storageLabel ? `storage=${compactContextLine(link.storageLabel, 220)}` : ''
        ].filter(Boolean).join('; ');
        return `${placeholder ? `${placeholder}: ` : ''}${details}`;
      })
      .filter(Boolean);
  }

  function getActiveNotebookPageAgentContext() {
    if (!notebookProtocolArea || notebookProtocolArea.hidden) {
      return null;
    }
    const entry = getActiveEntry();
    const project = resolveViewerProject(entry);
    const protocol = resolveViewerProtocol(entry);
    if (!project || !protocol) {
      return null;
    }
    const values = pruneNotebookValuesForProtocol(
      mergeNotebookValues(entry?.values, collectNotebookValues()),
      protocol
    );
    const resultText = compactContextBlock(notebookResult?.value || entry?.result || '', 12000);
    const resultTables = resultTableController.getCurrentTables();
    const tableText = compactContextBlock(
      // The model reads what the table shows, not the formulas behind it.
      flattenNotebookResultTablesText(resolveNotebookResultTablesValues(resultTables, entry?.resultTable)),
      12000
    );
    const toolCalculations = toolSidebarController.getCalculations();
    const toolCalculationText = compactContextBlock(JSON.stringify(toolCalculations, null, 2), 8000);
    const linkedGel = entry?.id ? findLatestLinkedRecord(getGelAnalyses(state), entry.id) : null;
    const linkedAssay = entry?.id ? findLatestLinkedRecord(state.assays, entry.id) : null;
    const sampleLinks = buildSampleLinkContextLines(entry, protocol);
    const pageTitle = compactContextLine(
      notebookExperimentName?.value || resolveEntryExperimentName(entry, protocol) || protocol.name,
      320
    );
    const pageState = entry ? normalizeNotebookState(entry.notebookState) : 'draft';
    const lines = [
      'Active biology notebook page:',
      `Title: ${pageTitle || 'Untitled notebook page'}`,
      `Entry ID: ${entry?.id || 'unsaved draft'}`,
      entry?.updatedAt ? `Updated at: ${entry.updatedAt}` : '',
      `Notebook state: ${pageState}`,
      `Project: ${compactContextLine(project.name, 220)}${project.id ? ` (${project.id})` : ''}`,
      `Protocol: ${compactContextLine(protocol.name, 220)}${protocol.id ? ` (${protocol.id})` : ''}`,
      'Protocol steps:',
      ...buildStepContextLines(protocol, values),
      resultText ? 'Page notes/results:' : '',
      resultText,
      tableText ? 'Result tables:' : '',
      tableText,
      sampleLinks.length ? 'Linked samples:' : '',
      ...sampleLinks,
      toolCalculationText ? 'Recorded bench calculations:' : '',
      toolCalculationText,
      linkedGel ? 'Latest linked gel analysis:' : '',
      linkedGel ? compactContextBlock(JSON.stringify(linkedGel, null, 2), 6000) : '',
      linkedAssay ? 'Latest linked assay:' : '',
      linkedAssay ? compactContextBlock(JSON.stringify(linkedAssay, null, 2), 6000) : '',
      Array.isArray(entry?.resultFiles) && entry.resultFiles.length ? `Result files: ${entry.resultFiles.join(', ')}` : ''
    ].filter((line) => line !== '');

    return {
      scopeType: 'notebook',
      notebookEntryId: entry?.id || '',
      notebookUpdatedAt: String(entry?.updatedAt || '').trim(),
      pageTitle,
      projectId: String(project.id || '').trim(),
      projectName: String(project.name || '').trim(),
      protocolId: String(protocol.id || '').trim(),
      protocolName: String(protocol.name || '').trim(),
      hiddenContext: {
        kind: 'notebook-page',
        label: pageTitle ? `Active notebook page: ${pageTitle}` : 'Active notebook page',
        text: lines.join('\n'),
        notebookEntryId: entry?.id || '',
        notebookUpdatedAt: String(entry?.updatedAt || '').trim(),
        projectName: String(project.name || '').trim(),
        protocolName: String(protocol.name || '').trim()
      }
    };
  }

  function getAgentChatContext() {
    const pageContext = getActiveNotebookPageAgentContext();
    if (pageContext) {
      return pageContext;
    }
    const dashboardProject = getActiveProjectDashboardId()
      ? findDashboardProject(getActiveProjectDashboardId())
      : findSelectedProject();
    return {
      scopeType: 'notebook',
      projectId: String(dashboardProject?.id || '').trim(),
      projectName: String(dashboardProject?.name || '').trim()
    };
  }

  function notifyActiveNotebookPageChanged() {
    if (typeof onActiveNotebookPageChanged === 'function') {
      onActiveNotebookPageChanged(getAgentChatContext());
    }
  }

  function getCurrentDraftSnapshot() {
    if (!notebookProtocolArea || notebookProtocolArea.hidden) {
      return '';
    }
    return serializeDraftSnapshot({
      editingEntryId: getEditingEntryId() || '',
      projectId: notebookProjectSelect?.value || '',
      protocolId: notebookProtocolSelect?.value || '',
      experimentName: notebookExperimentName?.value || '',
      protocolEditing: protocolEditor.isEditing(),
      protocolDraft: protocolEditor.getDraft(),
      protocolDraftName: notebookProtocolDraftName?.value || '',
      protocolDraftSteps: notebookProtocolDraftSteps?.value || '',
      values: collectNotebookValues(),
      result: notebookResult?.value || '',
      resultTables: resultTableController.getCurrentTables(),
      toolCalculations: toolSidebarController.getCalculations(),
      sampleLinks: getSampleLinkDrafts(),
      resultFiles: getSelectedNotebookResultFiles().map((file) => ({
        name: String(file?.name || ''),
        size: Number(file?.size) || 0,
        lastModified: Number(file?.lastModified) || 0
      }))
    });
  }

  function markDraftSaved() {
    setSavedDraftSnapshot(getCurrentDraftSnapshot());
  }

  return {
    collectNotebookValues,
    collectCarriedOverKeys,
    compactContextLine,
    compactContextBlock,
    getProtocolStepText,
    buildStepContextLines,
    buildSampleLinkContextLines,
    getActiveNotebookPageAgentContext,
    getAgentChatContext,
    notifyActiveNotebookPageChanged,
    getCurrentDraftSnapshot,
    markDraftSaved
  };
}

export { createNotebookAgentContext };
