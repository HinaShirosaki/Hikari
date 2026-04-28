import {
  buildClarifiedNotebookNote,
  clarifyNotebookNote,
  showTransientNotice
} from '../notebook-note-tools.js';
import { formatNotebookTimestamp, notebookPageLabel } from './utils.js';

// Recent notebook pages widget — surfaces the six most-recently-updated
// notebook entries so the bench user can append a quick result note (with
// optional LLM clarification) without leaving the home view.
export function initNotebookWidget({
  state,
  persist,
  safeText,
  render,
  elements
}) {
  const {
    pagesStatus,
    pageList,
    noteDialogOverlay,
    noteDialogForm,
    noteDialogPage,
    noteInput,
    noteClarifyBtn
  } = elements;

  let notebookNoteEntryId = '';

  pageList.addEventListener('click', onNotebookPageListClick);
  noteDialogOverlay.addEventListener('click', onNotebookNoteDialogOverlayClick);
  noteDialogForm.addEventListener('submit', onNotebookNoteDialogSubmit);
  noteClarifyBtn.addEventListener('click', onNotebookNoteClarifyAndSave);

  function openNotebookNoteDialog(entry, initialNote = '') {
    notebookNoteEntryId = String(entry?.id || '').trim();
    noteDialogPage.textContent = `${notebookPageLabel(entry)} | ${String(entry?.projectName || 'No project').trim() || 'No project'}`;
    noteDialogForm.reset();
    noteInput.value = String(initialNote || '').trim();
    noteDialogOverlay.hidden = false;
    window.requestAnimationFrame(() => {
      noteInput.focus();
    });
  }

  function closeNotebookNoteDialog() {
    notebookNoteEntryId = '';
    noteDialogForm.reset();
    noteDialogOverlay.hidden = true;
    noteDialogPage.textContent = '';
  }

  function onNotebookNoteDialogOverlayClick(event) {
    if (event.target !== noteDialogOverlay) {
      return;
    }
    closeNotebookNoteDialog();
  }

  function onNotebookPageListClick(event) {
    const button = event.target.closest('[data-dashboard-notebook-entry]');
    if (!button) {
      return;
    }
    const entryId = String(button.dataset.dashboardNotebookEntry || '').trim();
    const entry = (Array.isArray(state.notebookEntries) ? state.notebookEntries : [])
      .find((item) => String(item?.id || '').trim() === entryId);
    if (!entry) {
      return;
    }
    openNotebookNoteDialog(entry);
  }

  function onNotebookNoteDialogSubmit(event) {
    event.preventDefault();
    const note = String(noteInput.value || '').trim();
    if (!note) {
      return;
    }
    if (!appendNoteToNotebookEntry(notebookNoteEntryId, note)) {
      return;
    }
    closeNotebookNoteDialog();
    render();
  }

  function appendNoteToNotebookEntry(entryId, note) {
    const cleanEntryId = String(entryId || '').trim();
    const cleanNote = String(note || '').trim();
    if (!cleanEntryId || !cleanNote) {
      return false;
    }
    const index = (Array.isArray(state.notebookEntries) ? state.notebookEntries : [])
      .findIndex((item) => String(item?.id || '').trim() === cleanEntryId);
    if (index < 0) {
      return false;
    }
    const currentEntry = state.notebookEntries[index];
    const timestamp = new Date();
    const noteLine = `[${timestamp.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })}] ${note}`;
    const existingResult = String(currentEntry?.result || '').trim();
    state.notebookEntries[index] = {
      ...currentEntry,
      result: existingResult ? `${existingResult}\n\n${noteLine}` : noteLine,
      updatedAt: timestamp.toISOString()
    };
    persist();
    return true;
  }

  async function onNotebookNoteClarifyAndSave() {
    const entryId = String(notebookNoteEntryId || '').trim();
    const originalNote = String(noteInput.value || '').trim();
    if (!entryId || !originalNote) {
      showTransientNotice('Add a note before clarifying it.', { type: 'error' });
      return;
    }
    const entry = (Array.isArray(state.notebookEntries) ? state.notebookEntries : [])
      .find((item) => String(item?.id || '').trim() === entryId);
    closeNotebookNoteDialog();
    try {
      const clarifiedNote = await clarifyNotebookNote({
        llm: state.settings?.llm,
        text: originalNote
      });
      const noteToSave = buildClarifiedNotebookNote(originalNote, clarifiedNote);
      if (!appendNoteToNotebookEntry(entryId, noteToSave)) {
        throw new Error('Unable to save the clarified note.');
      }
      render();
      showTransientNotice('Clarified note saved.');
    } catch (error) {
      if (entry) {
        openNotebookNoteDialog(entry, originalNote);
      }
      showTransientNotice(String(error?.message || error || 'Failed to clarify the note.'), {
        type: 'error'
      });
    }
  }

  function collectRecentNotebookPages() {
    return (Array.isArray(state.notebookEntries) ? state.notebookEntries : [])
      .slice()
      .sort((left, right) => (
        new Date(String(right?.updatedAt || right?.createdAt || 0)).getTime()
        - new Date(String(left?.updatedAt || left?.createdAt || 0)).getTime()
      ))
      .slice(0, 6);
  }

  function renderRecentNotebookPages(entries) {
    pagesStatus.textContent = entries.length
      ? 'Tap a page to add a note.'
      : 'No notebook pages yet.';
    if (!entries.length) {
      pageList.innerHTML = '<p class="small-note">Save a notebook page to show it here.</p>';
      return;
    }
    pageList.innerHTML = entries.map((entry) => `
      <button
        type="button"
        class="dashboard-notebook-page-row"
        data-dashboard-notebook-entry="${safeText(entry.id)}"
      >
        <strong class="dashboard-notebook-page-title">${safeText(notebookPageLabel(entry))}</strong>
        <p class="dashboard-notebook-page-meta">${safeText(`${String(entry?.projectName || 'No project').trim() || 'No project'} | Updated ${formatNotebookTimestamp(entry?.updatedAt || entry?.createdAt)}`)}</p>
      </button>
    `).join('');
  }

  function renderWidget() {
    renderRecentNotebookPages(collectRecentNotebookPages());
  }

  function handleEscape() {
    if (noteDialogOverlay.hidden) {
      return false;
    }
    closeNotebookNoteDialog();
    return true;
  }

  return {
    render: renderWidget,
    handleEscape
  };
}
