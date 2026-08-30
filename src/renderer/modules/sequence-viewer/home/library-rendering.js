import { escapeHtml } from '../../../lib/html.js';
import { cleanText } from '../shared.js';
import { buildSequenceMapSvg } from '../vector-builder/sequence-map.js';

// Draws the home page's library list (folders, saved and temporary entries) and
// the inline SVG map preview for whichever entry is selected.
function createLibraryRendering({
  elements,
  state,
  libraryStatusSaved,
  previewZoom,
  setPreviewedRecord,
  getLibraryListElements,
  getLibraryRename
} = {}) {
  // The preview is drawn straight from the entry's stored GenBank text as inline
  // SVG. No iframe, so it inherits the app theme and needs no height syncing,
  // and no preview document has to be generated or kept on disk.
  function renderPreview(record) {
    setPreviewedRecord(record || null);
    if (!elements.previewHost) {
      return;
    }
    if (!record?.sequence?.length) {
      elements.previewHost.innerHTML = '<p class="small-note">Select a sequence in the library to preview.</p>';
      return;
    }
    elements.previewHost.innerHTML = buildSequenceMapSvg(record, {
      features: Array.isArray(record.features) ? record.features : []
    });
    // Redrawing replaces the SVG, so the current zoom has to be re-applied.
    previewZoom.apply();
  }

  function renderLibraryList() {
    const libraryLists = getLibraryListElements();
    if (!libraryLists.length) {
      return;
    }

    const entries = Array.isArray(state.libraryEntries) ? state.libraryEntries : [];
    const folders = Array.isArray(state.libraryFolders) ? state.libraryFolders : [];
    if (!entries.length && !folders.length) {
      const noun = state.libraryFilter === libraryStatusSaved ? 'saved' : 'unsaved';
      libraryLists.forEach((libraryList) => {
        libraryList.innerHTML = `<p class="small-note">No ${noun} sequence entries.</p>`;
      });
      return;
    }

    const query = cleanText(state.librarySearchQuery, 200).toLowerCase();
    const matchingEntries = query
      ? entries.filter((entry) => (
        String(entry?.name || '').toLowerCase().includes(query)
        || (getLibraryRename()?.type === 'entry' && cleanText(entry?.id, 200) === getLibraryRename().id)
      ))
      : entries;
    const matchingFolders = query
      ? folders.filter((folder) => {
        const folderMatches = String(folder?.name || '').toLowerCase().includes(query);
        const childMatches = matchingEntries.some((entry) => cleanText(entry?.folderId, 200) === cleanText(folder?.id, 200));
        const editingFolder = getLibraryRename()?.type === 'folder' && cleanText(folder?.id, 200) === getLibraryRename().id;
        return folderMatches || childMatches || editingFolder;
      })
      : folders;
    const folderIds = new Set(folders.map((folder) => cleanText(folder?.id, 200)).filter(Boolean));
    const unfiledEntries = matchingEntries.filter((entry) => {
      const folderId = cleanText(entry?.folderId, 200);
      return !folderId || !folderIds.has(folderId);
    });
    if (!unfiledEntries.length && !matchingFolders.length) {
      libraryLists.forEach((libraryList) => {
        libraryList.innerHTML = `<p class="small-note">No sequences match "${escapeHtml(query)}".</p>`;
      });
      return;
    }

    const renameEditorHtml = (id, type) => `
      <div class="sequence-viewer-library-inline-editor${type === 'folder' ? ' sequence-viewer-library-folder-inline-editor' : ''}">
        <input
          type="text"
          class="sequence-viewer-library-rename-input"
          data-sequence-library-rename-input="${escapeHtml(id)}"
          data-sequence-library-rename-type="${type}"
          value="${escapeHtml(getLibraryRename()?.name || '')}"
          maxlength="140"
          aria-label="Rename ${type === 'folder' ? 'folder' : 'sequence'}"
        />
        <button type="button" class="ghost-btn sequence-viewer-library-rename-btn" data-sequence-library-rename-save="${escapeHtml(id)}">Save</button>
        <button type="button" class="ghost-btn sequence-viewer-library-rename-btn is-secondary" data-sequence-library-rename-cancel>Cancel</button>
      </div>
    `;

    const entryHtml = (entry) => {
      const active = cleanText(entry.id, 200) === cleanText(state.selectedLibraryEntryId, 200);
      if (getLibraryRename()?.type === 'entry' && cleanText(entry.id, 200) === getLibraryRename().id) {
        return `
          <div
            class="sequence-viewer-library-item sequence-viewer-library-item-editing${active ? ' sequence-viewer-library-item-active' : ''}"
            data-sequence-entry-id="${escapeHtml(entry.id)}"
          >
            ${renameEditorHtml(entry.id, 'entry')}
          </div>
        `;
      }
      return `
        <button
          type="button"
          class="sequence-viewer-library-item${active ? ' sequence-viewer-library-item-active' : ''}"
          data-sequence-entry-id="${escapeHtml(entry.id)}"
          draggable="true"
          title="${escapeHtml(entry.name || 'sequence')}"
        >
          <span class="sequence-viewer-library-item-name">${escapeHtml(entry.name || 'sequence')}</span>
        </button>
      `;
    };
    const html = [
      unfiledEntries.map(entryHtml).join(''),
      matchingFolders.map((folder) => {
        const folderId = cleanText(folder?.id, 200);
        const folderNameMatches = query && String(folder?.name || '').toLowerCase().includes(query);
        const folderEntries = entries.filter((entry) => cleanText(entry?.folderId, 200) === folderId);
        const visibleFolderEntries = query && !folderNameMatches
          ? matchingEntries.filter((entry) => cleanText(entry?.folderId, 200) === folderId)
          : folderEntries;
        const expanded = query ? true : isLibraryFolderExpanded(folderId);
        const editing = getLibraryRename()?.type === 'folder' && folderId === getLibraryRename().id;
        return `
          <div class="sequence-viewer-library-folder-group${expanded ? ' is-expanded' : ''}">
            ${editing ? `
              <div
                class="sequence-viewer-library-folder-row sequence-viewer-library-folder-row-editing${expanded ? ' is-expanded' : ''}"
                data-sequence-folder-id="${escapeHtml(folderId)}"
                data-sequence-folder-drop="${escapeHtml(folderId)}"
              >
                <span class="sequence-viewer-library-folder-chevron" aria-hidden="true"></span>
                <span class="left-rail-folder-glyph sequence-viewer-library-folder-glyph" aria-hidden="true"></span>
                ${renameEditorHtml(folderId, 'folder')}
              </div>
            ` : `
              <button
                type="button"
                class="sequence-viewer-library-folder-row${expanded ? ' is-expanded' : ''}"
                data-sequence-folder-id="${escapeHtml(folderId)}"
                data-sequence-folder-drop="${escapeHtml(folderId)}"
                aria-expanded="${expanded ? 'true' : 'false'}"
                title="${escapeHtml(folder.name || 'Folder')}"
              >
                <span class="sequence-viewer-library-folder-chevron" aria-hidden="true"></span>
                <span class="left-rail-folder-glyph sequence-viewer-library-folder-glyph" aria-hidden="true"></span>
                <span class="sequence-viewer-library-folder-name">${escapeHtml(folder.name || 'Folder')}</span>
                <span class="sequence-viewer-library-folder-count">${folderEntries.length}</span>
              </button>
            `}
            ${expanded ? `
              <div class="sequence-viewer-library-folder-children">
                ${visibleFolderEntries.length
                  ? visibleFolderEntries.map(entryHtml).join('')
                  : '<p class="sequence-viewer-library-folder-empty">No sequences.</p>'}
              </div>
            ` : ''}
          </div>
        `;
      }).join('')
    ].join('');
    libraryLists.forEach((libraryList) => {
      libraryList.innerHTML = html;
    });
  }

  function isLibraryFolderExpanded(folderId) {
    return (Array.isArray(state.expandedLibraryFolderIds) ? state.expandedLibraryFolderIds : [])
      .some((id) => cleanText(id, 200) === cleanText(folderId, 200));
  }

  function toggleLibraryFolder(folderId) {
    const safeFolderId = cleanText(folderId, 200);
    if (!safeFolderId) {
      return;
    }
    const expanded = new Set(Array.isArray(state.expandedLibraryFolderIds) ? state.expandedLibraryFolderIds : []);
    if (expanded.has(safeFolderId)) {
      expanded.delete(safeFolderId);
    } else {
      expanded.add(safeFolderId);
    }
    state.expandedLibraryFolderIds = [...expanded];
    renderLibraryList();
  }


  return {
    renderPreview,
    renderLibraryList,
    isLibraryFolderExpanded,
    toggleLibraryFolder
  };
}

export { createLibraryRendering };
