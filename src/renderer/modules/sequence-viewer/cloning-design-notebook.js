import { buildCloningReactionSteps } from './cloning-reaction-steps.js';
import { isExecutedNotebookEntry, syncCloningReactionStepPages } from './cloning-step-pages.js';
import { appendGeneratedPcrReaction, buildPcrFixedReactionCalculation } from './pcr-reaction-setup.js';
import { cleanText } from './shared.js';
import { asArray } from '../../lib/normalize.js';
import { CLONING_NOTEBOOK_SOURCE, CLONING_REACTION_CALCULATION_ID } from './cloning-design-notebook/constants.js';
import { cloneProtocolSnapshot, ensureProject, ensureProtocol } from './cloning-design-notebook/notebook-protocol.js';
import { buildNotebookSourceKey, buildSequenceViewerPcrPrograms, createStableId } from './cloning-design-notebook/pcr-programs.js';
import { buildPrimerResultTable, formatNotebookResult } from './cloning-design-notebook/result-text.js';

export function createSequenceViewerCloningDesignNotebookPage({
  state,
  persist,
  createId,
  onNotebookEntriesChanged,
  entryId: requestedEntryId = '',
  source = {},
  record = {},
  displayPlan = {}
} = {}) {
  if (!state || typeof state !== 'object' || !displayPlan?.feasible || !asArray(displayPlan?.primers).length) {
    return null;
  }
  const nowIso = new Date().toISOString();
  const sourceKey = buildNotebookSourceKey(source, record);
  const project = ensureProject(state, createId, nowIso);
  const pcrPrograms = buildSequenceViewerPcrPrograms({ displayPlan, source, record });
  if (!pcrPrograms.length) {
    return null;
  }
  const protocol = ensureProtocol(state, pcrPrograms, nowIso);
  state.notebookEntries = asArray(state.notebookEntries);
  const matchingEntry = state.notebookEntries.find((candidate) => (
    cleanText(candidate?.sequenceViewerCloningDesign?.source, 80) === CLONING_NOTEBOOK_SOURCE
    && cleanText(candidate?.sequenceViewerCloningDesign?.sourceKey, 80) === sourceKey
    && !isExecutedNotebookEntry(candidate)
  ));
  const requestedId = cleanText(requestedEntryId, 160);
  const requestedEntry = requestedId
    ? state.notebookEntries.find((candidate) => cleanText(candidate?.id, 160) === requestedId) || null
    : null;
  const existingEntry = (isExecutedNotebookEntry(requestedEntry) ? null : requestedEntry) || matchingEntry || null;
  const entryId = cleanText(existingEntry?.id, 160)
    || createStableId(createId, 'sequence_viewer_cloning_entry');
  const existingIndex = existingEntry ? state.notebookEntries.indexOf(existingEntry) : -1;
  const recordName = cleanText(source?.recordName || record?.name, 160) || 'Edited sequence';
  const resultTable = buildPrimerResultTable(displayPlan?.primers);
  const entry = {
    id: entryId,
    notebookType: 'biology',
    projectId: project.id,
    projectName: project.name,
    protocolId: protocol.id,
    protocolName: protocol.name,
    experimentName: `${recordName} cloning primer design`,
    protocolSnapshot: cloneProtocolSnapshot(protocol),
    values: {},
    result: formatNotebookResult({ source, record, displayPlan, pcrPrograms }),
    resultTable,
    resultTables: resultTable ? [resultTable] : [],
    // The thermocycle program says how to run the PCR; the reaction table says
    // what to put in the tube. Every route on this page starts with a PCR, so
    // the page carries both.
    toolCalculations: appendGeneratedPcrReaction(
      existingEntry?.toolCalculations,
      buildPcrFixedReactionCalculation(pcrPrograms[0], nowIso, {
        id: CLONING_REACTION_CALCULATION_ID,
        reactionLabels: pcrPrograms.map((program) => program?.label)
      })
    ),
    resultFiles: asArray(existingEntry?.resultFiles),
    resultFileRecords: asArray(existingEntry?.resultFileRecords),
    storageFolder: cleanText(existingEntry?.storageFolder, 600),
    updatedAt: nowIso,
    createdAt: cleanText(existingEntry?.createdAt, 120) || nowIso,
    notebookState: cleanText(existingEntry?.notebookState, 80) || 'planned',
    executedAt: cleanText(existingEntry?.executedAt, 120),
    agentDraftStatus: '',
    agentDraftMeta: {},
    selectionInsights: asArray(existingEntry?.selectionInsights),
    sequenceViewerCloningDesign: {
      source: CLONING_NOTEBOOK_SOURCE,
      sourceKey,
      recordName,
      strategy: cleanText(displayPlan?.strategy, 80),
      editType: cleanText(source?.editRequest?.type, 80),
      editStart: Math.max(0, Number(source?.editRequest?.start) || 0),
      editEnd: Math.max(0, Number(source?.editRequest?.end) || 0),
      templateLength: Math.max(0, Number(displayPlan?.summary?.templateLength) || 0),
      resultLength: Math.max(0, Number(displayPlan?.summary?.resultLength) || 0),
      primerCount: asArray(displayPlan?.primers).length,
      pcrPrograms
    }
  };
  if (existingIndex >= 0) {
    state.notebookEntries[existingIndex] = { ...existingEntry, ...entry };
  } else {
    state.notebookEntries.push(entry);
  }
  const strategy = cleanText(displayPlan?.strategy, 80);
  const stepEntries = syncCloningReactionStepPages({
    state,
    createId,
    nowIso,
    project,
    source: CLONING_NOTEBOOK_SOURCE,
    pageKey: sourceKey,
    subjectName: recordName,
    strategy,
    steps: buildCloningReactionSteps({ strategy, displayPlan, pcrPrograms })
  });
  if (typeof persist === 'function') {
    persist();
  }
  if (typeof onNotebookEntriesChanged === 'function') {
    onNotebookEntriesChanged();
  }
  return { entry, project, protocol, pcrPrograms, stepEntries };
}

export { buildSequenceViewerPcrPrograms } from './cloning-design-notebook/pcr-programs.js';
