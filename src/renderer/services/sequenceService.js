export function createSequenceService(registry) {
  function openFromToolBox(payload) {
    const sequenceViewer = registry.get('sequenceViewer');
    if (typeof sequenceViewer.loadFromExternal !== 'function') {
      return;
    }
    sequenceViewer.loadFromExternal(payload);
    sequenceViewer.openDetailView?.();
  }

  return {
    openFromToolBox
  };
}
