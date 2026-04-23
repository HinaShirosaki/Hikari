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
import { buildClarifiedNotebookNote, clarifyNotebookNote, showTransientNotice } from './notebook-note-tools.js';
import {
  addNotebookResultTableColumn,
  addNotebookResultTableRow,
  cloneNotebookResultTable,
  createDefaultNotebookResultTable,
  normalizeNotebookResultTable,
  summarizeNotebookResultTable
} from './notebook-result-table.js';

// Initialize the biology notebook module and wire it to app state plus DOM controls.
export function initLabNotebook({
  state,
  persist,
  createId,
  safeText,
  onNotebookEntriesChanged,
  onCreateLinkedAssay,
  onCreateLinkedGel,
  selectionInsightsController = null,
  notebookType = 'biology'
}) {
  const PLACEHOLDER_TOKEN_REGEX = /\{\{ph:([^}]+)\}\}/g;
  const TabulatorLib = window.Tabulator || null;

  const notebookProjectSelect = document.getElementById('biology-notebook-project-select');
  const notebookProtocolSearchInput = document.getElementById('biology-notebook-protocol-search');
  const notebookProtocolSelect = document.getElementById('biology-notebook-protocol-select');
  const notebookEmptyState = document.getElementById('biology-notebook-empty-state');
  const notebookProtocolArea = document.getElementById('biology-notebook-protocol-area');
  const notebookExperimentName = document.getElementById('biology-notebook-experiment-name');
  const notebookProtocolTitle = document.getElementById('biology-notebook-protocol-title');
  const notebookProtocolMeta = document.getElementById('biology-notebook-protocol-meta');
  const notebookEditProtocolBtn = document.getElementById('biology-notebook-edit-protocol-btn');
  const notebookApplyProtocolEditBtn = document.getElementById('biology-notebook-apply-protocol-edit-btn');
  const notebookCancelProtocolEditBtn = document.getElementById('biology-notebook-cancel-protocol-edit-btn');
  const notebookExportBtn = document.getElementById('biology-notebook-export-btn');
  const notebookMarkExecutedBtn = document.getElementById('biology-notebook-mark-executed-btn');
  const notebookPageListStatus = document.getElementById('biology-notebook-page-list-status');
  const notebookProtocolEditor = document.getElementById('biology-notebook-protocol-editor');
  const notebookProtocolDraftName = document.getElementById('biology-notebook-page-protocol-name');
  const notebookProtocolDraftSteps = document.getElementById('biology-notebook-page-protocol-steps');
  const notebookSteps = document.getElementById('biology-notebook-steps');
  const notebookResult = document.getElementById('biology-notebook-result');
  const notebookResultFile = document.getElementById('biology-notebook-result-file');
  const notebookAddTableBtn = document.getElementById('biology-notebook-add-table-btn');
  const notebookAddTableRowBtn = document.getElementById('biology-notebook-add-table-row-btn');
  const notebookAddTableColumnBtn = document.getElementById('biology-notebook-add-table-column-btn');
  const notebookRemoveTableBtn = document.getElementById('biology-notebook-remove-table-btn');
  const notebookResultTableWrap = document.getElementById('biology-notebook-result-table-wrap');
  const notebookResultTableHost = document.getElementById('biology-notebook-result-table');
  const notebookResultTableStatus = document.getElementById('biology-notebook-result-table-status');
  const notebookAddGelBtn = document.getElementById('biology-notebook-add-gel-btn');
  const notebookAddAssayBtn = document.getElementById('biology-notebook-add-assay-btn');
  const notebookLinkedResults = document.getElementById('biology-notebook-linked-results');
  const saveNotebookBtn = document.getElementById('save-biology-notebook-btn');
  const clarifySaveNotebookBtn = document.getElementById('clarify-save-biology-notebook-btn');
  const cancelEditBtn = document.getElementById('cancel-biology-notebook-edit-btn');
  const notebookEntryList = document.getElementById('biology-notebook-entry-list');

  let editingEntryId = null;
  let viewerProtocolDraft = null;
  let isProtocolSnapshotEditing = false;
  const linkedPreviewCache = new Map();
  let linkedPreviewRenderToken = 0;
  let resultTableGrid = null;
  let resultTableDraft = null;

  function cloneSelectionInsights(insights) {
    try {
      return Array.isArray(insights)
        ? JSON.parse(JSON.stringify(
          insights.filter((item) => item && typeof item === 'object')
        ))
        : [];
    } catch {
      return [];
    }
  }

  function updateNotebookEntryRecord(entryId, updater) {
    const index = state.notebookEntries.findIndex((item) => item.id === entryId && matchesNotebookType(item));
    if (index < 0 || typeof updater !== 'function') {
      return null;
    }
    const nextEntry = updater(state.notebookEntries[index]);
    if (!nextEntry || typeof nextEntry !== 'object') {
      return null;
    }
    state.notebookEntries[index] = nextEntry;
    persist();
    return nextEntry;
  }

  function destroyResultTableGrid() {
    if (resultTableGrid && typeof resultTableGrid.destroy === 'function') {
      resultTableGrid.destroy();
    }
    resultTableGrid = null;
    if (notebookResultTableHost) {
      notebookResultTableHost.innerHTML = '';
    }
  }

  function getResultTableHeight(table) {
    const rowCount = Array.isArray(table?.rows) ? table.rows.length : 0;
    return `${Math.max(180, Math.min(420, 82 + (rowCount * 42)))}px`;
  }

  function setResultTableStatus(table, message = '') {
    if (!notebookResultTableStatus) {
      return;
    }
    if (message) {
      notebookResultTableStatus.textContent = message;
      return;
    }
    const summary = summarizeNotebookResultTable(table);
    notebookResultTableStatus.textContent = summary
      ? `Result table: ${summary}. Edit cells directly.`
      : 'Add a table to capture structured notebook results.';
  }

  function syncResultTableControls(table = null) {
    const hasTable = Boolean(table);
    if (notebookResultTableWrap) {
      notebookResultTableWrap.hidden = !hasTable;
    }
    if (notebookAddTableBtn) {
      notebookAddTableBtn.hidden = hasTable;
    }
    if (notebookAddTableRowBtn) {
      notebookAddTableRowBtn.hidden = !hasTable;
    }
    if (notebookAddTableColumnBtn) {
      notebookAddTableColumnBtn.hidden = !hasTable;
    }
    if (notebookRemoveTableBtn) {
      notebookRemoveTableBtn.hidden = !hasTable;
    }
  }

  function syncResultTableDraftFromGrid() {
    if (!resultTableGrid) {
      resultTableDraft = cloneNotebookResultTable(resultTableDraft);
      return resultTableDraft;
    }

    const columns = typeof resultTableGrid.getColumns === 'function'
      ? resultTableGrid.getColumns()
        .map((component, index) => {
          const field = String(component?.getField?.() || '').trim();
          if (!field) {
            return null;
          }
          const definition = component?.getDefinition?.() || {};
          return {
            field,
            title: String(definition?.title || '').trim() || `Column ${index + 1}`
          };
        })
        .filter(Boolean)
      : [];
    const rows = typeof resultTableGrid.getData === 'function'
      ? resultTableGrid.getData().map((rawRow, index) => {
        const row = {
          id: String(rawRow?.id || '').trim() || `row_${index + 1}`
        };
        columns.forEach((column) => {
          row[column.field] = String(rawRow?.[column.field] ?? '');
        });
        return row;
      })
      : [];

    resultTableDraft = normalizeNotebookResultTable({
      columns,
      rows
    });
    return cloneNotebookResultTable(resultTableDraft);
  }

  function handleResultTableEdited() {
    const table = syncResultTableDraftFromGrid();
    setResultTableStatus(table);
  }

  function renderResultTableEditor(rawTable = null) {
    resultTableDraft = cloneNotebookResultTable(rawTable);
    destroyResultTableGrid();
    syncResultTableControls(resultTableDraft);
    setResultTableStatus(resultTableDraft);

    if (!resultTableDraft || !notebookResultTableHost) {
      return;
    }

    if (!TabulatorLib) {
      notebookResultTableHost.innerHTML = '<p class="small-note">Table editing is unavailable because Tabulator did not load.</p>';
      setResultTableStatus(resultTableDraft, 'Table data is saved, but the Tabulator editor is unavailable right now.');
      return;
    }

    resultTableGrid = new TabulatorLib(notebookResultTableHost, {
      data: resultTableDraft.rows.map((row) => ({ ...row })),
      columns: resultTableDraft.columns.map((column) => ({
        title: column.title,
        field: column.field,
        editor: 'input',
        headerSort: false,
        resizable: true
      })),
      index: 'id',
      height: getResultTableHeight(resultTableDraft),
      layout: 'fitColumns',
      reactiveData: false,
      placeholder: 'Use Add row / Add column to shape this notebook table.',
      cellEdited: handleResultTableEdited
    });
  }

  function getCurrentResultTable() {
    return syncResultTableDraftFromGrid();
  }

  function onAddResultTableClick() {
    if (resultTableDraft) {
      return;
    }
    renderResultTableEditor(createDefaultNotebookResultTable(createId));
  }

  function onAddResultTableRowClick() {
    renderResultTableEditor(addNotebookResultTableRow(getCurrentResultTable(), createId));
  }

  function onAddResultTableColumnClick() {
    renderResultTableEditor(addNotebookResultTableColumn(getCurrentResultTable(), createId));
  }

  function onRemoveResultTableClick() {
    renderResultTableEditor(null);
  }

  notebookProjectSelect.addEventListener('change', onProjectChange);
  notebookProtocolSearchInput?.addEventListener('input', onProtocolSearchInput);
  notebookProtocolSelect.addEventListener('change', onProtocolChange);
  notebookEditProtocolBtn?.addEventListener('click', beginProtocolEdit);
  notebookApplyProtocolEditBtn?.addEventListener('click', applyProtocolEdit);
  notebookCancelProtocolEditBtn?.addEventListener('click', cancelProtocolEdit);
  saveNotebookBtn.addEventListener('click', () => {
    void saveEntry();
  });
  clarifySaveNotebookBtn?.addEventListener('click', () => {
    void clarifyAndSaveEntry();
  });
  notebookAddTableBtn?.addEventListener('click', onAddResultTableClick);
  notebookAddTableRowBtn?.addEventListener('click', onAddResultTableRowClick);
  notebookAddTableColumnBtn?.addEventListener('click', onAddResultTableColumnClick);
  notebookRemoveTableBtn?.addEventListener('click', onRemoveResultTableClick);
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
  renderResultTableEditor(null);

  function onProjectChange() {
    editingEntryId = null;
    clearProtocolPageCopyDraft();
    updateSaveButtonLabel();
    renderProtocolOptions();
    renderEntries();
  }

  function onProtocolSearchInput() {
    renderProtocolOptions();
  }

  function buildNotebookFolderPath(projectName, protocolName, entryId) {
    const rootPath = state.settings.storagePath.trim();
    if (!rootPath) {
      return '';
    }
    const safeProject = sanitizeFolderName(projectName);
    const safeProtocol = sanitizeFolderName(protocolName || 'Notebook_Page');
    const safeEntryId = sanitizeFolderName(entryId || 'page');
    return `${rootPath}/Project/${safeProject || 'Untitled_Project'}/Notebook/${safeProtocol || 'Notebook_Page'}__${safeEntryId}`;
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

  function cloneProtocolSnapshot(protocol) {
    if (!protocol || typeof protocol !== 'object') {
      return null;
    }
    const protocolId = String(protocol.id || '').trim();
    return {
      id: protocolId,
      name: String(protocol.name || '').trim() || 'Untitled Protocol',
      category: String(protocol.category || '').trim(),
      purpose: String(protocol.purpose || '').trim(),
      steps: Array.isArray(protocol.steps)
        ? protocol.steps.map((step, index) => {
          const stepId = String(step?.id || '').trim() || `${protocolId || 'protocol'}_step_${index + 1}`;
          return {
            id: stepId,
            text: String(step?.text || '').trim(),
            placeholders: Array.isArray(step?.placeholders)
              ? step.placeholders.map((placeholder, placeholderIndex) => ({
                id: String(placeholder?.id || '').trim() || `${stepId}_placeholder_${placeholderIndex + 1}`,
                name: String(placeholder?.name || '').trim() || `Value ${placeholderIndex + 1}`
              }))
              : []
          };
        })
        : []
    };
  }

  function resolveEntryProject(entry) {
    const liveProject = state.projects.find((item) => item.id === entry?.projectId) || null;
    if (liveProject) {
      return liveProject;
    }
    const fallbackName = String(entry?.projectName || '').trim() || 'Untitled Project';
    return {
      id: String(entry?.projectId || '').trim(),
      name: fallbackName
    };
  }

  function resolveEntryProtocol(entry) {
    const snapshot = cloneProtocolSnapshot(entry?.protocolSnapshot);
    if (snapshot) {
      return snapshot;
    }
    const liveProtocol = state.protocols.find((item) => item.id === entry?.protocolId) || null;
    if (liveProtocol) {
      return liveProtocol;
    }
    const fallbackName = String(entry?.protocolName || entry?.workflowContext?.workflowBlockTitle || '').trim();
    if (!fallbackName) {
      return null;
    }
    return {
      id: String(entry?.protocolId || entry?.id || '').trim(),
      name: fallbackName,
      steps: []
    };
  }

  function resolveEntryExperimentName(entry, fallbackProtocol = null) {
    const experimentName = String(entry?.experimentName || '').trim();
    if (experimentName) {
      return experimentName;
    }
    const protocolName = String(
      fallbackProtocol?.name
      || entry?.protocolName
      || entry?.workflowContext?.workflowBlockTitle
      || ''
    ).trim();
    return protocolName || 'Untitled Page';
  }

  function resolveEntryCollectionName(entry) {
    const workflowEntryName = String(entry?.workflowContext?.workflowEntryName || '').trim();
    if (workflowEntryName) {
      return workflowEntryName;
    }
    const workflowName = String(entry?.workflowContext?.workflowName || '').trim();
    if (workflowName) {
      return workflowName;
    }
    const liveProject = state.projects.find((item) => item.id === entry?.projectId) || null;
    if (liveProject?.name) {
      return liveProject.name;
    }
    const projectName = String(entry?.projectName || '').trim();
    if (projectName) {
      return projectName;
    }
    return 'Untitled Project';
  }

  function findSelectedProject() {
    return state.projects.find((item) => item.id === notebookProjectSelect.value) || null;
  }

  function findSelectedProtocol() {
    return state.protocols.find((item) => item.id === notebookProtocolSelect.value) || null;
  }

  function resolveViewerProject(entry = null) {
    return entry ? resolveEntryProject(entry) : findSelectedProject();
  }

  function resolveViewerProtocol(entry = null) {
    if (viewerProtocolDraft) {
      return viewerProtocolDraft;
    }
    return entry ? resolveEntryProtocol(entry) : findSelectedProtocol();
  }

  function collectNotebookValues() {
    const values = {};
    notebookSteps.querySelectorAll('[data-nb-key]').forEach((input) => {
      values[input.dataset.nbKey] = input.value.trim();
    });
    return values;
  }

  function mergeNotebookValues(existingValues, currentValues) {
    const baseValues = existingValues && typeof existingValues === 'object' ? existingValues : {};
    const liveValues = currentValues && typeof currentValues === 'object' ? currentValues : {};
    return {
      ...baseValues,
      ...liveValues
    };
  }

  function clearProtocolPageCopyDraft({ preserveDraft = false } = {}) {
    isProtocolSnapshotEditing = false;
    if (!preserveDraft) {
      viewerProtocolDraft = null;
    }
    if (notebookProtocolDraftName) {
      notebookProtocolDraftName.value = '';
    }
    if (notebookProtocolDraftSteps) {
      notebookProtocolDraftSteps.value = '';
    }
  }

  function stripNotebookStepBulletPrefix(rawLine) {
    return String(rawLine || '')
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
      .trim();
  }

  function formatProtocolStepLineForEditor(step) {
    const source = String(step?.text || '');
    const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
    const matches = [...source.matchAll(PLACEHOLDER_TOKEN_REGEX)];

    if (!matches.length) {
      if (!placeholders.length) {
        return source.trim();
      }

      let placeholderIndex = 0;
      let replaced = false;
      const rendered = source.replace(/\[([^[\]]+)\]/g, (match) => {
        const placeholder = placeholders[placeholderIndex];
        if (!placeholder) {
          return match;
        }
        placeholderIndex += 1;
        replaced = true;
        return `[${String(placeholder?.name || '').trim() || 'value'}]`;
      });

      if (replaced) {
        return rendered.trim();
      }

      const trailing = placeholders
        .map((placeholder) => `[${String(placeholder?.name || '').trim() || 'value'}]`)
        .join(' ');
      return `${source} ${trailing}`.trim();
    }

    let cursor = 0;
    let line = '';

    matches.forEach((match) => {
      const index = Number(match.index || 0);
      const placeholderId = String(match[1] || '').trim();
      const placeholder = placeholders.find((item) => String(item?.id || '').trim() === placeholderId);
      line += source.slice(cursor, index);
      line += `[${String(placeholder?.name || '').trim() || 'value'}]`;
      cursor = index + match[0].length;
    });

    line += source.slice(cursor);
    return line.trim();
  }

  function formatProtocolStepsForEditor(protocol) {
    const steps = Array.isArray(protocol?.steps) ? protocol.steps : [];
    return steps
      .map((step) => formatProtocolStepLineForEditor(step))
      .filter(Boolean)
      .map((line) => `• ${line}`)
      .join('\n');
  }

  function buildEditedProtocolStep(rawLine, baseStep, stepIndex) {
    const line = stripNotebookStepBulletPrefix(rawLine);
    const stepId = String(baseStep?.id || '').trim() || createId();
    const existingPlaceholders = Array.isArray(baseStep?.placeholders)
      ? baseStep.placeholders
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => ({
          id: String(item?.id || '').trim() || `${stepId}_placeholder_${index + 1}`,
          name: String(item?.name || '').trim()
        }))
      : [];
    const usedPlaceholderIds = new Set();
    const placeholders = [];
    const text = line.replace(/\[([^[\]]*)\]/g, (_match, rawName) => {
      const placeholderName = String(rawName || '').trim() || 'value';
      const expectedIndex = placeholders.length;
      const normalizedName = placeholderName.toLowerCase();
      const exactMatch = existingPlaceholders.find((item) => (
        item.id
        && !usedPlaceholderIds.has(item.id)
        && String(item.name || '').trim().toLowerCase() === normalizedName
      ));
      const positionalMatch = existingPlaceholders[expectedIndex];
      const placeholderId = exactMatch?.id
        || (positionalMatch?.id && !usedPlaceholderIds.has(positionalMatch.id) ? positionalMatch.id : '')
        || createId();
      usedPlaceholderIds.add(placeholderId);
      placeholders.push({
        id: placeholderId,
        name: placeholderName
      });
      return `{{ph:${placeholderId}}}`;
    }).replace(/\s+/g, ' ').trim();

    return {
      id: stepId || `${String(baseStep?.id || '').trim() || 'protocol'}_step_${stepIndex + 1}`,
      text,
      placeholders
    };
  }

  function buildEditedProtocolSnapshot(baseProtocol) {
    const fallbackProtocol = cloneProtocolSnapshot(baseProtocol) || {
      id: String(baseProtocol?.id || '').trim(),
      name: String(baseProtocol?.name || '').trim() || 'Untitled Protocol',
      category: String(baseProtocol?.category || '').trim(),
      purpose: String(baseProtocol?.purpose || '').trim(),
      steps: []
    };
    const rawName = String(notebookProtocolDraftName?.value || '').trim();
    const rawLines = String(notebookProtocolDraftSteps?.value || '').replace(/\r\n?/g, '\n').split('\n');
    const nextSteps = rawLines
      .map((line) => stripNotebookStepBulletPrefix(line))
      .filter(Boolean)
      .map((line, index) => buildEditedProtocolStep(line, fallbackProtocol.steps[index], index));

    return {
      ...fallbackProtocol,
      name: rawName || fallbackProtocol.name || 'Untitled Protocol',
      steps: nextSteps
    };
  }

  function pruneNotebookValuesForProtocol(values, protocol) {
    const allowedKeys = new Set();
    const sourceValues = values && typeof values === 'object' ? values : {};
    (Array.isArray(protocol?.steps) ? protocol.steps : []).forEach((step) => {
      const stepId = String(step?.id || '').trim();
      if (!stepId) {
        return;
      }
      (Array.isArray(step?.placeholders) ? step.placeholders : []).forEach((placeholder) => {
        const placeholderId = String(placeholder?.id || '').trim();
        if (placeholderId) {
          allowedKeys.add(`${stepId}:${placeholderId}`);
        }
      });
    });

    return Object.entries(sourceValues).reduce((accumulator, [key, rawValue]) => {
      if (!allowedKeys.has(key)) {
        return accumulator;
      }
      accumulator[key] = String(rawValue || '').trim();
      return accumulator;
    }, {});
  }

  function shouldSyncExperimentNameWithProtocol(currentName, previousProtocolName) {
    const normalizedCurrent = String(currentName || '').trim();
    const normalizedPrevious = String(previousProtocolName || '').trim();
    return !normalizedCurrent || normalizedCurrent === normalizedPrevious;
  }

  function syncProtocolEditorControls(protocol = null, entry = null) {
    const hasProtocol = Boolean(protocol) && !notebookProtocolArea.hidden;

    if (notebookProtocolEditor) {
      notebookProtocolEditor.hidden = !hasProtocol || !isProtocolSnapshotEditing;
    }
    if (notebookSteps) {
      notebookSteps.hidden = Boolean(hasProtocol && isProtocolSnapshotEditing);
    }
    if (notebookEditProtocolBtn) {
      notebookEditProtocolBtn.hidden = !hasProtocol || isProtocolSnapshotEditing;
    }
    if (notebookApplyProtocolEditBtn) {
      notebookApplyProtocolEditBtn.hidden = !hasProtocol || !isProtocolSnapshotEditing;
    }
    if (notebookCancelProtocolEditBtn) {
      notebookCancelProtocolEditBtn.hidden = !hasProtocol || !isProtocolSnapshotEditing;
    }
    if (notebookExportBtn) {
      notebookExportBtn.hidden = !entry || isProtocolSnapshotEditing;
    }
    if (notebookMarkExecutedBtn) {
      notebookMarkExecutedBtn.hidden = !entry
        || normalizeNotebookState(entry?.notebookState) !== 'planned'
        || isProtocolSnapshotEditing;
    }
  }

  function beginProtocolEdit() {
    const entry = getActiveEntry();
    const protocol = cloneProtocolSnapshot(resolveViewerProtocol(entry));
    if (!protocol) {
      return;
    }

    viewerProtocolDraft = protocol;
    if (notebookProtocolDraftName) {
      notebookProtocolDraftName.value = protocol.name;
    }
    if (notebookProtocolDraftSteps) {
      notebookProtocolDraftSteps.value = formatProtocolStepsForEditor(protocol);
    }
    isProtocolSnapshotEditing = true;
    syncProtocolEditorControls(protocol, entry);
  }

  function cancelProtocolEdit() {
    isProtocolSnapshotEditing = false;
    const entry = getActiveEntry();
    syncProtocolEditorControls(resolveViewerProtocol(entry), entry);
  }

  function applyProtocolEdit() {
    const entry = getActiveEntry();
    const project = resolveViewerProject(entry);
    const currentProtocol = resolveViewerProtocol(entry);
    if (!project || !currentProtocol) {
      return;
    }

    const nextProtocol = buildEditedProtocolSnapshot(currentProtocol);
    const shouldSyncExperimentName = shouldSyncExperimentNameWithProtocol(
      notebookExperimentName?.value,
      currentProtocol.name
    );
    const nextExperimentName = shouldSyncExperimentName
      ? nextProtocol.name
      : String(notebookExperimentName?.value || '').trim();

    if (notebookExperimentName && shouldSyncExperimentName) {
      notebookExperimentName.value = nextProtocol.name;
    }

    isProtocolSnapshotEditing = false;

    if (!entry) {
      const resultTable = getCurrentResultTable();
      viewerProtocolDraft = cloneProtocolSnapshot(nextProtocol);
      renderProtocolViewer({
        project,
        protocol: nextProtocol,
        entry: null,
        isSavedEntry: false,
        experimentNameOverride: nextExperimentName,
        resultTableOverride: resultTable,
        preserveSelectedFiles: true
      });
      updatePageListStatus();
      return;
    }

    const nextEntry = {
      ...entry,
      protocolId: String(nextProtocol.id || entry.protocolId || '').trim(),
      protocolName: nextProtocol.name,
      experimentName: nextExperimentName || resolveEntryExperimentName(entry, nextProtocol),
      protocolSnapshot: cloneProtocolSnapshot(nextProtocol),
      values: pruneNotebookValuesForProtocol(
        mergeNotebookValues(entry?.values, collectNotebookValues()),
        nextProtocol
      ),
      result: String(notebookResult.value || '').trim(),
      resultTable: getCurrentResultTable(),
      updatedAt: new Date().toISOString()
    };
    const index = state.notebookEntries.findIndex((item) => item.id === entry.id && matchesNotebookType(item));
    if (index < 0) {
      return;
    }

    state.notebookEntries[index] = nextEntry;
    viewerProtocolDraft = null;
    persist();
    renderEntries();
    renderProtocolViewer({
      project,
      protocol: nextProtocol,
      entry: nextEntry,
      isSavedEntry: true,
      preserveSelectedFiles: true
    });
    if (typeof onNotebookEntriesChanged === 'function') {
      onNotebookEntriesChanged();
    }
  }

  function onProtocolChange() {
    clearProtocolPageCopyDraft();
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
      protocol: selectedEntry ? (resolveEntryProtocol(selectedEntry) || protocol) : protocol,
      entry: selectedEntry,
      isSavedEntry: Boolean(selectedEntry)
    });
    renderEntries();
  }

  async function saveEntry(options = {}) {
    const editingEntry = editingEntryId
      ? state.notebookEntries.find((item) => item.id === editingEntryId && matchesNotebookType(item))
      : null;
    const project = resolveViewerProject(editingEntry);
    const selectedProtocol = findSelectedProtocol();
    const baseProtocol = resolveViewerProtocol(editingEntry) || selectedProtocol;
    const protocol = isProtocolSnapshotEditing
      ? buildEditedProtocolSnapshot(baseProtocol)
      : (cloneProtocolSnapshot(baseProtocol) || cloneProtocolSnapshot(editingEntry?.protocolSnapshot) || null);

    if (!project || !protocol) {
      return null;
    }

    const values = pruneNotebookValuesForProtocol(
      mergeNotebookValues(editingEntry?.values, collectNotebookValues()),
      protocol
    );
    const entryId = editingEntry?.id || createId();
    const selectedResultFiles = Array.from(notebookResultFile.files || []);
    const existingResultFiles = Array.isArray(editingEntry?.resultFiles)
      ? editingEntry.resultFiles.map((name) => String(name || '').trim()).filter(Boolean)
      : [];
    const existingResultFileRecords = Array.isArray(editingEntry?.resultFileRecords)
      ? editingEntry.resultFileRecords
        .filter((record) => record && typeof record === 'object')
        .map((record) => ({ ...record }))
      : [];
    const storageFolder = editingEntry?.storageFolder || buildNotebookFolderPath(project.name, protocol.name, entryId);

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
    const resultText = String(options.resultText ?? notebookResult.value).trim();
    const resultTable = getCurrentResultTable();
    const currentExperimentName = String(notebookExperimentName?.value || '').trim();
    const baseProtocolName = String(baseProtocol?.name || '').trim();
    const experimentName = shouldSyncExperimentNameWithProtocol(currentExperimentName, baseProtocolName)
      ? protocol.name
      : (currentExperimentName || protocol.name);
    const entry = {
      id: entryId,
      notebookType,
      projectId: project.id,
      projectName: project.name,
      protocolId: String(protocol.id || editingEntry?.protocolId || '').trim(),
      protocolName: protocol.name,
      experimentName,
      protocolSnapshot: cloneProtocolSnapshot(protocol) || cloneProtocolSnapshot(editingEntry?.protocolSnapshot),
      values,
      result: resultText,
      resultTable,
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
        : {},
      selectionInsights: cloneSelectionInsights(editingEntry?.selectionInsights)
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
    viewerProtocolDraft = null;
    isProtocolSnapshotEditing = false;
    updateSaveButtonLabel();

    persist();
    notebookResultFile.value = '';
    renderEntries();
    renderProtocolViewer({
      project,
      protocol: cloneProtocolSnapshot(protocol) || protocol,
      entry,
      isSavedEntry: true
    });
    if (typeof onNotebookEntriesChanged === 'function') {
      onNotebookEntriesChanged();
    }
    return entry;
  }

  async function clarifyAndSaveEntry() {
    const source = String(notebookResult.value || '').trim();
    if (!source) {
      showTransientNotice('Add notebook notes before clarifying them.', { type: 'error' });
      return;
    }
    setNotebookSaveBusy(true, { clarify: true });
    try {
      const clarified = await clarifyNotebookNote({
        llm: state.settings?.llm,
        text: source
      });
      const combinedNote = buildClarifiedNotebookNote(source, clarified);
      notebookResult.value = combinedNote;
      const savedEntry = await saveEntry({
        resultText: combinedNote
      });
      if (!savedEntry) {
        throw new Error('Unable to save the clarified notebook entry.');
      }
      showTransientNotice('Clarified note saved.');
    } catch (error) {
      showTransientNotice(String(error?.message || error || 'Failed to clarify the notebook entry.'), {
        type: 'error'
      });
    } finally {
      setNotebookSaveBusy(false);
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

    updatePageListStatus();
  }

  function renderProtocolOptions(preferredProtocolId = '', options = {}) {
    const projectId = notebookProjectSelect.value;
    const selected = preferredProtocolId || notebookProtocolSelect.value;
    const hasProject = Boolean(state.projects.find((item) => item.id === projectId));
    const searchTerm = String(notebookProtocolSearchInput?.value || '').trim().toLowerCase();
    const optionMarkup = ['<option value="">Select protocol</option>'];
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
      optionMarkup.push(`<option value="${protocol.id}"${isSelected}>${safeText(protocol.name)}</option>`);
    });

    notebookProtocolSelect.innerHTML = optionMarkup.join('');
    notebookProtocolSelect.disabled = !hasProject;

    if (hasProject && selected && filteredProtocols.some((protocol) => protocol.id === selected)) {
      notebookProtocolSelect.value = selected;
    }

    updatePageListStatus();
    if (options.triggerChange !== false) {
      onProtocolChange();
    }
  }

  function renderEntries() {
    const entries = state.notebookEntries
      .filter((entry) => matchesNotebookType(entry))
      .slice()
      .sort((left, right) => {
        const collectionCompare = resolveEntryCollectionName(left)
          .localeCompare(resolveEntryCollectionName(right));
        if (collectionCompare !== 0) {
          return collectionCompare;
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
      const workflowEntryId = String(entry?.workflowContext?.workflowEntryId || '').trim();
      const workflowName = String(entry?.workflowContext?.workflowName || '').trim();
      const isWorkflowEntry = Boolean(workflowEntryId || workflowName);
      const groupName = resolveEntryCollectionName(entry);
      const groupKey = isWorkflowEntry
        ? `__workflow__:${workflowEntryId || workflowName || entry.id}`
        : (entry.projectId || `__project__:${groupName}`);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          groupName,
          groupClass: isWorkflowEntry
            ? 'biology-notebook-folder--workflow'
            : 'biology-notebook-folder--project',
          itemClass: isWorkflowEntry
            ? 'biology-notebook-folder-item--workflow'
            : 'biology-notebook-folder-item--project',
          entries: []
        });
      }
      groups.get(groupKey).entries.push(entry);
    });

    notebookEntryList.innerHTML = Array.from(groups.values()).map((group) => {
      const entryButtons = group.entries.map((entry) => {
        const isActive = entry.id === editingEntryId ? ' is-active' : '';
        const stateLabel = notebookStateLabel(entry);
        const stateClass = normalizeNotebookState(entry?.notebookState) === 'planned'
          ? ' is-planned'
          : ' is-executed';
        return `
          <button
            type="button"
            class="biology-notebook-page-row${isActive}${stateClass}"
            data-notebook-entry-id="${safeText(entry.id)}"
          >
            <span class="biology-notebook-page-name">${safeText(resolveEntryExperimentName(entry))}</span>
            <span class="biology-notebook-page-badge">${safeText(stateLabel)}</span>
          </button>
        `;
      }).join('');

      return `
        <details class="biology-notebook-folder ${group.groupClass}" open>
          <summary class="biology-notebook-folder-item ${group.itemClass}">
            <span class="biology-notebook-folder-glyph" aria-hidden="true"></span>
            <span class="biology-notebook-folder-name">${safeText(group.groupName)}</span>
          </summary>
          <div class="biology-notebook-folder-children biology-notebook-folder-children--pages">
            ${entryButtons}
          </div>
        </details>
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
    const protocol = viewerProtocolDraft || state.protocols.find((item) => item.id === notebookProtocolSelect.value);

    if (project && protocol) {
      notebookPageListStatus.textContent = `Working in ${project.name} / ${protocol.name}`;
      return;
    }
    if (project) {
      notebookPageListStatus.textContent = `Viewing pages for ${project.name}`;
      return;
    }
    const activeEntry = getActiveEntry();
    if (activeEntry) {
      const activeCollectionName = resolveEntryCollectionName(activeEntry);
      const activeProtocol = resolveEntryProtocol(activeEntry);
      if (activeCollectionName && activeProtocol?.name) {
        notebookPageListStatus.textContent = `Viewing page for ${activeCollectionName} / ${activeProtocol.name}`;
        return;
      }
      if (activeProtocol?.name) {
        notebookPageListStatus.textContent = `Viewing ${activeProtocol.name}`;
        return;
      }
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

  async function resolveLinkedAssayPlotImage(assay) {
    const latestAnalysis = assay?.latestAnalysis && typeof assay.latestAnalysis === 'object'
      ? assay.latestAnalysis
      : null;
    const chartDataUrl = String(latestAnalysis?.chartDataUrl || '').trim();
    if (chartDataUrl) {
      return chartDataUrl;
    }

    const chartPath = String(latestAnalysis?.chartPath || '').trim();
    if (!chartPath) {
      return '';
    }
    if (linkedPreviewCache.has(chartPath)) {
      return linkedPreviewCache.get(chartPath);
    }
    if (!window.enanaApi?.readFileBase64) {
      return '';
    }

    const response = await window.enanaApi.readFileBase64(chartPath);
    if (!response?.ok || !response.dataBase64) {
      return '';
    }
    const normalizedPath = chartPath.toLowerCase();
    const mimeType = normalizedPath.endsWith('.svg')
      ? 'image/svg+xml'
      : normalizedPath.endsWith('.jpg') || normalizedPath.endsWith('.jpeg')
        ? 'image/jpeg'
        : normalizedPath.endsWith('.webp')
          ? 'image/webp'
          : 'image/png';
    const dataUrl = `data:${mimeType};base64,${response.dataBase64}`;
    linkedPreviewCache.set(chartPath, dataUrl);
    return dataUrl;
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
    const serialDilutionSummary = assay?.serialDilutionSummary && typeof assay.serialDilutionSummary === 'object'
      ? assay.serialDilutionSummary
      : null;
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
    const hasSerialDilutionContent = Boolean(
      serialDilutionSummary
      && (
        (Array.isArray(serialDilutionSummary.feedbackMessages) && serialDilutionSummary.feedbackMessages.length)
        || (Array.isArray(serialDilutionSummary.initialDilutionRows) && serialDilutionSummary.initialDilutionRows.length)
        || (Array.isArray(serialDilutionSummary.followingDilutionRows) && serialDilutionSummary.followingDilutionRows.length)
        || serialDilutionSummary.hasValidPlans
      )
    );
    const renderSerialDilutionTable = (headers, rows, className = '') => {
      if (!rows.length) {
        return '';
      }
      return `
        <div class="assay-serial-dilution-table-wrap">
          <table class="assay-serial-dilution-table ${className}">
            <thead>
              <tr>
                ${headers.map((header) => `<th>${safeText(header)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map((cells) => `
                <tr>
                  ${cells.map((cell) => `<td>${safeText(cell)}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    };
    const serialDilutionHtml = hasSerialDilutionContent
      ? `
        <section class="biology-notebook-linked-assay-serial-dilution">
          <div class="biology-notebook-linked-assay-serial-dilution-head">
            <h5>Serial Dilution</h5>
            ${Number.isFinite(serialDilutionSummary?.volumePerWellUl) && serialDilutionSummary.volumePerWellUl > 0
              ? `<span class="small-note">${safeText(`Volume per well: ${serialDilutionSummary.volumePerWellUl} uL`)}</span>`
              : ''}
          </div>
          ${(Array.isArray(serialDilutionSummary.feedbackMessages) ? serialDilutionSummary.feedbackMessages : []).map((item) => `
            <p class="small-note ${item?.type === 'error' ? 'assay-serial-dilution-error' : 'assay-serial-dilution-note'}">${safeText(String(item?.text || ''))}</p>
          `).join('')}
          ${Array.isArray(serialDilutionSummary.initialDilutionRows) && serialDilutionSummary.initialDilutionRows.length
            ? `
              <div class="biology-notebook-linked-assay-serial-dilution-block">
                <p class="small-note">Initial dilution</p>
                ${renderSerialDilutionTable(
                  ['Sample', 'Stock Vol.', 'Buffer Vol.'],
                  serialDilutionSummary.initialDilutionRows.map((row) => [
                    row?.sample || '',
                    row?.stockVolume || '',
                    row?.bufferVolume || ''
                  ]),
                  'assay-serial-dilution-table-compact'
                )}
              </div>
            `
            : ''}
          ${Array.isArray(serialDilutionSummary.followingDilutionRows) && serialDilutionSummary.followingDilutionRows.length
            ? `
              <div class="biology-notebook-linked-assay-serial-dilution-block">
                <p class="small-note">Following dilution</p>
                ${renderSerialDilutionTable(
                  ['Step', 'Target Conc.', 'From Previous Well', 'Buffer Vol.', 'Transfer / Discard', 'Final Vol.'],
                  serialDilutionSummary.followingDilutionRows.map((row) => [
                    row?.step || '',
                    row?.targetConcentration || '',
                    row?.fromPreviousWell || '',
                    row?.bufferVolume || '',
                    row?.transferOrDiscard || '',
                    row?.finalVolume || ''
                  ])
                )}
              </div>
            `
            : serialDilutionSummary?.hasValidPlans
              ? '<p class="small-note">No downstream dilution steps are needed for this assay.</p>'
              : ''}
        </section>
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
          ${serialDilutionHtml}
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
    const gelName = String(notebookExperimentName?.value || '').trim() || resolveEntryExperimentName(entry);
    onCreateLinkedGel({
      notebookEntryId: entry.id,
      projectId: entry.projectId,
      notebookType: entry.notebookType || notebookType,
      gelName
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
    void exportEntryPdf(editingEntryId);
  }

  async function exportEntryPdf(entryId) {
    const entry = state.notebookEntries.find((item) => item.id === entryId && matchesNotebookType(item));
    if (!entry) {
      return;
    }
    const protocol = resolveEntryProtocol(entry);
    const linkedGel = findLatestLinkedRecord(state.gelAnalyses, entry.id);
    const linkedAssay = findLatestLinkedRecord(state.assays, entry.id);
    const [linkedGelPreviewImage, linkedAssayPlotImage] = await Promise.all([
      linkedGel ? resolveLinkedGelPreviewImage(linkedGel) : Promise.resolve(''),
      linkedAssay ? resolveLinkedAssayPlotImage(linkedAssay) : Promise.resolve('')
    ]);
    await exportNotebookEntryPdf({
      entry,
      protocol,
      linkedGel,
      linkedGelPreviewImage,
      linkedAssay,
      linkedAssayPlotImage
    });
  }

  function editEntry(entryId) {
    const entry = state.notebookEntries.find((item) => item.id === entryId && matchesNotebookType(item));
    if (!entry) {
      return;
    }

    editingEntryId = entry.id;
    clearProtocolPageCopyDraft();
    const project = resolveEntryProject(entry);
    const protocol = resolveEntryProtocol(entry);
    const hasLiveProject = Boolean(project?.id && state.projects.some((item) => item.id === project.id));
    const hasLiveProtocol = Boolean(protocol?.id && state.protocols.some((item) => item.id === protocol.id));

    notebookProjectSelect.value = hasLiveProject ? project.id : '';
    renderProtocolOptions(hasLiveProtocol ? protocol.id : '', { triggerChange: false });

    if (!project || !protocol) {
      clearViewer();
      renderEntries();
      updatePageListStatus();
      return;
    }

    if (hasLiveProject && hasLiveProtocol) {
      onProtocolChange();
      return;
    }

    renderProtocolViewer({
      project,
      protocol,
      entry,
      isSavedEntry: true
    });
    renderEntries();
    updatePageListStatus();
  }

  function renderProtocolViewer({
    project,
    protocol,
    entry,
    isSavedEntry,
    experimentNameOverride = '',
    resultTableOverride = null,
    preserveSelectedFiles = false
  }) {
    notebookProtocolArea.hidden = false;
    if (notebookEmptyState) {
      notebookEmptyState.hidden = true;
    }

    if (notebookExperimentName) {
      notebookExperimentName.value = String(experimentNameOverride || '').trim() || resolveEntryExperimentName(entry, protocol);
    }
    notebookProtocolTitle.textContent = protocol.name;
    notebookProtocolMeta.textContent = buildViewerMeta(project, entry, isSavedEntry);

    const values = entry?.values || {};
    notebookSteps.innerHTML = protocol.steps.map((step, index) => {
      const sentenceHtml = renderStepSentence(step, values);
      return `
        <article class="card">
          <p class="notebook-step-line"><strong>Step ${index + 1}:</strong> <span class="notebook-step-content" data-selection-segment-id="notebook:step:${safeText(String(step?.id || `step_${index + 1}`))}" data-selection-segment-label="Step ${index + 1}">${sentenceHtml}</span></p>
        </article>
      `;
    }).join('');

    notebookResult.value = entry?.result || '';
    renderResultTableEditor(resultTableOverride ?? entry?.resultTable ?? null);
    if (!preserveSelectedFiles) {
      notebookResultFile.value = '';
    }
    renderLinkedPreviews(entry);
    updateSaveButtonLabel();
    syncProtocolEditorControls(protocol, entry);
    syncViewerVisibility();
    selectionInsightsController?.refreshHost?.('biology-notebook-protocol');
  }

  function buildViewerMeta(project, entry, isSavedEntry) {
    const contextLabel = entry
      ? `${resolveEntryCollectionName(entry)} / ${resolveEntryExperimentName(entry)}`
      : String(project?.name || '').trim() || 'Untitled Project';
    if (entry) {
      const updatedAt = entry.updatedAt ? formatEntryTimestamp(entry.updatedAt) : 'Unknown time';
      const stateLabel = notebookStateLabel(entry);
      const executedAt = resolveEntryExecutedAt(entry)
        ? ` Executed at ${formatEntryTimestamp(resolveEntryExecutedAt(entry))}.`
        : '';
      const resultFiles = Array.isArray(entry.resultFiles) && entry.resultFiles.length
        ? ` Result files: ${entry.resultFiles.join(', ')}.`
        : '';
      const resultTableSummary = summarizeNotebookResultTable(entry?.resultTable);
      const resultTable = resultTableSummary
        ? ` Result table: ${resultTableSummary}.`
        : '';
      return `${contextLabel} notebook page. State: ${stateLabel}. Updated ${updatedAt}.${executedAt}${resultFiles}${resultTable}`;
    }
    if (isSavedEntry) {
      return `${contextLabel} notebook page.`;
    }
    return `${contextLabel} protocol draft. Fill placeholders and results, then save this notebook page.`;
  }

  function clearViewer() {
    notebookProtocolArea.hidden = true;
    clearProtocolPageCopyDraft();
    notebookSteps.innerHTML = '';
    notebookSteps.hidden = false;
    notebookResult.value = '';
    notebookResultFile.value = '';
    renderResultTableEditor(null);
    if (notebookExperimentName) {
      notebookExperimentName.value = '';
    }
    notebookProtocolTitle.textContent = '';
    notebookProtocolMeta.textContent = 'Select a notebook page or start a new one.';
    editingEntryId = null;
    syncProtocolEditorControls(null, null);
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
    saveNotebookBtn.textContent = 'Save';
    if (clarifySaveNotebookBtn) {
      clarifySaveNotebookBtn.textContent = 'Clarify and Save';
    }
    if (cancelEditBtn) {
      cancelEditBtn.hidden = !editingEntryId;
    }
    syncProtocolEditorControls(resolveViewerProtocol(getActiveEntry()), getActiveEntry());
  }

  function setNotebookSaveBusy(isBusy, { clarify = false } = {}) {
    if (saveNotebookBtn) {
      saveNotebookBtn.disabled = isBusy;
      saveNotebookBtn.textContent = isBusy && !clarify ? 'Saving...' : 'Save';
    }
    if (clarifySaveNotebookBtn) {
      clarifySaveNotebookBtn.disabled = isBusy;
      clarifySaveNotebookBtn.textContent = isBusy && clarify ? 'Clarifying...' : 'Clarify and Save';
    }
  }

  function cancelEdit() {
    editingEntryId = null;
    clearProtocolPageCopyDraft();
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

    const project = resolveEntryProject(nextEntry);
    const protocol = resolveEntryProtocol(nextEntry);
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

  selectionInsightsController?.registerHost?.({
    key: 'biology-notebook-protocol',
    host: notebookSteps,
    getContext: () => {
      if (notebookProtocolArea.hidden) {
        return null;
      }
      const entry = getActiveEntry();
      const project = entry
        ? resolveViewerProject(entry)
        : resolveViewerProject();
      const protocol = entry
        ? resolveViewerProtocol(entry)
        : resolveViewerProtocol();
      if (!project || !protocol) {
        return null;
      }
      const record = entry || {
        id: '',
        projectId: project.id,
        projectName: project.name,
        protocolId: protocol.id,
        protocolName: protocol.name,
        storageFolder: '',
        selectionInsights: []
      };
      return {
        kind: 'notebook',
        record,
        projectId: project.id,
        projectName: project.name,
        storagePath: String(state.settings?.storagePath || '').trim(),
        insights: cloneSelectionInsights(record.selectionInsights),
        ensureRecord: async () => {
          const activeEntry = getActiveEntry();
          if (activeEntry) {
            return activeEntry;
          }
          return saveEntry();
        },
        updateRecord: (updater) => updateNotebookEntryRecord(record.id, (currentEntry) => {
          const nextEntry = updater(currentEntry);
          return nextEntry && typeof nextEntry === 'object' ? nextEntry : currentEntry;
        })
      };
    }
  });

  return {
    openEntry: editEntry,
    renderProjectOptions,
    renderProtocolOptions,
    renderEntries,
    renderLinkedPreviews,
    onProtocolChange
  };
}
