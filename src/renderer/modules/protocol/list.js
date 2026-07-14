export function createProtocolListController({
  state,
  persist,
  ui,
  localState,
  safeText,
  getShareTargetEmails,
  defaultShareStatus,
  normalizeIsoTimestamp,
  parseTimestamp,
  onViewProtocol,
  onEditProtocol,
  onDeleteProtocol,
  onExportProtocol,
  onShareProtocolConfirm,
  onCopyProtocolLink,
  syncSelectionAfterMutation
}) {
  function updateSortButtonLabels() {
    const fieldLabel = localState.protocolSortField === 'time' ? 'Time' : 'Name';
    const orderLabel = localState.protocolSortOrder === 'asc' ? 'Low to High' : 'High to Low';
    const activeSort = `${localState.protocolSortField}:${localState.protocolSortOrder}`;

    if (ui.protocolSortMenuBtn) {
      const label = `Sort protocols: ${fieldLabel}, ${orderLabel}`;
      ui.protocolSortMenuBtn.setAttribute('aria-label', label);
      ui.protocolSortMenuBtn.title = label;
    }

    ui.protocolSortMenu?.querySelectorAll?.('[data-protocol-sort]').forEach((option) => {
      const isActive = option.dataset.protocolSort === activeSort;
      option.classList.toggle('is-active', isActive);
      option.setAttribute('aria-checked', String(isActive));
    });
  }

  function ensureProtocolTimestamps() {
    if (!Array.isArray(state.protocols) || !state.protocols.length) {
      return;
    }

    const fallbackBaseTimestamp = Date.now() - (state.protocols.length * 1000);
    let changed = false;

    state.protocols = state.protocols.map((protocol, index) => {
      const fallbackCreatedAt = new Date(fallbackBaseTimestamp + (index * 1000)).toISOString();
      const createdAt = normalizeIsoTimestamp(protocol?.createdAt, fallbackCreatedAt);
      const updatedAt = normalizeIsoTimestamp(protocol?.updatedAt, createdAt);
      const rawCreatedAt = String(protocol?.createdAt || '').trim();
      const rawUpdatedAt = String(protocol?.updatedAt || '').trim();

      if (createdAt !== rawCreatedAt || updatedAt !== rawUpdatedAt) {
        changed = true;
      }

      return {
        ...protocol,
        createdAt,
        updatedAt
      };
    });

    if (changed) {
      persist();
    }
  }

  function getProtocolSortTimestamp(protocol) {
    const updatedAt = parseTimestamp(protocol?.updatedAt);
    if (updatedAt) {
      return updatedAt;
    }
    return parseTimestamp(protocol?.createdAt);
  }

  function compareProtocols(a, b) {
    const nameA = String(a?.name || '').trim();
    const nameB = String(b?.name || '').trim();
    const nameResult = nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
    const timeResult = getProtocolSortTimestamp(a) - getProtocolSortTimestamp(b);

    let result = 0;
    if (localState.protocolSortField === 'name') {
      result = nameResult || timeResult;
    } else {
      result = timeResult || nameResult;
    }

    if (!result) {
      result = String(a?.id || '').localeCompare(String(b?.id || ''));
    }

    return localState.protocolSortOrder === 'asc' ? result : (result * -1);
  }

  function formatProtocolTimestamp(protocol) {
    const timestamp = getProtocolSortTimestamp(protocol);
    if (!timestamp) {
      return 'No timestamp';
    }
    return new Date(timestamp).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function renderList() {
    if (!ui.protocolList) {
      return;
    }

    ensureProtocolTimestamps();
    updateSortButtonLabels();

    if (!state.protocols.length) {
      ui.protocolList.innerHTML = '<p class="small-note">No saved protocols yet.</p>';
      syncSelectionAfterMutation?.();
      return;
    }

    const shareOptions = ['<option value="">Select teammate</option>'];
    getShareTargetEmails().forEach((email) => {
      const selectedAttr = localState.activeShareTargetEmail === email ? ' selected' : '';
      shareOptions.push(`<option value="${safeText(email)}"${selectedAttr}>${safeText(email)}</option>`);
    });

    const sortedProtocols = [...state.protocols].sort(compareProtocols);
    ui.protocolList.innerHTML = sortedProtocols.map((protocol) => `
      <article
        class="list-row protocol-list-row${localState.activeShareProtocolId === protocol.id ? ' protocol-list-row-share-open' : ''}${localState.activeMenuProtocolId === protocol.id ? ' protocol-list-row-menu-open' : ''}${localState.activeProtocolId === protocol.id ? ' protocol-list-row-selected list-row-selected' : ''}"
        data-protocol-select="${protocol.id}"
        tabindex="0"
      >
        <div class="protocol-name-text-wrap">
          <span class="protocol-name-text">${safeText(protocol.name)}</span>
          <span class="protocol-row-meta">Updated ${safeText(formatProtocolTimestamp(protocol))}</span>
        </div>
        <div class="card-actions list-actions protocol-list-actions">
          <div class="protocol-legacy-actions" hidden>
            <button type="button" class="ghost-btn protocol-view-btn" data-protocol-view="${protocol.id}">View</button>
            <button type="button" class="ghost-btn protocol-view-btn" data-protocol-export="${protocol.id}">Export PDF</button>
            <button type="button" class="ghost-btn protocol-edit-btn" data-protocol-edit="${protocol.id}">Edit</button>
            <button type="button" class="ghost-btn protocol-share-btn" data-protocol-share="${protocol.id}">Share</button>
            <button type="button" class="danger-btn protocol-delete-btn" data-protocol-delete="${protocol.id}">Delete</button>
          </div>
          <button
            type="button"
            class="ghost-btn protocol-menu-btn${localState.activeMenuProtocolId === protocol.id ? ' is-open' : ''}"
            data-protocol-menu-trigger="${protocol.id}"
            aria-haspopup="menu"
            aria-expanded="${localState.activeMenuProtocolId === protocol.id ? 'true' : 'false'}"
            aria-label="Protocol actions"
            title="Protocol actions"
          >...</button>
          ${localState.activeMenuProtocolId === protocol.id ? `
            <div class="protocol-action-menu protocol-preview-block" role="menu">
              <button type="button" class="ghost-btn protocol-action-item" data-protocol-action="edit" data-protocol-id="${protocol.id}">Edit</button>
              <button type="button" class="ghost-btn protocol-action-item" data-protocol-action="export" data-protocol-id="${protocol.id}">Export PDF</button>
              <button type="button" class="ghost-btn protocol-action-item" data-protocol-action="share" data-protocol-id="${protocol.id}">Share</button>
              <button type="button" class="ghost-btn protocol-action-item protocol-action-item-danger" data-protocol-action="delete" data-protocol-id="${protocol.id}">Delete</button>
            </div>
          ` : ''}
        </div>
        ${localState.activeShareProtocolId === protocol.id ? `
          <div class="protocol-share-inline">
            <select data-protocol-share-select="${protocol.id}">
              ${shareOptions.join('')}
            </select>
            <button type="button" class="primary-btn" data-protocol-share-confirm="${protocol.id}" ${localState.activeShareTargetEmail ? '' : 'disabled'}>Confirm</button>
            <button type="button" class="ghost-btn" data-protocol-copy-link="${protocol.id}">Copy Link</button>
            <button type="button" class="ghost-btn" data-protocol-share-cancel>Cancel</button>
          </div>
        ` : ''}
      </article>
    `).join('');

    ui.protocolList.querySelectorAll('[data-protocol-view]').forEach((button) => {
      button.addEventListener('click', () => onViewProtocol(button.dataset.protocolView));
    });

    ui.protocolList.querySelectorAll('[data-protocol-select]').forEach((row) => {
      row.addEventListener('click', (event) => {
        const target = event.target;
        const interactive = typeof target?.closest === 'function'
          ? target.closest('button, select, textarea, input, .protocol-share-inline, .protocol-action-menu')
          : null;
        if (interactive) {
          return;
        }
        onViewProtocol(row.dataset.protocolSelect);
      });

      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        const target = event.target;
        const interactive = typeof target?.closest === 'function'
          ? target.closest('button, select, textarea, input, .protocol-share-inline, .protocol-action-menu')
          : null;
        if (interactive) {
          return;
        }
        event.preventDefault?.();
        onViewProtocol(row.dataset.protocolSelect);
      });
    });

    ui.protocolList.querySelectorAll('[data-protocol-edit]').forEach((button) => {
      button.addEventListener('click', () => onEditProtocol(button.dataset.protocolEdit));
    });

    ui.protocolList.querySelectorAll('[data-protocol-export]').forEach((button) => {
      button.addEventListener('click', () => onExportProtocol(button.dataset.protocolExport));
    });

    ui.protocolList.querySelectorAll('[data-protocol-share]').forEach((button) => {
      button.addEventListener('click', () => {
        const protocolId = String(button.dataset.protocolShare || '');
        localState.activeMenuProtocolId = '';
        if (localState.activeShareProtocolId === protocolId) {
          localState.activeShareProtocolId = '';
          localState.activeShareTargetEmail = '';
        } else {
          localState.activeShareProtocolId = protocolId;
          localState.activeShareTargetEmail = '';
        }
        renderList();
      });
    });

    ui.protocolList.querySelectorAll('[data-protocol-delete]').forEach((button) => {
      button.addEventListener('click', () => onDeleteProtocol(button.dataset.protocolDelete));
    });

    ui.protocolList.querySelectorAll('[data-protocol-share-select]').forEach((select) => {
      select.addEventListener('change', () => {
        localState.activeShareTargetEmail = String(select.value || '').trim();
        renderList();
      });
    });

    ui.protocolList.querySelectorAll('[data-protocol-share-confirm]').forEach((button) => {
      button.addEventListener('click', () => {
        const protocolId = String(button.dataset.protocolShareConfirm || '');
        onShareProtocolConfirm(protocolId, localState.activeShareTargetEmail);
      });
    });

    ui.protocolList.querySelectorAll('[data-protocol-copy-link]').forEach((button) => {
      button.addEventListener('click', () => {
        void onCopyProtocolLink(String(button.dataset.protocolCopyLink || ''));
      });
    });

    ui.protocolList.querySelectorAll('[data-protocol-share-cancel]').forEach((button) => {
      button.addEventListener('click', () => {
        localState.activeShareProtocolId = '';
        localState.activeShareTargetEmail = '';
        renderList();
      });
    });

    ui.protocolList.querySelectorAll('[data-protocol-menu-trigger]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation?.();
        const protocolId = String(button.dataset.protocolMenuTrigger || '');
        localState.activeMenuProtocolId = localState.activeMenuProtocolId === protocolId ? '' : protocolId;
        renderList();
      });
    });

    ui.protocolList.querySelectorAll('[data-protocol-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = String(button.dataset.protocolAction || '');
        const protocolId = String(button.dataset.protocolId || '');
        localState.activeMenuProtocolId = '';

        if (action === 'edit') {
          renderList();
          onEditProtocol(protocolId);
          return;
        }
        if (action === 'export') {
          onExportProtocol(protocolId);
          renderList();
          return;
        }
        if (action === 'share') {
          localState.activeShareProtocolId = localState.activeShareProtocolId === protocolId ? '' : protocolId;
          localState.activeShareTargetEmail = '';
          renderList();
          return;
        }
        if (action === 'delete') {
          onDeleteProtocol(protocolId);
        }
      });
    });

    syncSelectionAfterMutation?.();
  }

  return {
    updateSortButtonLabels,
    ensureProtocolTimestamps,
    getProtocolSortTimestamp,
    compareProtocols,
    formatProtocolTimestamp,
    renderList
  };
}
