export function createProjectService(registry) {
  function handleProjectsChanged() {
    registry.get('synthesisNotebook').renderProjectOptions?.();
    registry.get('synthesisNotebook').renderProtocolOptions?.();
    registry.get('synthesisNotebook').renderEntries?.();
    registry.get('biologyNotebook').renderProjectOptions?.();
    registry.get('biologyNotebook').renderProtocolOptions?.();
    registry.get('biologyNotebook').renderEntries?.();
    registry.get('workflowManagement').render?.();
    registry.get('assay').renderProjectOptions?.();
    registry.get('assay').renderNotebookOptions?.();
    registry.get('assay').renderList?.();
    registry.get('gel').renderProjectOptions?.();
    registry.get('gel').renderNotebookOptions?.();
    registry.get('gel').renderList?.();
    registry.get('papers').render?.();
    registry.get('agentChat').render?.();
  }

  return {
    handleProjectsChanged
  };
}
