import { escapeHtml } from './html.js';
import { normalizePreferredJournalList } from '../../lib/preferred-journals.js';

// The preferred-journal list in Settings: render, add, edit in place, delete.
function createPreferredJournalSettings({
  state,
  persist,
  settingPreferredJournal,
  preferredJournalList
} = {}) {
  function renderPreferredJournal() {
    if (!settingPreferredJournal) {
      return;
    }
    settingPreferredJournal.value = '';
    if (!preferredJournalList) {
      return;
    }
    const journals = getPreferredJournalSettings();
    preferredJournalList.innerHTML = journals.length
      ? journals.map((journal, index) => `
          <div class="settings-edit-row settings-preferred-journal-row" data-preferred-journal-row="${index}">
            <input value="${escapeHtml(journal)}" data-preferred-journal-input="${index}" aria-label="Preferred journal ${index + 1}" />
            <button type="button" class="ghost-btn settings-inline-icon" data-preferred-journal-save="${index}" aria-label="Save ${escapeHtml(journal)}" title="Save journal"><svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg></button>
            <button type="button" class="danger-btn settings-inline-icon settings-inline-icon-danger" data-preferred-journal-delete="${index}" aria-label="Delete ${escapeHtml(journal)}" title="Delete journal"><svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </div>
        `).join('')
      : '<p class="small-note">No preferred journals configured.</p>';
  }

  function onSavePreferredJournal(event) {
    event.preventDefault();
    const nextJournal = String(settingPreferredJournal?.value || '').trim();
    if (!nextJournal) {
      return;
    }
    setPreferredJournalSettings([...getPreferredJournalSettings(), nextJournal]);
    persist();
    renderPreferredJournal();
  }

  function onClearPreferredJournal() {
    setPreferredJournalSettings([]);
    persist();
    renderPreferredJournal();
  }

  function onPreferredJournalListClick(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') {
      return;
    }
    const saveButton = target.closest('[data-preferred-journal-save]');
    if (saveButton) {
      const index = Number(saveButton.dataset.preferredJournalSave);
      const input = preferredJournalList?.querySelector(`[data-preferred-journal-input="${index}"]`);
      savePreferredJournalAt(index, input?.value || '');
      return;
    }
    const deleteButton = target.closest('[data-preferred-journal-delete]');
    if (deleteButton) {
      deletePreferredJournalAt(Number(deleteButton.dataset.preferredJournalDelete));
    }
  }

  function onPreferredJournalListKeydown(event) {
    if (event.key !== 'Enter') {
      return;
    }
    const input = event.target?.closest?.('[data-preferred-journal-input]');
    if (!input) {
      return;
    }
    event.preventDefault();
    savePreferredJournalAt(Number(input.dataset.preferredJournalInput), input.value);
  }

  function savePreferredJournalAt(index, value) {
    const journals = getPreferredJournalSettings();
    if (!Number.isInteger(index) || index < 0 || index >= journals.length) {
      return;
    }
    journals[index] = String(value || '').trim();
    setPreferredJournalSettings(journals);
    persist();
    renderPreferredJournal();
  }

  function deletePreferredJournalAt(index) {
    const journals = getPreferredJournalSettings();
    if (!Number.isInteger(index) || index < 0 || index >= journals.length) {
      return;
    }
    journals.splice(index, 1);
    setPreferredJournalSettings(journals);
    persist();
    renderPreferredJournal();
  }

  function getPreferredJournalSettings() {
    const list = Array.isArray(state.settings?.preferredJournals)
      ? state.settings.preferredJournals
      : [];
    const snakeList = Array.isArray(state.settings?.preferred_journals)
      ? state.settings.preferred_journals
      : [];
    const legacy = String(state.settings?.preferredJournal || '').trim();
    const snakeLegacy = String(state.settings?.preferred_journal || '').trim();
    return normalizePreferredJournalList([list, snakeList, legacy, snakeLegacy]);
  }

  function setPreferredJournalSettings(journals) {
    const normalized = normalizePreferredJournalList(journals);
    state.settings.preferredJournals = normalized;
    state.settings.preferredJournal = normalized.join('; ');
  }


  return {
    renderPreferredJournal,
    onSavePreferredJournal,
    onClearPreferredJournal,
    onPreferredJournalListClick,
    onPreferredJournalListKeydown,
    savePreferredJournalAt,
    deletePreferredJournalAt,
    getPreferredJournalSettings,
    setPreferredJournalSettings
  };
}

export { createPreferredJournalSettings };
