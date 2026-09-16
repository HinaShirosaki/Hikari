// Reference local-plugin UI. This file intentionally stays a classic script:
// opaque-origin local plugins cannot load relative ES modules.
(function startNotebookResultsPlugin(root) {
  'use strict';

  const entrySelect = document.getElementById('entry');
  const resultsInput = document.getElementById('results');
  const attachButton = document.getElementById('attach');
  const retryButton = document.getElementById('retry');
  const statusEl = document.getElementById('status');
  const previewEl = document.getElementById('preview');
  const hikari = root.HikariPlugin?.hikari;
  const parseImageJResults = root.HikariNotebookResults?.parseImageJResults;
  let entriesReady = false;
  let parsedTable = null;
  let attachInFlight = false;
  let entriesLoadPromise = null;

  function setStatus(message, kind = '', { retry = false } = {}) {
    statusEl.textContent = message;
    statusEl.className = `status ${kind}`.trim();
    retryButton.hidden = !retry;
  }

  function replaceChildren(node, children = []) {
    node.replaceChildren(...children);
  }

  function makeOption(value, label) {
    const option = document.createElement('option');
    option.value = String(value || '');
    option.textContent = String(label || value || 'Untitled entry');
    return option;
  }

  function renderPreview(table) {
    const headerRow = document.createElement('tr');
    table.columns.forEach((column) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = column.title;
      headerRow.append(cell);
    });
    const head = document.createElement('thead');
    head.append(headerRow);

    const body = document.createElement('tbody');
    table.rows.slice(0, 8).forEach((row) => {
      const rowElement = document.createElement('tr');
      table.columns.forEach((column) => {
        const cell = document.createElement('td');
        cell.textContent = row[column.field] ?? '';
        rowElement.append(cell);
      });
      body.append(rowElement);
    });
    replaceChildren(previewEl, [head, body]);
    previewEl.hidden = false;
  }

  function updateAttachAvailability() {
    attachButton.disabled = attachInFlight || !entriesReady || !entrySelect.value || !parsedTable;
  }

  resultsInput.addEventListener('input', () => {
    parsedTable = null;
    previewEl.hidden = true;
    replaceChildren(previewEl);
    if (!resultsInput.value.trim()) {
      setStatus('');
      updateAttachAvailability();
      return;
    }
    try {
      parsedTable = parseImageJResults(resultsInput.value);
      renderPreview(parsedTable);
      setStatus(`${parsedTable.rows.length} measurement row(s) parsed.`, 'ok');
    } catch (error) {
      setStatus(error?.message || 'Could not parse the results table.', 'error');
    }
    updateAttachAvailability();
  });

  entrySelect.addEventListener('change', updateAttachAvailability);

  attachButton.addEventListener('click', async () => {
    if (attachInFlight) {
      return;
    }
    const entryId = entrySelect.value;
    if (!entryId || !parsedTable) {
      setStatus('Choose a notebook entry and paste a valid results table first.', 'error');
      updateAttachAvailability();
      return;
    }

    attachInFlight = true;
    entrySelect.disabled = true;
    resultsInput.disabled = true;
    attachButton.textContent = 'Attaching…';
    attachButton.setAttribute('aria-busy', 'true');
    updateAttachAvailability();
    try {
      await hikari.call('notebook.appendResult', {
        entryId,
        text: `ImageJ: attached ${parsedTable.rows.length} measurement row(s).`,
        table: parsedTable
      });
      setStatus(`Attached ${parsedTable.rows.length} row(s). Open the notebook entry to see them.`, 'ok');
      resultsInput.value = '';
      parsedTable = null;
      previewEl.hidden = true;
      replaceChildren(previewEl);
    } catch (error) {
      setStatus(error?.message || 'Could not attach the results.', 'error');
    } finally {
      attachInFlight = false;
      entrySelect.disabled = !entriesReady;
      resultsInput.disabled = false;
      attachButton.textContent = 'Attach to notebook entry';
      attachButton.removeAttribute('aria-busy');
      updateAttachAvailability();
    }
  });

  function loadEntries() {
    if (entriesLoadPromise) {
      return entriesLoadPromise;
    }
    entriesLoadPromise = (async () => {
      if (!hikari || typeof parseImageJResults !== 'function') {
        entrySelect.disabled = true;
        entrySelect.removeAttribute('aria-busy');
        attachButton.disabled = true;
        setStatus('Plugin support files did not load. Reinstall this plugin folder and reload Hikari.', 'error');
        return;
      }

      entriesReady = false;
      retryButton.disabled = true;
      entrySelect.disabled = true;
      entrySelect.setAttribute('aria-busy', 'true');
      replaceChildren(entrySelect, [makeOption('', 'Loading…')]);
      setStatus('Loading notebook entries…');
      updateAttachAvailability();
      try {
        const entries = await hikari.call('notebook.list');
        const usableEntries = Array.isArray(entries)
          ? entries.filter((entry) => String(entry?.id || '').trim())
          : [];
        if (!usableEntries.length) {
          replaceChildren(entrySelect, [makeOption('', 'No notebook entries yet')]);
          setStatus('Create a notebook entry in Hikari first.', 'error');
          return;
        }
        replaceChildren(entrySelect, usableEntries.map((entry) => (
          makeOption(entry?.id, entry?.experimentName || entry?.id)
        )));
        entriesReady = true;
        entrySelect.disabled = false;
        setStatus('');
      } catch (error) {
        replaceChildren(entrySelect, [makeOption('', 'Unavailable')]);
        setStatus(error?.message || 'Could not load notebook entries.', 'error', { retry: true });
      } finally {
        retryButton.disabled = false;
        entrySelect.removeAttribute('aria-busy');
        updateAttachAvailability();
      }
    })().finally(() => {
      entriesLoadPromise = null;
    });
    return entriesLoadPromise;
  }

  retryButton.addEventListener('click', loadEntries);
  loadEntries();
}(window));
