export function createAnalysisService(registry) {
  function handleAssaysChanged() {
    registry.get('biologyNotebook').renderLinkedPreviews?.();
    registry.get('workflowManagement').render?.();
  }

  function handleGelAnalysesChanged() {
    registry.get('biologyNotebook').renderLinkedPreviews?.();
    registry.get('workflowManagement').render?.();
  }

  function openAssayForNotebook(payload = {}) {
    const showView = registry.get('showView');
    const views = registry.get('VIEWS');
    if (typeof showView === 'function' && views?.ASSAY) {
      showView(views.ASSAY);
    }
    registry.get('assay').startLinkedAssay?.(payload);
  }

  function openGelForNotebook(payload = {}) {
    const showView = registry.get('showView');
    const views = registry.get('VIEWS');
    if (typeof showView === 'function' && views?.GEL) {
      showView(views.GEL);
    }
    registry.get('gel').startLinkedGel?.(payload);
  }

  return {
    handleAssaysChanged,
    handleGelAnalysesChanged,
    openAssayForNotebook,
    openGelForNotebook
  };
}
