import { initSequenceViewer } from '../modules/sequence-viewer/index.js';

const SEQUENCE_VIEWER_DETAIL_VIEW_ID = 'sequence-viewer-detail-view';

function initSequenceViewerWithRoutes(options) {
  const module = initSequenceViewer(options);
  return {
    ...module,
    openDetailView: () => {
      options?.onNavigateDetail?.();
      return true;
    }
  };
}

export const sequenceViewerManifest = {
  key: 'sequenceViewer',
  historyStateKeys: ['protocols', 'projects', 'notebookEntries'],
  init: initSequenceViewerWithRoutes,
  viewKey: 'SEQUENCE_VIEWER',
  viewIds: [
    SEQUENCE_VIEWER_DETAIL_VIEW_ID
  ],
  navigationAliases: [
    {
      viewId: SEQUENCE_VIEWER_DETAIL_VIEW_ID,
      navigationViewKey: 'SEQUENCE_VIEWER'
    }
  ],
  createOptions: ({
    state,
    persist,
    createId,
    rendererServices,
    pluginServices,
    showView,
    views,
    apiBridge,
    getApiBridge,
    rootDocument
  }) => ({
    homeViewId: views.SEQUENCE_VIEWER,
    detailViewId: SEQUENCE_VIEWER_DETAIL_VIEW_ID,
    // Lets the file picker accept and convert formats a service plugin
    // provides (e.g. .dna via examples/plugins/dna-importer).
    pluginServices: pluginServices || null,
    onNavigateHome: () => {
      showView(views.SEQUENCE_VIEWER);
    },
    onNavigateDetail: () => {
      showView(SEQUENCE_VIEWER_DETAIL_VIEW_ID);
    },
    state,
    persist,
    createId,
    document: rootDocument,
    apiBridge,
    getApiBridge,
    ensureProjectRecord: rendererServices.project.ensureProjectRecord,
    saveProtocolRecord: rendererServices.protocol.saveProtocolRecord,
    getStoragePath: () => String(state.settings?.storagePath || '').trim(),
    onNotebookEntriesChanged: () => {
      rendererServices.project.handleProjectsChanged();
      rendererServices.protocol.handleProtocolsChanged();
      rendererServices.notebook.handleNotebookEntriesChanged();
    }
  }),
  render: ({ modules }, { viewId } = {}) => {
    modules.sequenceViewer?.render?.({ activeViewId: viewId });
  }
};
