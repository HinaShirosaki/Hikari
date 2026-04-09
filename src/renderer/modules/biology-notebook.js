// Biology notebook controller.
//
// Responsibilities:
// - render project/protocol selections for notebook entry creation
// - populate inline placeholder editors from protocol step definitions
// - save notebook entries plus imported result files into app state
// - support editing existing entries and exporting them to PDF
import { exportNotebookEntryPdf } from './pdf-export.js';
import {
  buildNotebookAssayPlatePreviewHtml,
  findLatestLinkedRecord,
  formatLinkedPreviewTimestamp
} from './notebook-linked-previews.js';

// Initialize the biology notebook module and wire it to app state plus DOM controls.
export function initLabNotebook({
  state,
  persist,
  createId,
  safeText,
  onNotebookEntriesChanged,
  onCreateLinkedAssay,
  onCreateLinkedGel,
  notebookType = 'biology'
}) {
  const PLACEHOLDER_TOKEN_REGEX = /\{\{ph:([^}]+)\}\}/g;

  const notebookProjectSelect = document.getElementById('biology-notebook-project-select');
  const notebookProtocolSearchInput = document.getElementById('biology-notebook-protocol-search');
  const notebookProtocolSelect = document.getElementById('biology-notebook-protocol-select');
  const notebookEmptyState = document.getElementById('biology-notebook-empty-state');
  const notebookProtocolArea = document.getElementById('biology-notebook-protocol-area');
  const notebookProtocolTitle = document.getElementById('biology-notebook-protocol-title');
  const notebookProtocolMeta = document.getElementById('biology-notebook-protocol-meta');
  const notebookExportBtn = document.getElementById('biology-notebook-export-btn');
  const notebookMarkExecutedBtn = document.getElementById('biology-notebook-mark-executed-btn');
  const notebookPageListStatus = document.getElementById('biology-notebook-page-list-status');
  const notebookSteps = document.getElementById('biology-notebook-steps');
  const notebookResult = document.getElementById('biology-notebook-result');
  const notebookResultFile = document.getElementById('biology-notebook-result-file');
  const notebookAddGelBtn = document.getElementById('biology-notebook-add-gel-btn');
  const notebookAddAssayBtn = document.getElementById('biology-notebook-add-assay-btn');
  const notebookLinkedResults = document.getElementById('biology-notebook-linked-results');
  const saveNotebookBtn = document.getElementById('save-biology-notebook-btn');
  const cancelEditBtn = document.getElementById('cancel-biology-notebook-edit-btn');
  const notebookEntryList = document.getElementById('biology-notebook-entry-list');

  let editingEntryId = null;
  const linkedPreviewCache = new Map();
  let linkedPreviewRenderToken = 0;

  notebookProjectSelect.addEventListener('change', onProjectChange);
  notebookProtocolSearchInput?.addEventListener('input', onProtocolSearchInput);
  notebookProtocolSelect.addEventListener('change', onProtocolChange);
  saveNotebookBtn.addEventListener('click', () => {
    void saveEntry();
  });
  notebookAddGelBtn?.addEventListener('click', () => {
    void onAddGelClick();
  });
  notebookAddAssayBtn?.addEventListener('click', () => {
    void onAddAssayClick();
  });
  cancelEditBtn?.addEventListener('click', cancelEdit);
  notebookEntryList?.addEventListener('click', onEntryListClick);
  notebookExportBtn?.addEventListener('click', onExportButtonClick);
  notebookMarkExecutedBtn?.addEventListener('click', markEntryExecuted);
  notebookSteps.addEventListener('click', onInlinePlaceholderClick);
  notebookSteps.addEventListener('blur', onInlinePlaceholderBlur, true);
  notebookSteps.addEventListener('keydown', onInlinePlaceholderKeydown);
  updateSaveButtonLabel();
  syncViewerVisibility();
  renderLinkedPreviews(null);

  function onProjectChange() {
    editingEntryId = null;
    updateSaveButtonLabel();
    renderProtocolOptions();
    renderEntries();
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

  function normalizeNotebookState(value) {
    return String(value || '').trim().toLowerCase() === 'planned' ? 'planned' : 'executed';
  }

  function notebookStateLabel(entry) {
    return normalizeNotebookState(entry?.notebookState) === 'planned' ? 'Planned' : 'Executed';
  }

  function resolveEntryNotebookState(entry) {
    return normalizeNotebookState(entry?.notebookState);
  }

  function resolveEntryExecutedAt(entry, fallbackTimestamp = '') {
    if (resolveEntryNotebookState(entry) === 'planned') {
      return '';
    }
    return String(entry?.executedAt || '').trim()
      || String(entry?.updatedAt || '').trim()
      || String(fallbackTimestamp || '').trim();
  }

  function formatEntryTimestamp(rawValue) {
    const date = new Date(String(rawValue || '').trim());
    if (Number.isNaN(date.getTime())) {
      return 'Unknown time';
    }
    return date.toLocaleString();
  }

  function onProtocolChange() {
    const projectId = notebookProjectSelect.value;
    const protocolId = notebookProtocolSelect.value;
    const project = state.projects.find((item) => item.id === projectId);
    const protocol = state.protocols.find((item) => item.id === protocolId);

    if (!project || !protocol) {
      clearViewer();
      renderEntries();
      return;
    }

    const editingEntry = editingEntryId
      ? state.notebookEntries.find((entry) => entry.id === editingEntryId && matchesNotebookType(entry))
      : null;
    const selectedEntry = editingEntry && editingEntry.protocolId === protocol.id && editingEntry.projectId === project.id
      ? editingEntry
      : null;

    if (!selectedEntry) {
      editingEntryId = null;
    }

    renderProtocolViewer({
      project,
      protocol,
      entry: selectedEntry,
      isSavedEntry: Boolean(selectedEntry)
    });
    renderEntries();
  }

  async function saveEntry() {
    const projectId = notebookProjectSelect.value;
    const protocolId = notebookProtocolSelect.value;
    const project = state.projects.find((item) => item.id === projectId);
    const protocol = state.protocols.find((item) => item.id === protocolId);
    if (!project || !protocol) {
      return null;
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
      return null;
    }

    const resultFileRecords = existingResultFileRecords.concat(importedResultFileRecords);
    const recordNames = resultFileRecords.map((record) => String(record?.name || '').trim()).filter(Boolean);
    const fallbackSelectedNames = selectedResultFiles.map((file) => file.name);
    const resultFiles = Array.from(new Set(
      existingResultFiles.concat(recordNames, recordNames.length ? [] : fallbackSelectedNames)
    ));

    const nowIso = new Date().toISOString();
    const notebookState = resolveEntryNotebookState(editingEntry);
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
      updatedAt: nowIso,
      createdAt: String(editingEntry?.createdAt || '').trim() || nowIso,
      notebookState,
      executedAt: resolveEntryExecutedAt(editingEntry, nowIso),
      agentDraftStatus: String(editingEntry?.agentDraftStatus || '').trim(),
      agentDraftMeta: editingEntry?.agentDraftMeta && typeof editingEntry.agentDraftMeta === 'object'
        ? { ...editingEntry.agentDraftMeta }
        : {}
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
    renderProtocolViewer({
      project,
      protocol,
      entry,
      isSavedEntry: true
    });
    if (typeof onNotebookEntriesChanged === 'function') {
      onNotebookEntriesChanged();
    }
    return entry;
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

    updatePageListStatus();
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

    if (hasProject && selected && filteredProtocols.some((protocol) => protocol.id === selected)) {
      notebookProtocolSelect.value = selected;
    }

    updatePageListStatus();
    onProtocolChange();
  }

  function renderEntries() {
    const entries = state.notebookEntries
      .filter((entry) => matchesNotebookType(entry))
      .slice()
      .sort((left, right) => {
        const projectCompare = String(left.projectName || '').localeCompare(String(right.projectName || ''));
        if (projectCompare !== 0) {
          return projectCompare;
        }
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      });

    updatePageListStatus(entries);

    if (!entries.length) {
      notebookEntryList.innerHTML = '<p class="biology-notebook-page-list-empty">No notebook pages saved yet.</p>';
      return;
    }

    const groups = new Map();
    entries.forEach((entry) => {
      const key = entry.projectId || '__unknown__';
      if (!groups.has(key)) {
        groups.set(key, {
          projectName: entry.projectName || 'Untitled Project',
          entries: []
        });
      }
      groups.get(key).entries.push(entry);
    });

    notebookEntryList.innerHTML = Array.from(groups.values()).map((group) => {
      const itemsHtml = group.entries.map((entry) => {
        const isActive = entry.id === editingEntryId ? ' is-active' : '';
        const stateLabel = notebookStateLabel(entry);
        const stateClass = normalizeNotebookState(entry?.notebookState) === 'planned' ? ' is-planned' : ' is-executed';
        const updatedAt = entry.updatedAt ? formatEntryTimestamp(entry.updatedAt) : 'Not saved yet';
        const resultText = String(entry.result || '').trim() || 'No result notes yet.';
        const resultFiles = Array.isArray(entry.resultFiles) && entry.resultFiles.length
          ? entry.resultFiles.join(', ')
          : 'No result files attached.';
        return `
          <details class="biology-notebook-page-card${isActive}${stateClass}"${isActive ? ' open' : ''}>
            <summary class="biology-notebook-page-item" data-notebook-entry-id="${safeText(entry.id)}">
              <span class="biology-notebook-page-name">${safeText(entry.protocolName || 'Untitled Page')}</span>
              <span class="biology-notebook-page-meta${normalizeNotebookState(entry?.notebookState) === 'planned' ? ' is-planned' : ''}">${safeText(`${stateLabel} | ${updatedAt}`)}</span>
            </summary>
            <div class="biology-notebook-page-detail">
              <p class="biology-notebook-page-detail-line"><strong>Notes:</strong> ${safeText(resultText)}</p>
              <p class="biology-notebook-page-detail-line"><strong>Files:</strong> ${safeText(resultFiles)}</p>
            </div>
          </details>
        `;
      }).join('');

      return `
        <section class="biology-notebook-project-group">
          <p class="biology-notebook-project-name">${safeText(group.projectName)}</p>
          <div class="biology-notebook-project-pages">${itemsHtml}</div>
        </section>
      `;
    }).join('');
  }

  function updatePageListStatus(entries = null) {
    if (!notebookPageListStatus) {
      return;
    }

    const savedEntries = Array.isArray(entries)
      ? entries
      : state.notebookEntries.filter((entry) => matchesNotebookType(entry));
    const project = state.projects.find((item) => item.id === notebookProjectSelect.value);
    const protocol = state.protocols.find((item) => item.id === notebookProtocolSelect.value);

    if (project && protocol) {
      notebookPageListStatus.textContent = `Working in ${project.name} / ${protocol.name}`;
      return;
    }
    if (project) {
      notebookPageListStatus.textContent = `Viewing pages for ${project.name}`;
      return;
    }
    notebookPageListStatus.textContent = savedEntries.length
      ? 'Select a notebook page or choose a project and protocol to start a new one.'
      : 'Select a project and protocol to start a page.';
  }

  function formatGelAnalysisTypeLabel(type) {
    if (type === 'western') {
      return 'Western Blot';
    }
    if (type === 'agarose') {
      return 'DNA/RNA Agarose';
    }
    return 'SDS-PAGE';
  }

  function formatAssayAnalysisMethodLabel(method) {
    const source = String(method || '').trim();
    if (!source) {
      return 'Analysis plot';
    }
    return source
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function getActiveEntry() {
    if (!editingEntryId) {
      return null;
    }
    return state.notebookEntries.find((entry) => entry.id === editingEntryId && matchesNotebookType(entry)) || null;
  }

  async function resolveLinkedGelPreviewImage(analysis) {
    const previewImagePath = String(analysis?.previewImagePath || '').trim();
    if (previewImagePath) {
      if (linkedPreviewCache.has(previewImagePath)) {
        return linkedPreviewCache.get(previewImagePath);
      }
      if (window.enanaApi?.readFileBase64) {
        const response = await window.enanaApi.readFileBase64(previewImagePath);
        if (response?.ok && response.dataBase64) {
          const dataUrl = `data:image/png;base64,${response.dataBase64}`;
          linkedPreviewCache.set(previewImagePath, dataUrl);
          return dataUrl;
        }
      }
    }
    return String(analysis?.previewImageDataUrl || '').trim();
  }

  function buildLinkedGelPreviewHtml(analysis, previewImage) {
    const updatedAt = formatLinkedPreviewTimestamp(analysis?.updatedAt);
    const imageHtml = previewImage
      ? `
        <figure class="biology-notebook-linked-preview-figure">
          <img src="${safeText(previewImage)}" alt="${safeText(analysis?.name || 'Linked gel preview')}" />
          <figcaption class="biology-notebook-linked-preview-caption small-note">
            ${safeText(`${formatGelAnalysisTypeLabel(analysis?.analysisType)} · Updated ${updatedAt}`)}
          </figcaption>
        </figure>
      `
      : '<p class="small-note">Save a gel image to show its linked preview here.</p>';

    return `
      <article class="biology-notebook-linked-preview">
        <div class="biology-notebook-linked-preview-head">
          <div class="biology-notebook-linked-preview-copy">
            <h4>${safeText(analysis?.name || 'Linked Gel')}</h4>
            <p class="biology-notebook-linked-preview-meta">${safeText(`${formatGelAnalysisTypeLabel(analysis?.analysisType)} · ${analysis?.projectName || 'No project'}`)}</p>
          </div>
          <span class="small-note">${safeText(updatedAt)}</span>
        </div>
        <div class="biology-notebook-linked-preview-media">
          ${imageHtml}
        </div>
      </article>
    `;
  }

  function buildLinkedAssayPreviewHtml(assay) {
    const latestAnalysis = assay?.latestAnalysis && typeof assay.latestAnalysis === 'object'
      ? assay.latestAnalysis
      : null;
    const plotImage = String(latestAnalysis?.chartDataUrl || '').trim();
    const plateHtml = buildNotebookAssayPlatePreviewHtml(assay, safeText);
    const plotHtml = plotImage
      ? `
        <figure class="biology-notebook-linked-preview-figure">
          <img src="${safeText(plotImage)}" alt="${safeText(`${assay?.name || 'Assay'} analysis plot`)}" />
          <figcaption class="biology-notebook-linked-preview-caption small-note">
            ${safeText(`${formatAssayAnalysisMethodLabel(latestAnalysis?.method)} · ${latestAnalysis?.summary || 'Saved analysis plot'}`)}
          </figcaption>
        </figure>
      `
      : '';

    return `
      <article class="biology-notebook-linked-preview">
        <div class="biology-notebook-linked-preview-head">
          <div class="biology-notebook-linked-preview-copy">
            <h4>${safeText(assay?.name || 'Linked Assay')}</h4>
            <p class="biology-notebook-linked-preview-meta">${safeText(`${assay?.assayNumber || assay?.id || '-'} · ${assay?.plateLabel || `${assay?.wellCount || '-'} well plate`}`)}</p>
          </div>
          <span class="small-note">${safeText(formatLinkedPreviewTimestamp(assay?.updatedAt))}</span>
        </div>
        <div class="biology-notebook-linked-preview-media">
          <div class="biology-notebook-linked-assay-grid">
            ${plateHtml}
          </div>
          ${plotHtml}
        </div>
      </article>
    `;
  }

  async function renderLinkedPreviews(entry = null) {
    if (!notebookLinkedResults) {
      return;
    }

    const renderToken = ++linkedPreviewRenderToken;

    const activeEntry = entry || getActiveEntry();
    if (!activeEntry?.id) {
      notebookLinkedResults.innerHTML = '<p class="small-note biology-notebook-linked-empty">Save this notebook page to attach gel and assay records.</p>';
      return;
    }

    const linkedGel = findLatestLinkedRecord(state.gelAnalyses, activeEntry.id);
    const linkedAssay = findLatestLinkedRecord(state.assays, activeEntry.id);
    const parts = [];

    if (linkedGel) {
      parts.push(buildLinkedGelPreviewHtml(linkedGel, await resolveLinkedGelPreviewImage(linkedGel)));
    }
    if (linkedAssay) {
      parts.push(buildLinkedAssayPreviewHtml(linkedAssay));
    }

    if (renderToken !== linkedPreviewRenderToken) {
      return;
    }

    notebookLinkedResults.innerHTML = parts.length
      ? parts.join('')
      : '<p class="small-note biology-notebook-linked-empty">Linked gel, assay, and plot previews will appear here after you save them to this page.</p>';
  }

  async function ensureNotebookEntryForLinkedWork() {
    const existingEntry = getActiveEntry();
    if (existingEntry) {
      return existingEntry;
    }
    return saveEntry();
  }

  async function onAddGelClick() {
    const entry = await ensureNotebookEntryForLinkedWork();
    if (!entry || typeof onCreateLinkedGel !== 'function') {
      return;
    }
    onCreateLinkedGel({
      notebookEntryId: entry.id,
      projectId: entry.projectId,
      notebookType: entry.notebookType || notebookType
    });
  }

  async function onAddAssayClick() {
    const entry = await ensureNotebookEntryForLinkedWork();
    if (!entry || typeof onCreateLinkedAssay !== 'function') {
      return;
    }
    onCreateLinkedAssay({
      notebookEntryId: entry.id,
      projectId: entry.projectId,
      notebookType: entry.notebookType || notebookType
    });
  }

  function onEntryListClick(event) {
    const entryButton = event?.target?.closest?.('[data-notebook-entry-id]')
      || (event?.target?.dataset?.notebookEntryId ? event.target : null);
    if (!entryButton) {
      return;
    }
    editEntry(entryButton.dataset.notebookEntryId);
  }

  function onExportButtonClick() {
    if (!editingEntryId) {
      return;
    }
    exportEntryPdf(editingEntryId);
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

  function renderProtocolViewer({ project, protocol, entry, isSavedEntry }) {
    notebookProtocolArea.hidden = false;
    if (notebookEmptyState) {
      notebookEmptyState.hidden = true;
    }

    notebookProtocolTitle.textContent = protocol.name;
    notebookProtocolMeta.textContent = buildViewerMeta(project, entry, isSavedEntry);
    if (notebookExportBtn) {
      notebookExportBtn.hidden = !entry;
    }
    if (notebookMarkExecutedBtn) {
      notebookMarkExecutedBtn.hidden = !entry || normalizeNotebookState(entry?.notebookState) !== 'planned';
    }

    const values = entry?.values || {};
    notebookSteps.innerHTML = protocol.steps.map((step, index) => {
      const sentenceHtml = renderStepSentence(step, values);
      return `
        <article class="card">
          <p class="notebook-step-line"><strong>Step ${index + 1}:</strong> ${sentenceHtml}</p>
        </article>
      `;
    }).join('');

    notebookResult.value = entry?.result || '';
    notebookResultFile.value = '';
    renderLinkedPreviews(entry);
    updateSaveButtonLabel();
    syncViewerVisibility();
  }

  function buildViewerMeta(project, entry, isSavedEntry) {
    if (entry) {
      const updatedAt = entry.updatedAt ? formatEntryTimestamp(entry.updatedAt) : 'Unknown time';
      const stateLabel = notebookStateLabel(entry);
      const executedAt = resolveEntryExecutedAt(entry)
        ? ` Executed at ${formatEntryTimestamp(resolveEntryExecutedAt(entry))}.`
        : '';
      const resultFiles = Array.isArray(entry.resultFiles) && entry.resultFiles.length
        ? ` Result files: ${entry.resultFiles.join(', ')}.`
        : '';
      return `${project.name} notebook page. State: ${stateLabel}. Updated ${updatedAt}.${executedAt}${resultFiles}`;
    }
    if (isSavedEntry) {
      return `${project.name} notebook page.`;
    }
    return `${project.name} protocol draft. Fill placeholders and results, then save this notebook page.`;
  }

  function clearViewer() {
    notebookProtocolArea.hidden = true;
    notebookSteps.innerHTML = '';
    notebookResult.value = '';
    notebookResultFile.value = '';
    notebookProtocolTitle.textContent = '';
    notebookProtocolMeta.textContent = 'Select a notebook page or start a new one.';
    if (notebookExportBtn) {
      notebookExportBtn.hidden = true;
    }
    if (notebookMarkExecutedBtn) {
      notebookMarkExecutedBtn.hidden = true;
    }
    editingEntryId = null;
    renderLinkedPreviews(null);
    updateSaveButtonLabel();
    syncViewerVisibility();
  }

  function syncViewerVisibility() {
    const hasViewer = !notebookProtocolArea.hidden;
    if (notebookEmptyState) {
      notebookEmptyState.hidden = hasViewer;
    }
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

  function markEntryExecuted() {
    if (!editingEntryId) {
      return;
    }
    const index = state.notebookEntries.findIndex((item) => item.id === editingEntryId && matchesNotebookType(item));
    if (index < 0) {
      return;
    }
    const currentEntry = state.notebookEntries[index];
    if (normalizeNotebookState(currentEntry?.notebookState) !== 'planned') {
      return;
    }

    const timestamp = new Date().toISOString();
    const nextEntry = {
      ...currentEntry,
      notebookState: 'executed',
      executedAt: timestamp,
      updatedAt: timestamp
    };
    state.notebookEntries[index] = nextEntry;
    persist();
    renderEntries();

    const project = state.projects.find((item) => item.id === nextEntry.projectId);
    const protocol = state.protocols.find((item) => item.id === nextEntry.protocolId);
    if (project && protocol) {
      renderProtocolViewer({
        project,
        protocol,
        entry: nextEntry,
        isSavedEntry: true
      });
    }
    if (typeof onNotebookEntriesChanged === 'function') {
      onNotebookEntriesChanged();
    }
  }

  function renderFilledStepText(step, values) {
    const source = String(step?.text || '');
    const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
    const matches = [...source.matchAll(PLACEHOLDER_TOKEN_REGEX)];

    if (!matches.length) {
      if (!placeholders.length) {
        return safeText(source);
      }
      return replaceBracketPlaceholders(source, placeholders, (placeholder) => {
        const key = `${step.id}:${placeholder.id}`;
        const rawValue = String(values[key] || '').trim();
        return safeText(rawValue || `[${placeholder.name}]`);
      });
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
      return replaceBracketPlaceholders(source, placeholders, (item) => {
        const key = `${step.id}:${item.id}`;
        return buildInlinePlaceholderHtml(key, item.name, values[key] || '');
      });
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

  function replaceBracketPlaceholders(source, placeholders, renderPlaceholder) {
    let placeholderIndex = 0;
    let replaced = false;
    const rendered = String(source || '').replace(/\[([^[\]]+)\]/g, (match) => {
      const placeholder = placeholders[placeholderIndex];
      if (!placeholder) {
        return match;
      }
      placeholderIndex += 1;
      replaced = true;
      return renderPlaceholder(placeholder);
    });

    if (replaced) {
      return rendered;
    }

    const trailing = placeholders.map((placeholder) => renderPlaceholder(placeholder)).join(' ');
    return `${safeText(source)} ${trailing}`.trim();
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

  return {
    renderProjectOptions,
    renderProtocolOptions,
    renderEntries,
    renderLinkedPreviews,
    onProtocolChange
  };
}
