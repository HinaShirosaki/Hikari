import {
  buildClarifiedNotebookNote,
  clarifyNotebookNote
} from '../../services/notebook-note-tools.js';
import { showTransientNotice } from '../../lib/notify.js';
import { notebookPageLabel } from './utils.js';

// Recent notebook pages widget — surfaces the six most-recently-updated
// notebook entries so the bench user can append a quick result note (with
// optional LLM clarification) without leaving the home view. The note editor
// opens inline under the chosen page.
export function initNotebookWidget({
  state,
  persist,
  safeText,
  render,
  elements
}) {
  const { pagesStatus, pageList } = elements;

  let editingEntryId = '';
  let noteDraft = '';
  let lastMarkup = null;

  pageList.addEventListener('click', onPageListClick);
  pageList.addEventListener('input', onPageListInput);
  pageList.addEventListener('submit', onPageListSubmit);

  function findEntry(entryId) {
    return (Array.isArray(state.notebookEntries) ? state.notebookEntries : [])
      .find((item) => String(item?.id || '').trim() === entryId) || null;
  }

  function noteInput() {
    return pageList.querySelector('[data-dashboard-notebook-note-input]');
  }

  function openNoteEditor(entryId, initialNote = '') {
    editingEntryId = entryId;
    noteDraft = String(initialNote || '');
    renderWidget();
    window.requestAnimationFrame(() => {
      noteInput()?.focus();
    });
  }

  function closeNoteEditor() {
    const entryId = editingEntryId;
    editingEntryId = '';
    noteDraft = '';
    renderWidget();
    // Keyboard users land back on the page they were annotating.
    [...pageList.querySelectorAll('[data-dashboard-notebook-entry]')]
      .find((row) => row.dataset.dashboardNotebookEntry === entryId)
      ?.focus();
  }

  function onPageListClick(event) {
    if (event.target.closest('[data-dashboard-notebook-note-cancel]')) {
      closeNoteEditor();
      return;
    }
    if (event.target.closest('[data-dashboard-notebook-note-clarify]')) {
      void onClarifyAndSave();
      return;
    }
    const button = event.target.closest('[data-dashboard-notebook-entry]');
    if (!button) {
      return;
    }
    const entryId = String(button.dataset.dashboardNotebookEntry || '').trim();
    if (!findEntry(entryId)) {
      return;
    }
    if (entryId === editingEntryId) {
      closeNoteEditor();
      return;
    }
    openNoteEditor(entryId);
  }

  function onPageListInput(event) {
    const input = event.target?.closest?.('[data-dashboard-notebook-note-input]');
    if (input) {
      noteDraft = input.value;
    }
  }

  function onPageListSubmit(event) {
    if (!event.target?.closest?.('[data-dashboard-notebook-note-form]')) {
      return;
    }
    event.preventDefault();
    const note = noteDraft.trim();
    if (!note || !appendNoteToNotebookEntry(editingEntryId, note)) {
      return;
    }
    editingEntryId = '';
    noteDraft = '';
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

  async function onClarifyAndSave() {
    const entryId = editingEntryId;
    const originalNote = noteDraft.trim();
    if (!entryId || !originalNote) {
      showTransientNotice('Add a note before clarifying it.', { type: 'error' });
      return;
    }
    editingEntryId = '';
    noteDraft = '';
    renderWidget();
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
      if (findEntry(entryId)) {
        openNoteEditor(entryId, originalNote);
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

  function relativeShort(timestamp) {
    const date = new Date(String(timestamp || ''));
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) {
      return 'now';
    }
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function renderNoteEditor(label) {
    return `
      <form class="home-notebook-note-editor" data-dashboard-notebook-note-form>
        <textarea
          class="home-notebook-note-input"
          data-dashboard-notebook-note-input
          rows="3"
          maxlength="4000"
          required
          aria-label="Note for ${label}"
          placeholder="Add a quick note to this page…"
        ></textarea>
        <div class="home-notebook-note-actions">
          <button type="button" class="ghost-btn home-notebook-note-cancel" data-dashboard-notebook-note-cancel>Cancel</button>
          <button type="button" class="ghost-btn hikari-agent-action" data-dashboard-notebook-note-clarify>Clarify and save</button>
          <button type="submit" class="primary-btn">Save note</button>
        </div>
      </form>`;
  }

  function renderPageRow(entry, project) {
    const entryId = String(entry?.id || '').trim();
    const label = safeText(notebookPageLabel(entry));
    const editing = entryId === editingEntryId;
    return `
      <button
        type="button"
        class="home-row home-notebook-row${editing ? ' is-editing' : ''}"
        data-dashboard-notebook-entry="${safeText(entryId)}"
        aria-expanded="${editing}"
        aria-label="Add a note to ${label} in ${safeText(project)}"
      >
        <span class="home-row-name">${label}</span>
        <span class="home-row-meta">${safeText(relativeShort(entry?.updatedAt || entry?.createdAt))}</span>
        <span class="home-notebook-add" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        </span>
      </button>${editing ? renderNoteEditor(label) : ''}`;
  }

  function renderPagesMarkup(entries) {
    if (!entries.length) {
      return '<p class="home-empty-note">No notebook pages yet. Pages you work on show up here, ready for a quick note.</p>';
    }
    const groups = new Map();
    entries.forEach((entry) => {
      const project = String(entry?.projectName || 'No project').trim() || 'No project';
      const key = String(entry?.projectId || project);
      if (!groups.has(key)) {
        groups.set(key, { project, pages: [] });
      }
      groups.get(key).pages.push(entry);
    });
    return [...groups.values()].map(({ project, pages }) => `
      <section class="home-notebook-project" aria-label="${safeText(project)}">
        <div class="home-notebook-project-head">
          <h3>${safeText(project)}</h3>
          <span>${pages.length} ${pages.length === 1 ? 'page' : 'pages'}</span>
        </div>
        ${pages.map((entry) => renderPageRow(entry, project)).join('')}
      </section>
    `).join('');
  }

  // The list re-renders on every dashboard render; an open editor keeps its
  // text, and its focus when it had it.
  function renderRecentNotebookPages(entries) {
    pagesStatus.textContent = entries.length
      ? 'Select a page to add a note.'
      : 'No notebook pages yet.';
    if (editingEntryId && !entries.some((entry) => String(entry?.id || '').trim() === editingEntryId)) {
      editingEntryId = '';
      noteDraft = '';
    }
    const markup = renderPagesMarkup(entries);
    if (markup === lastMarkup) {
      return;
    }
    const input = noteInput();
    const hadFocus = Boolean(input) && input === pageList.ownerDocument?.activeElement;
    pageList.innerHTML = markup;
    lastMarkup = markup;
    const nextInput = noteInput();
    if (nextInput) {
      nextInput.value = noteDraft;
      if (hadFocus) {
        nextInput.focus();
      }
    }
  }

  function renderWidget() {
    renderRecentNotebookPages(collectRecentNotebookPages());
  }

  function handleEscape() {
    if (!editingEntryId) {
      return false;
    }
    closeNoteEditor();
    return true;
  }

  return {
    render: renderWidget,
    handleEscape
  };
}
