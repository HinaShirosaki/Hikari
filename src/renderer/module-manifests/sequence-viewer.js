import { initSequenceViewer } from '../modules/sequence-viewer.js';

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
    showView,
    views,
    apiBridge,
    getApiBridge
  }) => ({
    homeViewId: views.SEQUENCE_VIEWER,
    detailViewId: SEQUENCE_VIEWER_DETAIL_VIEW_ID,
    onNavigateHome: () => {
      showView(views.SEQUENCE_VIEWER);
    },
    onNavigateDetail: () => {
      showView(SEQUENCE_VIEWER_DETAIL_VIEW_ID);
    },
    state,
    persist,
    createId,
    apiBridge,
    getApiBridge,
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
