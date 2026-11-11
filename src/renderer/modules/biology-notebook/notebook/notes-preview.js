import { renderMarkdown } from '../../../lib/markdown.js';
import { setNotebookText } from '../localization.js';

export function createNotebookNotesPreview(elements, safeText) {
  const { notebookResult: notes, notebookNotesComposer: composer,
    notebookNotesPreview: preview, notebookNotesMode: mode } = elements;
  if (!notes || !composer || !preview || !mode) return { refresh() {}, showEditor() {} };

  let editing = false;
  function refresh({ reset = false } = {}) {
    if (reset) editing = false;
    if (editing) return;
    let hasTable = false;
    const html = notes.value.includes('|')
      ? renderMarkdown(notes.value, safeText, { onTable: () => { hasTable = true; } })
      : '';
    preview.innerHTML = hasTable ? html : '';
    preview.hidden = !hasTable;
    composer.hidden = hasTable;
    mode.hidden = !hasTable;
    setNotebookText(mode, 'action.editNotesMarkdown');
  }

  function showEditor() {
    if (preview.hidden) return;
    editing = true;
    preview.hidden = true;
    composer.hidden = false;
    setNotebookText(mode, 'action.previewNotesMarkdown');
  }

  mode.addEventListener('click', () => {
    if (editing) {
      refresh({ reset: true });
      if (mode.hidden) notes.focus();
    } else {
      showEditor();
      notes.focus();
    }
  });
  return { refresh, showEditor };
}
