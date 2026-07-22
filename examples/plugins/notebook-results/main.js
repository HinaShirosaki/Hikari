// ImageJ Measurements — worked example of a Hikari plugin that both reads and
// writes host data through the postMessage bridge.
//
// Flow: list notebook entries -> parse a pasted ImageJ Results table ->
// append it to the chosen entry as a notebook result table.

import { hikari } from './hikari.js';
import { parseImageJResults } from './parse-results.js';

const entrySelect = document.getElementById('entry');
const resultsInput = document.getElementById('results');
const attachButton = document.getElementById('attach');
const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');

function setStatus(message, kind = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

function renderPreview(table) {
  previewEl.hidden = false;
  previewEl.innerHTML = `
    <thead><tr>${table.columns.map((column) => `<th>${column.title}</th>`).join('')}</tr></thead>
    <tbody>${table.rows.slice(0, 8).map((row) => (
      `<tr>${table.columns.map((column) => `<td>${row[column.field] ?? ''}</td>`).join('')}</tr>`
    )).join('')}</tbody>
  `;
}

resultsInput.addEventListener('input', () => {
  previewEl.hidden = true;
  if (!resultsInput.value.trim()) {
    setStatus('');
    return;
  }
  try {
    const table = parseImageJResults(resultsInput.value);
    renderPreview(table);
    setStatus(`${table.rows.length} measurement row(s) parsed.`, 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

attachButton.addEventListener('click', async () => {
  const entryId = entrySelect.value;
  if (!entryId) {
    setStatus('Choose a notebook entry first.', 'error');
    return;
  }
  try {
    const table = parseImageJResults(resultsInput.value);
    attachButton.disabled = true;
    await hikari.call('notebook.appendResult', {
      entryId,
      text: `ImageJ: attached ${table.rows.length} measurement row(s).`,
      table
    });
    setStatus(`Attached ${table.rows.length} row(s). Open the notebook entry to see them.`, 'ok');
    resultsInput.value = '';
    previewEl.hidden = true;
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    attachButton.disabled = false;
  }
});

async function loadEntries() {
  try {
    const entries = await hikari.call('notebook.list');
    if (!entries.length) {
      entrySelect.innerHTML = '<option value="">No notebook entries yet</option>';
      setStatus('Create a notebook entry in Hikari first.', 'error');
      return;
    }
    entrySelect.innerHTML = entries
      .map((entry) => `<option value="${entry.id}">${entry.experimentName || entry.id}</option>`)
      .join('');
    setStatus('');
  } catch (error) {
    entrySelect.innerHTML = '<option value="">Unavailable</option>';
    setStatus(error.message, 'error');
  }
}

loadEntries();
