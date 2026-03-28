export function createNotebookService(registry) {
  function handleNotebookEntriesChanged() {
    registry.get('projectManagement').renderNotebookPages?.();
    registry.get('workflowManagement').render?.();
    registry.get('assay').renderNotebookOptions?.();
    registry.get('assay').renderList?.();
    registry.get('gel').renderNotebookOptions?.();
    registry.get('gel').renderList?.();
  }

  function handleAgentNotebookEntriesChanged() {
    registry.get('synthesisNotebook').renderEntries?.();
    registry.get('biologyNotebook').renderEntries?.();
    handleNotebookEntriesChanged();
  }

  return {
    handleNotebookEntriesChanged,
    handleAgentNotebookEntriesChanged
  };
}
