import { cloneSelectionInsights } from './entry-helpers.js';

export function registerNotebookSelectionInsightsHost({
  controller,
  hostKey = 'biology-notebook-protocol',
  hostEl,
  isViewerHidden,
  getActiveEntry,
  resolveProject,
  resolveProtocol,
  getStoragePath,
  saveEntry,
  updateRecord
} = {}) {
  if (typeof controller?.registerHost !== 'function') {
    return;
  }
  controller.registerHost({
    key: hostKey,
    host: hostEl,
    getContext: () => {
      if (typeof isViewerHidden === 'function' && isViewerHidden()) {
        return null;
      }
      const entry = getActiveEntry();
      const project = entry ? resolveProject(entry) : resolveProject();
      const protocol = entry ? resolveProtocol(entry) : resolveProtocol();
      if (!project || !protocol) {
        return null;
      }
      const record = entry || {
        id: '',
        projectId: project.id,
        projectName: project.name,
        protocolId: protocol.id,
        protocolName: protocol.name,
        storageFolder: '',
        selectionInsights: []
      };
      return {
        kind: 'notebook',
        record,
        projectId: project.id,
        projectName: project.name,
        storagePath: typeof getStoragePath === 'function' ? String(getStoragePath() || '').trim() : '',
        insights: cloneSelectionInsights(record.selectionInsights),
        ensureRecord: async () => {
          const activeEntry = getActiveEntry();
          if (activeEntry) {
            return activeEntry;
          }
          return saveEntry();
        },
        updateRecord: (updater) => updateRecord(record.id, (currentEntry) => {
          const nextEntry = updater(currentEntry);
          return nextEntry && typeof nextEntry === 'object' ? nextEntry : currentEntry;
        })
      };
    }
  });
}
