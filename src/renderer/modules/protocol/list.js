import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("protocol");
import { dateSpan } from '../../lib/i18n/markup.js';
import { protocolText, protocolMessage, protocolAttributes } from './localization.js';
export function createProtocolListController({
  state,
  persist,
  ui,
  localState,
  safeText,
  normalizeIsoTimestamp,
  parseTimestamp,
  onViewProtocol,
  onEditProtocol,
  onDeleteProtocol,
  onExportProtocol,
  contextActions = null,
  syncSelectionAfterMutation
}) {
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

    if (!state.protocols.length) {
      i18nUi.setHtml(ui.protocolList, '');
      syncSelectionAfterMutation?.();
      return;
    }

    const query = String(ui.protocolSearch?.value || '').trim().toLocaleLowerCase();
    const sortedProtocols = state.protocols.filter((protocol) =>
      !query || `${protocol.name || ''} ${protocol.purpose || ''}`.toLocaleLowerCase().includes(query)
    ).sort(compareProtocols);
    if (!sortedProtocols.length) {
      i18nUi.setHtml(ui.protocolList, `<p class="small-note" role="status">${protocolMessage('list.noMatches')}</p>`);
      return;
    }
    i18nUi.setHtml(ui.protocolList, sortedProtocols.map((protocol) => `
      <article
        class="list-row protocol-list-row${localState.activeMenuProtocolId === protocol.id ? ' protocol-list-row-menu-open' : ''}${localState.activeProtocolId === protocol.id ? ' protocol-list-row-selected list-row-selected' : ''}"
        data-protocol-select="${protocol.id}"
        tabindex="0"
      >
        <div class="protocol-name-text-wrap">
          <span class="protocol-name-text">${safeText(protocol.name)}</span>
          <span class="protocol-row-meta">${protocolMessage('list.updated')} ${getProtocolSortTimestamp(protocol) ? dateSpan(new Date(getProtocolSortTimestamp(protocol)).toISOString(), formatProtocolTimestamp(protocol), { year: 'numeric', month: 'short', day: 'numeric' }) : protocolMessage('list.noTimestamp')}</span>
        </div>
        <div class="card-actions list-actions protocol-list-actions">
          <div class="protocol-legacy-actions" hidden>
            <button type="button" class="ghost-btn protocol-view-btn" data-protocol-view="${protocol.id}">${protocolMessage('list.view')}</button>
            <button type="button" class="ghost-btn protocol-view-btn" data-protocol-export="${protocol.id}">${protocolMessage('action.export')}</button>
            <button type="button" class="ghost-btn protocol-edit-btn" data-protocol-edit="${protocol.id}">${protocolMessage('list.edit')}</button>
            <button type="button" class="danger-btn protocol-delete-btn" data-protocol-delete="${protocol.id}">${protocolMessage('list.delete')}</button>
          </div>
          <button
            type="button"
            class="ghost-btn protocol-menu-btn${localState.activeMenuProtocolId === protocol.id ? ' is-open' : ''}"
            data-protocol-menu-trigger="${protocol.id}"
            aria-haspopup="menu"
            aria-expanded="${localState.activeMenuProtocolId === protocol.id ? 'true' : 'false'}"
            ${protocolAttributes({ 'aria-label': 'action.menu', title: 'action.menu' })}
          >...</button>
          ${localState.activeMenuProtocolId === protocol.id ? `
            <div class="protocol-action-menu protocol-preview-block" role="menu">
              <button type="button" class="ghost-btn protocol-action-item" data-protocol-action="edit" data-protocol-id="${protocol.id}">${protocolMessage('list.edit')}</button>
              <button type="button" class="ghost-btn protocol-action-item" data-protocol-action="export" data-protocol-id="${protocol.id}">${protocolMessage('action.export')}</button>
              ${(contextActions?.list('protocol') || []).map(action => `<button type="button" class="ghost-btn protocol-action-item" data-protocol-action="plugin" data-context-action="${safeText(action.key)}" data-protocol-id="${protocol.id}" ${action.requiresAgent ? 'data-requires-agent' : ''}>${safeText(action.label)}</button>`).join('')}
              <button type="button" class="ghost-btn protocol-action-item protocol-action-item-danger" data-protocol-action="delete" data-protocol-id="${protocol.id}">${protocolMessage('list.delete')}</button>
            </div>
          ` : ''}
        </div>
      </article>
    `).join(''));

    ui.protocolList.querySelectorAll('[data-protocol-view]').forEach((button) => {
      button.addEventListener('click', () => onViewProtocol(button.dataset.protocolView));
    });

    ui.protocolList.querySelectorAll('[data-protocol-select]').forEach((row) => {
      row.addEventListener('click', (event) => {
        const target = event.target;
        const interactive = typeof target?.closest === 'function'
          ? target.closest('button, select, textarea, input, .protocol-action-menu')
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
          ? target.closest('button, select, textarea, input, .protocol-action-menu')
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

    ui.protocolList.querySelectorAll('[data-protocol-delete]').forEach((button) => {
      button.addEventListener('click', () => onDeleteProtocol(button.dataset.protocolDelete));
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
      button.addEventListener('click', async () => {
        const action = String(button.dataset.protocolAction || '');
        const protocolId = String(button.dataset.protocolId || '');
        localState.activeMenuProtocolId = '';

        if (action === 'plugin') {
          const key = button.dataset.contextAction;
          renderList();
          const result = await contextActions.invoke(key, { kind: 'protocol', protocolId });
          if (!result.ok) globalThis.alert?.(result.error || protocolText('list.pluginError'));
          return;
        }

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
        if (action === 'delete') {
          onDeleteProtocol(protocolId);
        }
      });
    });

    syncSelectionAfterMutation?.();
  }

  return {
    ensureProtocolTimestamps,
    getProtocolSortTimestamp,
    compareProtocols,
    formatProtocolTimestamp,
    renderList
  };
}
