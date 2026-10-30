export function createAnalysisService(registry) {
  function handleAssaysChanged() {
    registry.get('biologyNotebook').renderLinkedPreviews?.();
    registry.get('workflowManagement').render?.();
    registry.get('agentChatRail').render?.();
  }

  function openAssayForNotebook(payload = {}) {
    const showView = registry.get('showView');
    const views = registry.get('VIEWS');
    if (typeof showView === 'function' && views?.ASSAY) {
      showView(views.ASSAY);
    }
    registry.get('assay').startLinkedAssay?.(payload);
  }

  return {
    // Queue before showing the view. Throws if no Gel frame is registered yet;
    // a frame still starting up pulls the queued page once its workspace is ready.
    openGelForNotebook: (payload) => {
      registry.get('pluginBridge').queueNotebookGel(payload);
      registry.get('showView')('plugin-gel-view');
    },
    handleAssaysChanged,
    openAssayForNotebook
  };
}
