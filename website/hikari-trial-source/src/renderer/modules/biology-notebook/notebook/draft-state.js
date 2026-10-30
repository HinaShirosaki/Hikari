// The mutable drafting state of the open notebook page: which entry is being
// edited, its unsaved snapshot, and the page-name generation bookkeeping.
// Every part module reads and writes it through these accessors.
function createNotebookDraftState() {
  let editingEntryId = null;
  let activeProjectDashboardId = '';
  let linkedPreviewRenderToken = 0;
  let sampleLinkDrafts = new Map();
  let pendingDroppedResultFiles = [];
  let agentAppendQueue = Promise.resolve();
  let savedDraftSnapshot = '';
  let experimentNameSourceDraft = 'protocol';
  let experimentNameGeneratedAtDraft = '';
  let experimentNameGeneratedModelDraft = '';
  let pageNameGenerationRevision = 0;
  let pageNameGenerationPendingRevision = -1;
  let pageNameGenerationPromise = null;
  let notebookTitleRenameStartValue = '';

  return {
    getEditingEntryId: () => editingEntryId,
    setEditingEntryId: (next) => { editingEntryId = next; },
    getActiveProjectDashboardId: () => activeProjectDashboardId,
    setActiveProjectDashboardId: (next) => { activeProjectDashboardId = next; },
    getLinkedPreviewRenderToken: () => linkedPreviewRenderToken,
    setLinkedPreviewRenderToken: (next) => { linkedPreviewRenderToken = next; },
    getSampleLinkDrafts: () => sampleLinkDrafts,
    setSampleLinkDrafts: (next) => { sampleLinkDrafts = next; },
    getPendingDroppedResultFiles: () => pendingDroppedResultFiles,
    setPendingDroppedResultFiles: (next) => { pendingDroppedResultFiles = next; },
    getAgentAppendQueue: () => agentAppendQueue,
    setAgentAppendQueue: (next) => { agentAppendQueue = next; },
    getSavedDraftSnapshot: () => savedDraftSnapshot,
    setSavedDraftSnapshot: (next) => { savedDraftSnapshot = next; },
    getExperimentNameSourceDraft: () => experimentNameSourceDraft,
    setExperimentNameSourceDraft: (next) => { experimentNameSourceDraft = next; },
    getExperimentNameGeneratedAtDraft: () => experimentNameGeneratedAtDraft,
    setExperimentNameGeneratedAtDraft: (next) => { experimentNameGeneratedAtDraft = next; },
    getExperimentNameGeneratedModelDraft: () => experimentNameGeneratedModelDraft,
    setExperimentNameGeneratedModelDraft: (next) => { experimentNameGeneratedModelDraft = next; },
    getPageNameGenerationRevision: () => pageNameGenerationRevision,
    setPageNameGenerationRevision: (next) => { pageNameGenerationRevision = next; },
    getPageNameGenerationPendingRevision: () => pageNameGenerationPendingRevision,
    setPageNameGenerationPendingRevision: (next) => { pageNameGenerationPendingRevision = next; },
    getPageNameGenerationPromise: () => pageNameGenerationPromise,
    setPageNameGenerationPromise: (next) => { pageNameGenerationPromise = next; },
    getNotebookTitleRenameStartValue: () => notebookTitleRenameStartValue,
    setNotebookTitleRenameStartValue: (next) => { notebookTitleRenameStartValue = next; }
  };
}

export { createNotebookDraftState };
