export function createNotebookService(registry) {
  function handleNotebookEntriesChanged() {
    registry.get('workflowManagement').render?.();
    registry.get('assay').renderNotebookOptions?.();
    registry.get('assay').renderList?.();
  }

  function handleAgentNotebookEntriesChanged() {
    registry.get('biologyNotebook').renderEntries?.();
    handleNotebookEntriesChanged();
  }

  return {
    handleNotebookEntriesChanged,
    handleAgentNotebookEntriesChanged,
    logPageEvent: logNotebookPageEvent
  };
}
import { logNotebookPageEvent } from './notebook-page-log.js';
