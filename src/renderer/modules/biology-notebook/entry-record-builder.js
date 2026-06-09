import {
  cloneProtocolSnapshot,
  cloneSelectionInsights,
  resolveEntryExecutedAt,
  resolveEntryNotebookState,
  shouldSyncExperimentNameWithProtocol
} from './entry-helpers.js';
import { cloneNotebookToolCalculations } from './tool-calculations.js';

export function buildSaveableNotebookEntry({
  editingEntry,
  project,
  protocol,
  baseProtocol,
  notebookType,
  entryId,
  values,
  resultText,
  resultTables,
  toolCalculations,
  sampleLinks,
  resultFiles,
  resultFileRecords,
  storageFolder,
  currentExperimentName,
  nowIso
} = {}) {
  const baseProtocolName = String(baseProtocol?.name || '').trim();
  const experimentName = shouldSyncExperimentNameWithProtocol(currentExperimentName, baseProtocolName)
    ? protocol.name
    : (String(currentExperimentName || '').trim() || protocol.name);
  const tables = Array.isArray(resultTables) ? resultTables : [];

  return {
    id: entryId,
    notebookType,
    projectId: project.id,
    projectName: project.name,
    protocolId: String(protocol.id || editingEntry?.protocolId || '').trim(),
    protocolName: protocol.name,
    experimentName,
    protocolSnapshot: cloneProtocolSnapshot(protocol) || cloneProtocolSnapshot(editingEntry?.protocolSnapshot),
    values,
    result: resultText,
    resultTable: tables[0] || null,
    resultTables: tables,
    toolCalculations: cloneNotebookToolCalculations(toolCalculations),
    sampleLinks,
    resultFiles,
    resultFileRecords,
    storageFolder,
    updatedAt: nowIso,
    createdAt: String(editingEntry?.createdAt || '').trim() || nowIso,
    notebookState: resolveEntryNotebookState(editingEntry),
    executedAt: resolveEntryExecutedAt(editingEntry, nowIso),
    agentDraftStatus: String(editingEntry?.agentDraftStatus || '').trim(),
    agentDraftMeta: editingEntry?.agentDraftMeta && typeof editingEntry.agentDraftMeta === 'object'
      ? { ...editingEntry.agentDraftMeta }
      : {},
    selectionInsights: cloneSelectionInsights(editingEntry?.selectionInsights)
  };
}

export function mergeImportedResultFiles({
  existingResultFiles = [],
  existingResultFileRecords = [],
  importedResultFileRecords = [],
  selectedResultFiles = []
} = {}) {
  const resultFileRecords = existingResultFileRecords.concat(importedResultFileRecords);
  const recordNames = resultFileRecords.map((record) => String(record?.name || '').trim()).filter(Boolean);
  const fallbackSelectedNames = selectedResultFiles.map((file) => file.name);
  const resultFiles = Array.from(new Set(
    existingResultFiles.concat(recordNames, recordNames.length ? [] : fallbackSelectedNames)
  ));
  return { resultFiles, resultFileRecords };
}
