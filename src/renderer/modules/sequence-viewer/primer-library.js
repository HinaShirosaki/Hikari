import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("dna");
import { escapeHtml } from '../../lib/html.js';
import { showTransientNotice } from '../../lib/notify.js';
import { addPrimersToLibrary, normalizePrimerLibrary } from '../../../shared/primer-library.mjs';

export function createPrimerLibraryController(config = {}) {
  const elements = config.elements || {};
  const rootDocument = config.rootDocument || globalThis.document;
  const appState = config.appState || {};
  const persist = config.persist || (() => {});
  const selected = new Set();
  let query = '';
  const overlay = elements.primerLibraryOverlay;
  // Shared by the home and detail views: hidden workspace ancestors must not hide it.
  if (overlay && rootDocument?.body) rootDocument.body.appendChild(overlay);

  const entries = () => normalizePrimerLibrary(appState.primerLibrary);
  const visibleEntries = () => entries().filter(entry => !query || `${entry.name} ${entry.sequence} ${entry.sourceName}`.toLowerCase().includes(query));

  function syncSelection() {
    const rows = entries();
    const ids = new Set(rows.map(row => row.id));
    for (const id of selected) if (!ids.has(id)) selected.delete(id);
    const visible = visibleEntries();
    const checked = visible.filter(row => selected.has(row.id)).length;
    if (elements.primerLibrarySelectAll) {
      elements.primerLibrarySelectAll.checked = visible.length > 0 && checked === visible.length;
      elements.primerLibrarySelectAll.indeterminate = checked > 0 && checked < visible.length;
      elements.primerLibrarySelectAll.disabled = !visible.length;
    }
    if (elements.primerLibraryCount) i18nUi.setText(elements.primerLibraryCount, i18nUi.message((rows.length === 1 ? "{p0} primer · {p2} selected" : "{p0} primers · {p2} selected"), { p0: rows.length, p2: selected.size }));
    if (elements.primerLibraryExportBtn) elements.primerLibraryExportBtn.disabled = !selected.size;
    if (elements.primerLibraryRemoveBtn) elements.primerLibraryRemoveBtn.disabled = !selected.size;
  }

  function render() {
    const rows = visibleEntries();
    if (elements.primerLibraryBody) i18nUi.setHtml(elements.primerLibraryBody, rows.length ? rows.map(row => `
      <tr>
        <td><input type="checkbox" data-primer-library-select="${escapeHtml(row.id)}" ${i18nUi.attributeMessage("aria-label", i18nUi.message("Select {p0}", { p0: row.name }))}${selected.has(row.id) ? ' checked' : ''}></td>
        <td><textarea rows="1" class="sequence-viewer-primer-library-name" data-primer-library-name="${escapeHtml(row.id)}" maxlength="160" spellcheck="false" ${i18nUi.attributeMessage("aria-label", i18nUi.message("Primer name for {p0}", { p0: row.name }))}>${escapeHtml(row.name)}</textarea></td>
        <td><code>${escapeHtml(row.sequence)}</code></td>
        <td class="sequence-viewer-primer-library-length">${row.sequence.length}</td>
        <td>${escapeHtml(row.sourceName || '—')}</td>
      </tr>`).join('') : `<tr><td colspan="5" class="sequence-viewer-primer-library-empty">${i18nUi.render((query ? i18nUi.message("No primers match your search.") : i18nUi.message("Save primers from a cloning design or a primer hover window to build your library.")))}</td></tr>`);
    syncSelection();
  }

  function commit(next, label) {
    const previous = appState.primerLibrary;
    appState.primerLibrary = next;
    try {
      persist({ label });
      render();
      return true;
    } catch (error) {
      appState.primerLibrary = previous;
      showTransientNotice((((((error?.message || i18nUi.message("Could not save the primer library.")))))), { type: 'error' });
      render();
      return false;
    }
  }

  function save(primers, sourceName = '') {
    const result = addPrimersToLibrary(entries(), primers, { sourceName, createId: config.createId });
    if (result.added && !commit(result.entries, 'Save primers to library')) return false;
    const existing = result.savedIds.length - result.added;
    const message = [result.added ? `Saved ${result.added} primer${result.added === 1 ? '' : 's'} to Primer Library.` : '',
      existing ? `${existing} already in the library.` : '',
      result.invalid ? `${result.invalid} primer${result.invalid === 1 ? '' : 's'} could not be saved because the DNA sequence is invalid.` : ''].filter(Boolean).join(' ');
    showTransientNotice((((((message || i18nUi.message("No primers to save.")))))), { type: result.invalid ? 'error' : 'success' });
    render();
    return result.savedIds.length > 0;
  }

  function open() {
    if (!overlay) return false;
    rootDocument?.querySelectorAll?.('[data-sequence-hover-tooltip]').forEach(node => { node.hidden = true; });
    render();
    if (!overlay.open) overlay.showModal();
    elements.primerLibrarySearch?.focus?.();
    return true;
  }

  function hide() {
    overlay?.close();
  }

  function bindEvents() {
    elements.homePrimerLibraryBtn?.addEventListener('click', open);
    elements.detailPrimerLibraryBtn?.addEventListener('click', open);
    elements.primerLibraryCloseBtn?.addEventListener('click', hide);
    overlay?.addEventListener('click', event => { if (event.target === overlay) hide(); });
    elements.primerLibrarySearch?.addEventListener('input', () => {
      query = String(elements.primerLibrarySearch.value || '').trim().toLowerCase();
      render();
    });
    elements.primerLibrarySelectAll?.addEventListener('change', () => {
      for (const row of visibleEntries()) {
        if (elements.primerLibrarySelectAll.checked) selected.add(row.id);
        else selected.delete(row.id);
      }
      render();
    });
    elements.primerLibraryBody?.addEventListener('change', event => {
      const checkbox = event.target.closest?.('[data-primer-library-select]');
      if (checkbox) {
        if (checkbox.checked) selected.add(checkbox.dataset.primerLibrarySelect);
        else selected.delete(checkbox.dataset.primerLibrarySelect);
        syncSelection();
        return;
      }
      const input = event.target.closest?.('[data-primer-library-name]');
      if (!input) return;
      const rows = entries();
      const row = rows.find(entry => entry.id === input.dataset.primerLibraryName);
      const name = input.value.replace(/[\t\r\n]+/g, ' ').trim().slice(0, 160);
      if (!row || !name || rows.some(entry => entry.id !== row.id && entry.name === name && entry.sequence === row.sequence)) {
        showTransientNotice(i18nUi.message("Enter a primer name that does not duplicate this sequence in the library."), { type: 'error' });
        render();
        return;
      }
      if (row.name === name) return;
      commit(rows.map(entry => entry.id === row.id ? { ...entry, name, updatedAt: new Date().toISOString() } : entry), 'Rename library primer');
    });
    elements.primerLibraryExportBtn?.addEventListener('click', () => {
      config.onRequestPrimerOrder?.(entries().filter(entry => selected.has(entry.id)));
    });
    elements.primerLibraryRemoveBtn?.addEventListener('click', () => {
      commit(entries().filter(entry => !selected.has(entry.id)), 'Remove library primers');
    });
    rootDocument?.addEventListener?.('click', event => {
      const button = event.target?.closest?.('[data-sequence-primer-library-save]');
      if (!button) return;
      event.preventDefault();
      save([{ name: button.dataset.primerName, sequence: button.dataset.primerSequence }], config.getSelectedRecord?.()?.name || '');
    });
  }

  return { bindEvents, hide, open, render, save };
}
