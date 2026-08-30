import { buildCloningReactionSteps } from './cloning-reaction-steps.js';
import { isExecutedNotebookEntry, syncCloningReactionStepPages } from './cloning-step-pages.js';
import { appendGeneratedPcrReaction, buildPcrFixedReactionCalculation } from './pcr-reaction-setup.js';
import { cleanText } from './shared.js';
import { asArray } from '../../lib/normalize.js';
import { buildBackboneName, buildProteinBuilderCloningPlan } from './protein-builder-cloning/cloning-plan.js';
import { CLONING_NOTEBOOK_SOURCE, CLONING_REACTION_CALCULATION_ID } from './protein-builder-cloning/constants.js';
import { createStableId } from './protein-builder-cloning/formatting.js';
import { cloneProtocolSnapshot, ensureProteinBuilderProject, ensureProteinBuilderProtocol } from './protein-builder-cloning/notebook-protocol.js';
import { buildProteinBuilderPcrProgram, buildProteinBuilderPrimerResultTable, formatProteinBuilderCloningNotebookResult } from './protein-builder-cloning/result-text.js';

export function createProteinBuilderCloningNotebookPage({
  state,
  persist,
  createId,
  onNotebookEntriesChanged,
  entryId: requestedEntryId = '',
  constructName = '',
  backbone = {},
  dnaConstruct = {},
  assembledRecord = {},
  plan = null
} = {}) {
  if (!state || typeof state !== 'object') {
    return null;
  }

  const cloningPlan = plan || buildProteinBuilderCloningPlan({
    backbone,
    dnaConstruct,
    assembledRecord,
    constructName
  });
  if (!cloningPlan) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const project = ensureProteinBuilderProject(state, createId, nowIso);
  const pcrProgram = buildProteinBuilderPcrProgram(cloningPlan);
  const protocol = ensureProteinBuilderProtocol(state, pcrProgram, nowIso);
  const backboneName = buildBackboneName(backbone);
  const safeConstructName = cleanText(constructName, 160)
    || cleanText(assembledRecord?.name, 160)
    || 'Protein Builder Insert';
  const result = formatProteinBuilderCloningNotebookResult({
    constructName: safeConstructName,
    backboneName,
    assembledRecord,
    plan: cloningPlan,
    pcrProgram
  });
  const resultTable = buildProteinBuilderPrimerResultTable(cloningPlan);
  state.notebookEntries = asArray(state.notebookEntries);
  const requestedId = cleanText(requestedEntryId, 160);
  const requestedEntry = requestedId
    ? state.notebookEntries.find((candidate) => cleanText(candidate?.id, 160) === requestedId) || null
    : null;
  const existingEntry = isExecutedNotebookEntry(requestedEntry) ? null : requestedEntry;
  const entryId = cleanText(existingEntry?.id, 160) || createStableId(createId, 'protein_builder_cloning_entry');
  const existingEntryIndex = existingEntry ? state.notebookEntries.indexOf(existingEntry) : -1;
  const entry = {
    id: entryId,
    notebookType: 'biology',
    projectId: project.id,
    projectName: project.name,
    protocolId: protocol.id,
    protocolName: protocol.name,
    experimentName: `${safeConstructName} cloning primer design`,
    protocolSnapshot: cloneProtocolSnapshot(protocol),
    values: {},
    result,
    resultTable,
    resultTables: resultTable ? [resultTable] : [],
    toolCalculations: appendGeneratedPcrReaction(
      existingEntry?.toolCalculations,
      buildPcrFixedReactionCalculation(pcrProgram, nowIso, { id: CLONING_REACTION_CALCULATION_ID })
    ),
    resultFiles: [],
    resultFileRecords: [],
    storageFolder: '',
    updatedAt: nowIso,
    createdAt: cleanText(existingEntry?.createdAt, 120) || nowIso,
    notebookState: cleanText(existingEntry?.notebookState, 80) || 'planned',
    executedAt: cleanText(existingEntry?.executedAt, 120),
    agentDraftStatus: '',
    agentDraftMeta: {},
    selectionInsights: [],
    proteinBuilderCloningDesign: {
      source: CLONING_NOTEBOOK_SOURCE,
      constructName: safeConstructName,
      backboneName,
      assembledRecordName: cleanText(assembledRecord?.name, 160),
      assembledLength: Math.max(0, Number(assembledRecord?.sequence?.length) || 0),
      insertLength: Math.max(0, Number(dnaConstruct?.length || dnaConstruct?.sequence?.length) || 0),
      recommendedAssemblyStrategy: cloningPlan.recommendedAssemblyStrategy,
      primerCount: Math.max(0, Number(cloningPlan?.primerOligoPlan?.primerCount) || asArray(cloningPlan?.primerOligoPlan?.primers).length),
      pcrProgram
    }
  };

  if (existingEntryIndex >= 0) {
    state.notebookEntries[existingEntryIndex] = {
      ...existingEntry,
      ...entry
    };
  } else {
    state.notebookEntries.push(entry);
  }
  // The assembly this route ends in — Gibson, or a digest and a ligation — is
  // its own bench session, so it gets its own page and reaction table.
  const stepEntries = syncCloningReactionStepPages({
    state,
    createId,
    nowIso,
    project,
    source: CLONING_NOTEBOOK_SOURCE,
    pageKey: entryId,
    subjectName: safeConstructName,
    strategy: cloningPlan.recommendedAssemblyStrategy,
    steps: buildCloningReactionSteps({
      strategy: cloningPlan.recommendedAssemblyStrategy,
      displayPlan: { plans: [{ plan: cloningPlan }] },
      pcrPrograms: [pcrProgram]
    })
  });
  if (typeof persist === 'function') {
    persist();
  }
  if (typeof onNotebookEntriesChanged === 'function') {
    onNotebookEntriesChanged();
  }

  return {
    entry,
    project,
    protocol,
    stepEntries,
    plan: cloningPlan,
    pcrProgram
  };
}

export {
  buildProteinBuilderCloningPlan
} from './protein-builder-cloning/cloning-plan.js';
export {
  buildProteinBuilderPcrProgram,
  buildProteinBuilderPrimerResultTable,
  formatProteinBuilderCloningNotebookResult
} from './protein-builder-cloning/result-text.js';
export {
  buildProteinBuilderCloningProtocolSteps,
  buildProteinBuilderCloningProtocol,
  resolveProteinBuilderCloningNotebookProtocol,
  migrateProteinBuilderCloningNotebookState
} from './protein-builder-cloning/notebook-protocol.js';
