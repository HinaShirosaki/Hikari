import { normalizeNotebookPdfSettings } from '../../lib/notebook-pdf-settings.js';

export function createNotebookPdfSettingsController({
  state,
  persist,
  pageSizeInput,
  stapleEdgeInput
} = {}) {
  function render() {
    const settings = normalizeNotebookPdfSettings(state?.settings?.notebookPdf);
    if (pageSizeInput) {
      pageSizeInput.value = settings.pageSize;
    }
    if (stapleEdgeInput) {
      stapleEdgeInput.value = settings.stapleEdge;
    }
  }

  function save(event) {
    event?.preventDefault?.();
    if (!state || typeof state !== 'object') {
      return;
    }
    state.settings = state.settings && typeof state.settings === 'object'
      ? state.settings
      : {};
    state.settings.notebookPdf = normalizeNotebookPdfSettings({
      pageSize: pageSizeInput?.value,
      stapleEdge: stapleEdgeInput?.value
    });
    persist?.();
  }

  return { render, save };
}
