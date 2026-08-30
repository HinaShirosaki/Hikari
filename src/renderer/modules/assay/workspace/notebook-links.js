// Keeps notebook pages pointing at the assays they reference, and stores the
// analysis preview a saved assay shows without re-running the analysis.
function createAssayNotebookLinks({
  state,
  persist,
  runtime,
  elements,
  renderList,
  renderResultsAssayOptions,
  clearActiveAssayInfo,
  onAssaysChanged,
  getAssayById,
  artifactStorage,
  notifyActiveAssayChanged
} = {}) {
  function arraysEqual(left, right) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => value === right[index]);
  }

  function syncNotebookAssayLinks() {
    if (!Array.isArray(state.notebookEntries)) {
      return;
    }

    const linkedIdsByEntry = new Map();
    (state.assays || []).forEach((assay) => {
      const entryId = String(assay?.notebookEntryId || '').trim();
      const assayId = String(assay?.id || '').trim();
      if (!entryId || !assayId) {
        return;
      }
      if (!linkedIdsByEntry.has(entryId)) {
        linkedIdsByEntry.set(entryId, []);
      }
      linkedIdsByEntry.get(entryId).push(assayId);
    });

    state.notebookEntries = state.notebookEntries.map((entry) => {
      const nextIds = linkedIdsByEntry.get(String(entry?.id || '').trim()) || [];
      const currentIds = Array.isArray(entry?.assayIds)
        ? entry.assayIds.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
      if (arraysEqual(currentIds, nextIds)) {
        return entry;
      }
      return {
        ...entry,
        assayIds: nextIds
      };
    });
  }

  function assayDefinitionChanged(existing, nextRecord) {
    if (!existing) {
      return false;
    }
    const fieldsToCompare = [
      'plateType',
      'sampleAxis',
      'projectId',
      'notebookEntryId'
    ];
    if (fieldsToCompare.some((field) => String(existing?.[field] || '') !== String(nextRecord?.[field] || ''))) {
      return true;
    }
    return JSON.stringify(existing?.sampleAxisValues || []) !== JSON.stringify(nextRecord?.sampleAxisValues || [])
      || JSON.stringify(existing?.concentrationAxisValues || []) !== JSON.stringify(nextRecord?.concentrationAxisValues || [])
      || JSON.stringify(existing?.manualWellOverrides || {}) !== JSON.stringify(nextRecord?.manualWellOverrides || {})
      || JSON.stringify(existing?.suppressedWells || []) !== JSON.stringify(nextRecord?.suppressedWells || [])
      || JSON.stringify(existing?.wellLayout || []) !== JSON.stringify(nextRecord?.wellLayout || [])
      || JSON.stringify(existing?.resultValues || {}) !== JSON.stringify(nextRecord?.resultValues || {});
  }

  function saveAssayAnalysisPreview(preview) {
    const assayId = runtime.activeResultsAssayId || elements.assayResultsAssaySelect?.value || '';
    if (!assayId) {
      return;
    }
    const assay = getAssayById(assayId);
    if (!assay) {
      return;
    }
    assay.latestAnalysis = preview && typeof preview === 'object'
      ? { ...preview }
      : null;
    assay.updatedAt = new Date().toISOString();
    syncNotebookAssayLinks();
    persist();
    renderResultsAssayOptions(assay.id);
    clearActiveAssayInfo();
    renderList();
    if (typeof onAssaysChanged === 'function') {
      onAssaysChanged();
    }
    void artifactStorage.persistAssayArtifacts(assay.id);
    notifyActiveAssayChanged();
  }

  return { arraysEqual, syncNotebookAssayLinks, assayDefinitionChanged, saveAssayAnalysisPreview };
}

export { createAssayNotebookLinks };
