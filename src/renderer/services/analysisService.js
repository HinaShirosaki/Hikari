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
    handleAssaysChanged,
    openAssayForNotebook
  };
}
