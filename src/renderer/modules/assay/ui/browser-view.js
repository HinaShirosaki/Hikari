import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("plate");
import { axisLabel } from '../shared.js';
import { notebookOptionMessage, plateAttributes, plateMessage, plateOption, setPlateText } from '../localization.js';

// Renders the assay browser list and the project/notebook/results dropdowns.
export function createAssayBrowserView({ elements, state, safeText, runtime, ensureState }) {
  function selectNotebookOption(value) {
    if (!elements.assayNotebookEntryInput) {
      return;
    }
    const targetValue = String(value || '').trim();
    if (!targetValue) {
      elements.assayNotebookEntryInput.value = '';
      return;
    }
    if (!Array.from(elements.assayNotebookEntryInput.options).some((option) => option.value === targetValue)) {
      const option = document.createElement('option');
      option.value = targetValue;
      setPlateText(option, 'form.missingNotebook', { id: targetValue });
      elements.assayNotebookEntryInput.append(option);
    }
    elements.assayNotebookEntryInput.value = targetValue;
  }

  function renderProjectOptions() {
    if (!elements.assayProjectInput) {
      return;
    }
    const selected = elements.assayProjectInput.value;
    const options = [plateOption('', 'form.selectProject')];
    (state.projects || []).forEach((project) => {
      const isSelected = selected === project.id ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name)}</option>`);
    });
    i18nUi.setHtml(elements.assayProjectInput, options.join(''));
    if (selected && (state.projects || []).some((project) => project.id === selected)) {
      elements.assayProjectInput.value = selected;
    }
  }

  function renderNotebookOptions() {
    if (!elements.assayNotebookEntryInput) {
      return;
    }
    const selected = elements.assayNotebookEntryInput.value;
    const projectId = elements.assayProjectInput?.value || '';
    const entries = (state.notebookEntries || [])
      .filter((entry) => !projectId || entry.projectId === projectId)
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));
    const options = [plateOption('', 'form.notLinked')];
    entries.forEach((entry) => {
      const { key, params } = notebookOptionMessage(entry);
      options.push(plateOption(entry.id, key, params));
    });
    i18nUi.setHtml(elements.assayNotebookEntryInput, options.join(''));

    if (selected && entries.some((entry) => entry.id === selected)) {
      elements.assayNotebookEntryInput.value = selected;
      return;
    }

    if (selected && !entries.some((entry) => entry.id === selected)) {
      elements.assayNotebookEntryInput.innerHTML += plateOption(selected, 'form.missingNotebook', { id: selected });
      elements.assayNotebookEntryInput.value = selected;
    }
  }

  function sortedAssaysByUpdated() {
    return (state.assays || [])
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));
  }

  function renderResultsAssayOptions(preferredId = '') {
    if (!elements.assayResultsAssaySelect) {
      return;
    }
    const rows = sortedAssaysByUpdated();
    const options = [plateOption('', 'analysis.selectAssay')];
    rows.forEach((assay) => {
      const label = assay.name || assay.id;
      options.push(`<option value="${assay.id}">${safeText(label)}</option>`);
    });
    i18nUi.setHtml(elements.assayResultsAssaySelect, options.join(''));
    const candidate = preferredId || runtime.activeResultsAssayId;
    if (candidate && rows.some((assay) => assay.id === candidate)) {
      elements.assayResultsAssaySelect.value = candidate;
      return;
    }
    if (rows.length) {
      elements.assayResultsAssaySelect.value = rows[0].id;
    }
  }

  function linkedNotebookLabel(assay) {
    if (!assay.notebookEntryId) {
      return '-';
    }
    const linked = (state.notebookEntries || []).find((entry) => entry.id === assay.notebookEntryId);
    if (!linked) {
      return `${assay.notebookEntryId} (missing)`;
    }
    const type = linked.notebookType === 'biology' ? 'Biology' : 'Synthesis';
    return `${type}: ${linked.protocolName || linked.id}`;
  }

  function matchesSearch(assay, term) {
    if (!term) {
      return true;
    }
    const haystack = [
      assay.assayNumber,
      assay.name,
      assay.projectName,
      assay.plateLabel,
      assay.wellCount,
      axisLabel(assay.sampleAxis),
      axisLabel(assay.concentrationAxis),
      assay.notebookEntryProtocolName,
      linkedNotebookLabel(assay),
      assay.notes
    ].join(' ').toLowerCase();
    return haystack.includes(term);
  }

  function renderItemActions({ safeId, title }) {
    return `
      <div class="card-actions assay-browser-item-actions">
        <button type="button" class="row-action-icon-btn" data-assay-edit="${safeId}" ${plateAttributes({ 'aria-label': 'action.editNamed', 'data-hover-caption': 'action.edit' }, { name: title })}>
          <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
        <button type="button" class="row-action-icon-btn row-action-icon-btn-danger" data-assay-delete="${safeId}" ${plateAttributes({ 'aria-label': 'action.deleteNamed', 'data-hover-caption': 'action.delete' }, { name: title })}>
          <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v5" />
            <path d="M14 11v5" />
          </svg>
        </button>
      </div>
    `;
  }

  function renderListItems(rows, { selectable = false } = {}) {
    return rows.map((assay) => {
      const title = assay.name || assay.assayNumber || assay.id || 'Untitled assay';
      const safeTitle = safeText(title);
      const safeId = safeText(assay.id);
      const isActive = selectable && assay.id === runtime.activeResultsAssayId;
      const copy = selectable
        ? `
          <button
            type="button"
            class="assay-browser-item-copy assay-browser-item-select"
            data-assay-results-select="${safeId}"
            ${plateAttributes({ 'aria-label': 'action.analyzeNamed' }, { name: title })}
            aria-pressed="${isActive ? 'true' : 'false'}"
          >
            <span class="assay-browser-item-title">${safeTitle}</span>
          </button>
        `
        : `
          <div class="assay-browser-item-copy">
            <p class="assay-browser-item-title">${safeTitle}</p>
          </div>
        `;
      return `
        <article class="assay-browser-item${isActive ? ' is-active' : ''}">
          ${copy}
          ${renderItemActions({ safeId, title })}
        </article>
      `;
    }).join('');
  }

  function renderListRegion({
    list,
    count,
    search,
    assays,
    selectable = false
  }) {
    if (!list) {
      return;
    }
    const term = String(search?.value || '').trim().toLowerCase();
    const rows = assays.filter((item) => matchesSearch(item, term));
    if (count) {
      i18nUi.setText(count, (term ? `${rows.length}/${assays.length}` : String(assays.length)));
    }
    i18nUi.setHtml(list, rows.length
      ? renderListItems(rows, { selectable })
      : `<p class="small-note assay-browser-empty">${plateMessage('browser.empty')}</p>`);
  }

  function renderList() {
    ensureState();
    const assays = sortedAssaysByUpdated();
    renderListRegion({
      list: elements.assayList,
      count: elements.assayBrowserCount,
      search: elements.assaySearchInput,
      assays
    });
    renderListRegion({
      list: elements.assayResultsList,
      count: elements.assayResultsBrowserCount,
      search: elements.assayResultsSearchInput,
      assays,
      selectable: true
    });
  }

  return {
    selectNotebookOption,
    renderProjectOptions,
    renderNotebookOptions,
    renderResultsAssayOptions,
    renderList
  };
}
