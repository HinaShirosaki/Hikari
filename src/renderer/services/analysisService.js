export function createAnalysisService(registry) {
  function handleAssaysChanged() {
    registry.get('projectManagement').renderNotebookPages?.();
  }

  function handleGelAnalysesChanged() {
    registry.get('projectManagement').renderNotebookPages?.();
  }

  return {
    handleAssaysChanged,
    handleGelAnalysesChanged
  };
}
