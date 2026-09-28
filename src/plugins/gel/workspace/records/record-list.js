// The saved-gel list in the rail: which records the search term keeps, and the
// markup each row is drawn with.
function createGelRecordList({
  runtime,
  elements,
  ensureState
} = {}) {
  function matchesSearch(record, term) {
    if (!term) {
      return true;
    }
    const haystack = [
      record.name,
      record.projectName,
      record.notebookEntryProtocolName,
      record.analysisType,
      record.imageName,
      record.updatedAt
    ].join(' ').toLowerCase();
    return haystack.includes(term);
  }

  function renderList() {
    ensureState();
    const term = String(elements.gelSearchInput?.value || '').trim().toLowerCase();
    const records = (runtime.state.gelAnalyses || [])
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));
    const rows = records.filter((record) => matchesSearch(record, term));

    if (elements.gelBrowserCount) {
      elements.gelBrowserCount.textContent = term ? `${rows.length}/${records.length}` : String(records.length);
    }

    if (!rows.length) {
      elements.gelList.innerHTML = '<p class="small-note gel-browser-empty">No saved gels found.</p>';
      return;
    }

    elements.gelList.innerHTML = rows.map((record) => {
      const title = record.name || record.id || 'Untitled gel';
      const safeTitle = runtime.safeText(title);
      const safeId = runtime.safeText(record.id);
      return `
        <article class="gel-browser-item">
          <div class="gel-browser-item-copy">
            <p class="gel-browser-item-title">${safeTitle}</p>
          </div>
          <div class="card-actions gel-browser-item-actions">
            <button type="button" class="row-action-icon-btn" data-gel-edit="${safeId}" aria-label="Edit ${safeTitle}" title="Edit">
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button type="button" class="row-action-icon-btn row-action-icon-btn-danger" data-gel-delete="${safeId}" aria-label="Delete ${safeTitle}" title="Delete">
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v5" />
                <path d="M14 11v5" />
              </svg>
            </button>
          </div>
        </article>
      `;
    }).join('');
  }

  return {
    matchesSearch,
    renderList
  };
}

export { createGelRecordList };
