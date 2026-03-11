import { exportNotebookEntryPdf } from './pdf-export.js';

export function initLabNotebook({
  state,
  persist,
  createId,
  safeText,
  onNotebookEntriesChanged,
  notebookType = 'biology',
  importProtocolsFromJson = null
}) {
  const PLACEHOLDER_TOKEN_REGEX = /\{\{ph:([^}]+)\}\}/g;
  const notebookProjectSelect = document.getElementById('biology-notebook-project-select');
  const notebookProtocolSearchInput = document.getElementById('biology-notebook-protocol-search');
  const notebookProtocolSelect = document.getElementById('biology-notebook-protocol-select');
  const notebookProtocolArea = document.getElementById('biology-notebook-protocol-area');
  const notebookProtocolTitle = document.getElementById('biology-notebook-protocol-title');
  const notebookSteps = document.getElementById('biology-notebook-steps');
  const notebookResult = document.getElementById('biology-notebook-result');
  const notebookResultFile = document.getElementById('biology-notebook-result-file');
  const saveNotebookBtn = document.getElementById('save-biology-notebook-btn');
  const cancelEditBtn = document.getElementById('cancel-biology-notebook-edit-btn');
  const notebookEntryList = document.getElementById('biology-notebook-entry-list');
  const protocolJsonImportFileInput = document.getElementById('biology-protocol-json-import-file');
  const protocolJsonImportInput = document.getElementById('biology-protocol-json-import-input');
  const importProtocolJsonBtn = document.getElementById('biology-import-protocol-json-btn');
  const protocolJsonImportStatus = document.getElementById('biology-import-protocol-json-status');
  let editingEntryId = null;

  notebookProjectSelect.addEventListener('change', onProjectChange);
  notebookProtocolSearchInput?.addEventListener('input', onProtocolSearchInput);
  notebookProtocolSelect.addEventListener('change', onProtocolChange);
  saveNotebookBtn.addEventListener('click', saveEntry);
  cancelEditBtn?.addEventListener('click', cancelEdit);
  notebookEntryList?.addEventListener('click', onEntryListClick);
  importProtocolJsonBtn?.addEventListener('click', onImportProtocolJson);
  notebookSteps.addEventListener('click', onInlinePlaceholderClick);
  notebookSteps.addEventListener('blur', onInlinePlaceholderBlur, true);
  notebookSteps.addEventListener('keydown', onInlinePlaceholderKeydown);
  updateSaveButtonLabel();
  if (protocolJsonImportStatus && !String(protocolJsonImportStatus.textContent || '').trim()) {
    protocolJsonImportStatus.textContent = 'Imported protocols will appear in the protocol selector below.';
  }

  async function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read selected JSON file.'));
      reader.readAsText(file);
    });
  }

  async function readProtocolJsonImportInput() {
    const directText = String(protocolJsonImportInput?.value || '').trim();
    if (directText) {
      return directText;
    }
    const file = protocolJsonImportFileInput?.files?.[0];
    if (!file) {
      return '';
    }
    return readTextFile(file);
  }

  function setProtocolJsonImportStatus(message) {
    if (!protocolJsonImportStatus) {
      return;
    }
    protocolJsonImportStatus.textContent = String(message || '').trim()
      || 'Imported protocols will appear in the protocol selector below.';
  }

  async function onImportProtocolJson() {
    if (typeof importProtocolsFromJson !== 'function') {
      setProtocolJsonImportStatus('Protocol JSON import is unavailable.');
      return;
    }

    let rawInput = '';
    try {
      rawInput = await readProtocolJsonImportInput();
    } catch (error) {
      setProtocolJsonImportStatus(String(error?.message || error || 'Failed to read JSON input.'));
      return;
    }

    if (!String(rawInput || '').trim()) {
      setProtocolJsonImportStatus('Paste protocol JSON or choose a JSON file first.');
      return;
    }

    const result = importProtocolsFromJson(rawInput, {
      copySuffixLabel: 'Notebook Import',
      renderList: false
    });
    if (!result?.ok) {
      setProtocolJsonImportStatus(String(result?.error || 'Failed to import protocol JSON.'));
      return;
    }

    if (protocolJsonImportInput) {
      protocolJsonImportInput.value = '';
    }
    if (protocolJsonImportFileInput) {
      protocolJsonImportFileInput.value = '';
    }
    renderProtocolOptions();

    if (result.importedProtocols?.length === 1) {
      setProtocolJsonImportStatus(`Imported "${result.importedProtocols[0].name}".`);
      return;
    }
    setProtocolJsonImportStatus(`Imported ${result.importedProtocols?.length || 0} protocols.`);
  }

  function onProjectChange() {
    editingEntryId = null;
    updateSaveButtonLabel();
    renderProtocolOptions();
  }

  function onProtocolSearchInput() {
    renderProtocolOptions();
  }

  function buildNotebookFolderPath(projectName) {
    const rootPath = state.settings.storagePath.trim();
    if (!rootPath) {
      return '';
    }
    const safeProject = sanitizeFolderName(projectName);
    const experimentDateTime = new Date().toISOString().replace('T', '_').replace(/[:.]/g, '-').replace('Z', '');
    return `${rootPath}/Project/${safeProject || 'Untitled_Project'}/Notebook/${experimentDateTime}`;
  }

  function sanitizeFolderName(value) {
    return String(value || '')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function onProtocolChange() {
    const projectId = notebookProjectSelect.value;
    const protocolId = notebookProtocolSelect.value;
    const project = state.projects.find((item) => item.id === projectId);
    const protocol = state.protocols.find((item) => item.id === protocolId);

    if (!project || !protocol) {
      notebookProtocolArea.hidden = true;
      notebookSteps.innerHTML = '';
      notebookResult.value = '';
      notebookResultFile.value = '';
      return;
    }

    notebookProtocolArea.hidden = false;
    notebookProtocolTitle.textContent = protocol.name;

    const editingEntry = editingEntryId
      ? state.notebookEntries.find((entry) => entry.id === editingEntryId && matchesNotebookType(entry))
      : null;
    const existingEntry = editingEntry && editingEntry.protocolId === protocol.id && editingEntry.projectId === project.id
      ? editingEntry
      : state.notebookEntries.find(
        (entry) => entry.protocolId === protocol.id && entry.projectId === project.id && matchesNotebookType(entry)
      );
    if (!editingEntry || existingEntry?.id !== editingEntry.id) {
      editingEntryId = null;
    }
    const values = existingEntry?.values || {};

    notebookSteps.innerHTML = protocol.steps.map((step, index) => {
      const sentenceHtml = renderStepSentence(step, values);

      return `
        <article class="card">
          <p class="notebook-step-line"><strong>Step ${index + 1}:</strong> ${sentenceHtml}</p>
        </article>
      `;
    }).join('');

    notebookResult.value = existingEntry?.result || '';
    notebookResultFile.value = '';
    updateSaveButtonLabel();
  }

  async function saveEntry() {
    const projectId = notebookProjectSelect.value;
    const protocolId = notebookProtocolSelect.value;
    const project = state.projects.find((item) => item.id === projectId);
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (!project || !protocol) {
      return;
    }

    const values = {};
    notebookSteps.querySelectorAll('[data-nb-key]').forEach((input) => {
      values[input.dataset.nbKey] = input.value.trim();
    });

    const editingEntry = editingEntryId
      ? state.notebookEntries.find((item) => item.id === editingEntryId && matchesNotebookType(item))
      : null;
    const selectedResultFiles = Array.from(notebookResultFile.files || []);
    const existingResultFiles = Array.isArray(editingEntry?.resultFiles)
      ? editingEntry.resultFiles.map((name) => String(name || '').trim()).filter(Boolean)
      : [];
    const existingResultFileRecords = Array.isArray(editingEntry?.resultFileRecords)
      ? editingEntry.resultFileRecords
        .filter((record) => record && typeof record === 'object')
        .map((record) => ({ ...record }))
      : [];
    const storageFolder = editingEntry?.storageFolder || buildNotebookFolderPath(project.name);

    let importedResultFileRecords = [];
    try {
      await ensureStorageFolderExists(storageFolder);
      importedResultFileRecords = await persistImportedNotebookFiles({
        files: selectedResultFiles,
        storageFolder
      });
    } catch (error) {
      window.alert(String(error?.message || error || 'Failed to store notebook files.'));
      return;
    }

    const resultFileRecords = existingResultFileRecords.concat(importedResultFileRecords);
    const recordNames = resultFileRecords.map((record) => String(record?.name || '').trim()).filter(Boolean);
    const fallbackSelectedNames = selectedResultFiles.map((file) => file.name);
    const resultFiles = Array.from(new Set(
      existingResultFiles.concat(recordNames, recordNames.length ? [] : fallbackSelectedNames)
    ));

    const entry = {
      id: editingEntry?.id || createId(),
      notebookType,
      projectId: project.id,
      projectName: project.name,
      protocolId: protocol.id,
      protocolName: protocol.name,
      values,
      result: notebookResult.value.trim(),
      resultFiles,
      resultFileRecords,
      storageFolder,
      updatedAt: new Date().toISOString()
    };

    const index = editingEntry
      ? state.notebookEntries.findIndex((item) => item.id === editingEntry.id)
      : -1;
    if (index >= 0) {
      state.notebookEntries[index] = { ...state.notebookEntries[index], ...entry };
    } else {
      state.notebookEntries.push(entry);
    }
    editingEntryId = entry.id;
    updateSaveButtonLabel();

    persist();
    notebookResultFile.value = '';
    renderEntries();
    if (typeof onNotebookEntriesChanged === 'function') {
      onNotebookEntriesChanged();
    }
  }

  async function ensureStorageFolderExists(storageFolder) {
    if (!storageFolder || !window.enanaApi?.ensureStorageDirectory) {
      return;
    }
    await window.enanaApi.ensureStorageDirectory(storageFolder);
  }

  async function persistImportedNotebookFiles({ files, storageFolder }) {
    const selectedFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!selectedFiles.length) {
      return [];
    }

    const rootPath = state.settings.storagePath.trim();
    if (!rootPath) {
      throw new Error('Set Storage Folder Path in Settings before importing notebook files.');
    }
    if (!storageFolder) {
      throw new Error('Notebook storage folder is missing.');
    }
    if (!window.enanaApi?.storeImportedFile) {
      throw new Error('Imported file storage API is unavailable.');
    }

    const targetFolder = `${storageFolder}/ResultFiles`;
    const importedAt = new Date().toISOString();
    const records = [];

    for (const file of selectedFiles) {
      const dataUrl = await blobToDataUrl(file);
      const dataBase64 = extractBase64Payload(dataUrl);
      if (!dataBase64) {
        throw new Error(`Cannot read ${file.name}.`);
      }
      const result = await window.enanaApi.storeImportedFile({
        storagePath: rootPath,
        targetFolder,
        fileName: file.name,
        dataBase64
      });
      if (!result?.ok) {
        throw new Error(result?.error || `Failed to store ${file.name}.`);
      }

      records.push({
        name: result.fileName || file.name,
        path: result.filePath || '',
        relativePath: result.relativePath || '',
        size: Number(file.size) || 0,
        importedAt
      });
    }

    return records;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Cannot convert imported file to data URL.'));
      reader.readAsDataURL(blob);
    });
  }

  function extractBase64Payload(dataUrl) {
    const source = String(dataUrl || '');
    const commaIndex = source.indexOf(',');
    if (commaIndex < 0) {
      return '';
    }
    return source.slice(commaIndex + 1).trim();
  }

  function renderProjectOptions() {
    const selected = notebookProjectSelect.value;
    const options = ['<option value="">Select project</option>'];

    state.projects.forEach((project) => {
      const isSelected = project.id === selected ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name)}</option>`);
    });

    notebookProjectSelect.innerHTML = options.join('');

    if (selected && state.projects.some((project) => project.id === selected)) {
      notebookProjectSelect.value = selected;
    } else if (state.projects.length) {
      notebookProjectSelect.value = state.projects[0].id;
    }
  }

  function renderProtocolOptions(preferredProtocolId = '') {
    const projectId = notebookProjectSelect.value;
    const selected = preferredProtocolId || notebookProtocolSelect.value;
    const hasProject = Boolean(state.projects.find((item) => item.id === projectId));
    const searchTerm = String(notebookProtocolSearchInput?.value || '').trim().toLowerCase();
    const options = ['<option value="">Select protocol</option>'];
    const selectedProtocol = state.protocols.find((item) => item.id === selected) || null;
    const filteredProtocols = hasProject
      ? state.protocols.filter((protocol) => String(protocol.name || '').toLowerCase().includes(searchTerm))
      : [];

    if (
      hasProject
      && selectedProtocol
      && !filteredProtocols.some((protocol) => protocol.id === selectedProtocol.id)
    ) {
      filteredProtocols.unshift(selectedProtocol);
    }

    filteredProtocols.forEach((protocol) => {
      const isSelected = protocol.id === selected ? ' selected' : '';
      options.push(`<option value="${protocol.id}"${isSelected}>${safeText(protocol.name)}</option>`);
    });

    notebookProtocolSelect.innerHTML = options.join('');
    notebookProtocolSelect.disabled = !hasProject;

    if (hasProject && selected && Array.from(notebookProtocolSelect.options).some((option) => option.value === selected)) {
      notebookProtocolSelect.value = selected;
    }

    onProtocolChange();
  }

  function renderEntries() {
    const entries = state.notebookEntries.filter((entry) => matchesNotebookType(entry));

    if (!entries.length) {
      notebookEntryList.innerHTML = '<p class="small-note">No notebook entries saved.</p>';
      return;
    }

    notebookEntryList.innerHTML = entries.map((entry) => {
      const protocol = state.protocols.find((item) => item.id === entry.protocolId);
      const fullProtocol = (protocol?.steps || []).map((step, index) => {
        return `<li><strong>Step ${index + 1}:</strong> ${renderFilledStepText(step, entry.values || {})}</li>`;
      }).join('');

      return `
        <details class="list-row list-row-details">
          <summary class="list-main-text">
            ${safeText(entry.projectName || '-')} / ${safeText(entry.protocolName)}
            <span class="small-note">Updated: ${new Date(entry.updatedAt).toLocaleString()}</span>
          </summary>
          <div class="stack-form list-detail-content">
            <div class="card-actions">
              <button type="button" class="ghost-btn" data-notebook-edit="${entry.id}">Edit</button>
              <button type="button" class="ghost-btn" data-notebook-export="${entry.id}">Export PDF</button>
            </div>
            <p><strong>Notebook Folder:</strong> ${safeText(entry.storageFolder || '-')}</p>
            <p><strong>Complete Protocol:</strong></p>
            <ol>${fullProtocol || '<li>No protocol steps found.</li>'}</ol>
            <p><strong>Result File / Notes:</strong> ${safeText(entry.result || '-')}</p>
            <p><strong>Result Files:</strong> ${safeText((entry.resultFiles || []).join(', ') || '-')}</p>
          </div>
        </details>
      `;
    }).join('');
  }

  function onEntryListClick(event) {
    const exportBtn = event.target.closest('[data-notebook-export]');
    if (exportBtn) {
      exportEntryPdf(exportBtn.dataset.notebookExport);
      return;
    }

    const editBtn = event.target.closest('[data-notebook-edit]');
    if (!editBtn) {
      return;
    }
    editEntry(editBtn.dataset.notebookEdit);
  }

  function exportEntryPdf(entryId) {
    const entry = state.notebookEntries.find((item) => item.id === entryId && matchesNotebookType(item));
    if (!entry) {
      return;
    }
    const protocol = state.protocols.find((item) => item.id === entry.protocolId) || null;
    exportNotebookEntryPdf({ entry, protocol });
  }

  function editEntry(entryId) {
    const entry = state.notebookEntries.find((item) => item.id === entryId && matchesNotebookType(item));
    if (!entry) {
      return;
    }

    editingEntryId = entry.id;
    notebookProjectSelect.value = entry.projectId;
    renderProtocolOptions(entry.protocolId);
    onProtocolChange();
  }

  function updateSaveButtonLabel() {
    if (!saveNotebookBtn) {
      return;
    }
    const editing = Boolean(editingEntryId);
    saveNotebookBtn.textContent = editing ? 'Update Notebook Entry' : 'Save Notebook Entry';
    if (cancelEditBtn) {
      cancelEditBtn.hidden = !editing;
    }
  }

  function cancelEdit() {
    editingEntryId = null;
    updateSaveButtonLabel();
    onProtocolChange();
  }

  function renderFilledStepText(step, values) {
    const source = String(step?.text || '');
    const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
    const matches = [...source.matchAll(PLACEHOLDER_TOKEN_REGEX)];

    if (!matches.length) {
      if (!placeholders.length) {
        return safeText(source);
      }

      const trailingValues = placeholders.map((placeholder) => {
        const key = `${step.id}:${placeholder.id}`;
        const rawValue = String(values[key] || '').trim();
        return safeText(rawValue || `[${placeholder.name}]`);
      }).join(' ');
      return `${safeText(source)} ${trailingValues}`.trim();
    }

    let cursor = 0;
    let text = '';
    matches.forEach((match) => {
      const index = Number(match.index || 0);
      const placeholderId = match[1];
      const key = `${step.id}:${placeholderId}`;
      const placeholder = placeholders.find((item) => item.id === placeholderId);
      const rawValue = String(values[key] || '').trim();
      text += safeText(source.slice(cursor, index));
      text += safeText(rawValue || `[${placeholder?.name || 'value'}]`);
      cursor = index + match[0].length;
    });

    text += safeText(source.slice(cursor));
    return text;
  }

  function matchesNotebookType(entry) {
    if (entry?.notebookType) {
      return entry.notebookType === notebookType;
    }
    return notebookType === 'synthesis';
  }

  function renderStepSentence(step, values) {
    const source = String(step?.text || '');
    const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
    const matches = [...source.matchAll(PLACEHOLDER_TOKEN_REGEX)];

    if (!matches.length) {
      if (!placeholders.length) {
        return safeText(source);
      }
      const trailing = placeholders.map((item) => {
        const key = `${step.id}:${item.id}`;
        return buildInlinePlaceholderHtml(key, item.name, values[key] || '');
      }).join(' ');
      return `${safeText(source)} ${trailing}`.trim();
    }

    let cursor = 0;
    let html = '';

    matches.forEach((match) => {
      const index = Number(match.index || 0);
      const placeholderId = match[1];
      const key = `${step.id}:${placeholderId}`;
      const placeholder = placeholders.find((item) => item.id === placeholderId);
      html += safeText(source.slice(cursor, index));
      html += buildInlinePlaceholderHtml(key, placeholder?.name || 'value', values[key] || '');
      cursor = index + match[0].length;
    });

    html += safeText(source.slice(cursor));
    return html;
  }

  function buildInlinePlaceholderHtml(key, name, value) {
    const cleanName = safeText(name || 'value');
    const cleanValue = safeText(value || '');
    const tokenLabel = cleanValue || `[${cleanName}]`;
    const isEmptyClass = cleanValue ? '' : ' is-empty';

    return `
      <span class="inline-placeholder-wrap" data-inline-placeholder data-placeholder-name="${cleanName}">
        <button type="button" class="inline-placeholder-token${isEmptyClass}" data-inline-token data-nb-key-ref="${safeText(key)}">${tokenLabel}</button>
        <input type="text" class="inline-placeholder-editor" data-inline-input data-nb-key-ref="${safeText(key)}" value="${cleanValue}" placeholder="${cleanName}" hidden />
        <input type="hidden" data-nb-key="${safeText(key)}" value="${cleanValue}" />
      </span>
    `;
  }

  function onInlinePlaceholderClick(event) {
    const token = event.target.closest('[data-inline-token]');
    if (!token) {
      return;
    }

    const wrap = token.closest('[data-inline-placeholder]');
    if (!wrap) {
      return;
    }

    const editor = wrap.querySelector('[data-inline-input]');
    const hiddenValue = wrap.querySelector('[data-nb-key]');
    if (!editor || !hiddenValue) {
      return;
    }

    editor.value = hiddenValue.value || '';
    token.hidden = true;
    editor.hidden = false;
    editor.focus();
    editor.select();
  }

  function onInlinePlaceholderBlur(event) {
    const editor = event.target.closest('[data-inline-input]');
    if (!editor) {
      return;
    }
    commitInlinePlaceholder(editor);
  }

  function onInlinePlaceholderKeydown(event) {
    const editor = event.target.closest('[data-inline-input]');
    if (!editor) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      commitInlinePlaceholder(editor);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      const wrap = editor.closest('[data-inline-placeholder]');
      const hiddenValue = wrap?.querySelector('[data-nb-key]');
      if (hiddenValue) {
        editor.value = hiddenValue.value || '';
      }
      closeInlinePlaceholderEditor(editor);
    }
  }

  function commitInlinePlaceholder(editor) {
    const wrap = editor.closest('[data-inline-placeholder]');
    const hiddenValue = wrap?.querySelector('[data-nb-key]');
    if (!hiddenValue) {
      closeInlinePlaceholderEditor(editor);
      return;
    }

    const cleanValue = editor.value.trim();
    hiddenValue.value = cleanValue;
    closeInlinePlaceholderEditor(editor);
  }

  function closeInlinePlaceholderEditor(editor) {
    const wrap = editor.closest('[data-inline-placeholder]');
    const hiddenValue = wrap?.querySelector('[data-nb-key]');
    const token = wrap?.querySelector('[data-inline-token]');
    if (!wrap || !hiddenValue || !token) {
      return;
    }

    const name = wrap.dataset.placeholderName || 'value';
    const cleanValue = hiddenValue.value || '';
    token.textContent = cleanValue || `[${name}]`;
    token.classList.toggle('is-empty', !cleanValue);
    editor.hidden = true;
    token.hidden = false;
  }

  return { renderProjectOptions, renderProtocolOptions, renderEntries, onProtocolChange };
}
