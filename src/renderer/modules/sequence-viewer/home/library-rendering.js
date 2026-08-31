import { escapeHtml } from '../../../lib/html.js';
import {
  createFolderTreeState,
  renderFolderTreeLeaf,
  renderFolderTreeNode
} from '../../../lib/folder-tree.js';
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
  getLibraryListElements
} = {}) {
  const folderTree = createFolderTreeState({
    defaultExpanded: false,
    getExpandedKeys: () => state.expandedLibraryFolderIds,
    setExpandedKeys: (keys) => {
      state.expandedLibraryFolderIds = keys;
    }
  });
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
      ? entries.filter((entry) => String(entry?.name || '').toLowerCase().includes(query))
      : entries;
    const matchingFolders = query
      ? folders.filter((folder) => (
        String(folder?.name || '').toLowerCase().includes(query)
        || matchingEntries.some((entry) => cleanText(entry?.folderId, 200) === cleanText(folder?.id, 200))
      ))
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

    const entryHtml = (entry) => {
      const active = cleanText(entry.id, 200) === cleanText(state.selectedLibraryEntryId, 200);
      return renderFolderTreeLeaf({
        active,
        wrapperClass: 'sequence-viewer-library-leaf',
        controlClass: `sequence-viewer-library-item folder-tree-template__rail-leaf${active ? ' sequence-viewer-library-item-active' : ''}`,
        controlAttributes: {
          'data-sequence-entry-id': entry.id,
          draggable: 'true',
          title: entry.name || 'sequence'
        },
        contentHtml: `<span class="sequence-viewer-library-item-name folder-tree-template__leaf-label">${escapeHtml(entry.name || 'sequence')}</span>`
      });
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
        return renderFolderTreeNode({
          key: folderId,
          expanded,
          label: folder.name || 'Folder',
          meta: String(folderEntries.length),
          childrenHtml: visibleFolderEntries.length
            ? visibleFolderEntries.map(entryHtml).join('')
            : '<p class="sequence-viewer-library-folder-empty">No sequences.</p>',
          nodeClass: 'sequence-viewer-library-folder-group',
          rowClass: 'sequence-viewer-library-folder-row',
          disclosureClass: 'sequence-viewer-library-folder-toggle',
          mainClass: 'sequence-viewer-library-folder-main',
          labelClass: 'sequence-viewer-library-folder-name',
          metaClass: 'sequence-viewer-library-folder-count',
          glyphClass: 'sequence-viewer-library-folder-glyph',
          childrenClass: 'sequence-viewer-library-folder-children folder-tree-template__children--full-width-leaves',
          rowAttributes: {
            'data-sequence-folder-id': folderId,
            'data-sequence-folder-drop': folderId
          },
          disclosureAttributes: { 'data-sequence-folder-id': folderId },
          mainAttributes: {
            'data-sequence-folder-id': folderId,
            'data-sequence-folder-main': folderId,
            title: folder.name || 'Folder'
          }
        });
      }).join('')
    ].join('');
    libraryLists.forEach((libraryList) => {
      libraryList.innerHTML = html;
    });
  }

  function isLibraryFolderExpanded(folderId) {
    return folderTree.isExpanded(cleanText(folderId, 200), true);
  }

  function toggleLibraryFolder(folderId) {
    const safeFolderId = cleanText(folderId, 200);
    if (!safeFolderId) {
      return;
    }
    folderTree.toggle(safeFolderId, true);
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
