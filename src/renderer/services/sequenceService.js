export function createSequenceService(registry) {
  function openFromToolBox(payload) {
    const sequenceViewer = registry.get('sequenceViewer');
    if (typeof sequenceViewer.loadFromExternal !== 'function') {
      return;
    }
    sequenceViewer.loadFromExternal(payload);

    const showView = registry.get('showView');
    const detailViewId = registry.get('sequenceViewerDetailViewId');
    if (typeof showView === 'function' && typeof detailViewId === 'string' && detailViewId) {
      showView(detailViewId);
    }
  }

  return {
    openFromToolBox
  };
}
