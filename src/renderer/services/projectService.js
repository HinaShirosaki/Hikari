export function createProjectService(registry) {
  function handleProjectsChanged() {
    registry.get('biologyNotebook').renderProjectOptions?.();
    registry.get('biologyNotebook').renderProtocolOptions?.();
    registry.get('biologyNotebook').renderEntries?.();
    registry.get('workflowManagement').render?.();
    registry.get('assay').renderProjectOptions?.();
    registry.get('assay').renderNotebookOptions?.();
    registry.get('assay').renderList?.();
    registry.get('papers').render?.();
    registry.get('agentChat').render?.();
  }

  return {
    handleProjectsChanged
  };
}
