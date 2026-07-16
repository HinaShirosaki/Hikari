export function createNotebookService(registry) {
  function handleNotebookEntriesChanged() {
    registry.get('workflowManagement').render?.();
    registry.get('assay').renderNotebookOptions?.();
    registry.get('assay').renderList?.();
    registry.get('gel').renderNotebookOptions?.();
    registry.get('gel').renderList?.();
  }

  function handleAgentNotebookEntriesChanged() {
    registry.get('biologyNotebook').renderEntries?.();
    handleNotebookEntriesChanged();
  }

  return {
    handleNotebookEntriesChanged,
    handleAgentNotebookEntriesChanged
  };
}
