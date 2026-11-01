import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("dna");
import {
  attachRailHoverCard,
  createFolderTreeState,
  renderFolderTreeNode
} from '../../../lib/folder-tree.js';
import { cleanText } from '../shared.js';
import { buildSequenceMapSvg } from '../vector-builder/sequence-map.js';
import { dnaFolderDisclosure, dnaMessage, dnaText } from '../localization.js';
import { samplePositionButtonHtml } from '../sample-position.js';
import { escapeHtml } from '../../../lib/html.js';
import { buildDnaLibraryHierarchy } from './library-hierarchy.js';

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
  // The rail clips long names; hovering shows the whole one.
  const hideNameCards = getLibraryListElements().map((list) => attachRailHoverCard(list, {
    rowSelector: '[data-sequence-entry-id], [data-sequence-folder-main]'
  }));
  // The preview is drawn straight from the entry's stored GenBank text as inline
  // SVG. No iframe, so it inherits the app theme and needs no height syncing,
  // and no preview document has to be generated or kept on disk.
  function renderPreview(record) {
    setPreviewedRecord(record || null);
    if (!elements.previewHost) {
      return;
    }
    if (!record?.sequence?.length) {
      i18nUi.setHtml(elements.previewHost, '');
      return;
    }
    i18nUi.setHtml(elements.previewHost, buildSequenceMapSvg(record, {
      features: Array.isArray(record.features) ? record.features : []
    }));
    // Redrawing replaces the SVG, so the current zoom has to be re-applied.
    previewZoom.apply();
  }

  function renderLibraryList() {
    hideNameCards.forEach((hide) => hide());
    const libraryLists = getLibraryListElements();
    if (!libraryLists.length) {
      return;
    }

    const entries = Array.isArray(state.libraryEntries) ? state.libraryEntries : [];
    const folders = Array.isArray(state.libraryFolders) ? state.libraryFolders : [];
    if (!entries.length && !folders.length) {
      const emptyKey = state.libraryFilter === libraryStatusSaved ? 'library.emptySaved' : 'library.emptyUnsaved';
      libraryLists.forEach((libraryList) => {
        i18nUi.setHtml(libraryList, `<p class="small-note">${dnaMessage(emptyKey)}</p>`);
      });
      return;
    }

    const query = cleanText(state.librarySearchQuery, 200).toLowerCase();
    const tree = buildDnaLibraryHierarchy(entries, query);
    const matchingEntries = entries.filter(entry => tree.visibleIds.has(entry.id));
    const matchingFolders = query
      ? folders.filter((folder) => (
        String(folder?.name || '').toLowerCase().includes(query)
        || matchingEntries.some((entry) => cleanText(entry?.folderId, 200) === cleanText(folder?.id, 200))
      ))
      : folders;
    const folderIds = new Set(folders.map((folder) => cleanText(folder?.id, 200)).filter(Boolean));
    const unfiledEntries = tree.roots.filter((entry) => {
      const folderId = cleanText(entry?.folderId, 200);
      return tree.visibleIds.has(entry.id) && (!folderId || !folderIds.has(folderId));
    });
    if (!unfiledEntries.length && !matchingFolders.length) {
      libraryLists.forEach((libraryList) => {
        i18nUi.setHtml(libraryList, `<p class="small-note">${dnaMessage('library.noMatch', { query })}</p>`);
      });
      return;
    }

    const entryHtml = (entry, forceVisible = false) => {
      const active = cleanText(entry.id, 200) === cleanText(state.selectedLibraryEntryId, 200);
      const children = tree.children.get(entry.id) || [];
      const expanded = Boolean(query) || (state.expandedDnaEntryIds || []).includes(entry.id);
      const disclosure = i18nUi.message(expanded ? 'Hide fragments of {name}' : 'Show fragments of {name}', { name: entry.name });
      return renderFolderTreeNode({
        key: `dna:${entry.id}`, expanded, active, expandable: children.length > 0,
        nodeClass: 'sequence-viewer-dna-family', rowClass: 'sequence-viewer-dna-row',
        childrenClass: 'sequence-viewer-dna-children',
        disclosureLabel: i18nUi.value(disclosure),
        disclosureAttributes: {
          'data-sequence-dna-toggle': entry.id,
          'data-i18n-aria-label': disclosure.i18nKey,
          'data-i18n-params': JSON.stringify(disclosure.i18nParams)
        },
        mainHtml: `<button type="button" class="sequence-viewer-library-item folder-tree-template__leaf-control${active ? ' sequence-viewer-library-item-active is-active' : ''}" data-sequence-entry-id="${escapeHtml(entry.id)}" draggable="true">
            <span class="sequence-viewer-library-item-name folder-tree-template__leaf-label">${i18nUi.render(entry.name || i18nUi.message('sequence'))}</span>
          </button>`,
        actionHtml: samplePositionButtonHtml('data-sequence-sample-position', entry.id),
        childrenHtml: children.filter(child => forceVisible || tree.visibleIds.has(child.id)).map(child => entryHtml(child, forceVisible)).join('')
      });
    };
    const html = [
      unfiledEntries.map(entry => entryHtml(entry)).join(''),
      matchingFolders.map((folder) => {
        const folderId = cleanText(folder?.id, 200);
        const folderNameMatches = query && String(folder?.name || '').toLowerCase().includes(query);
        const folderEntries = entries.filter((entry) => cleanText(entry?.folderId, 200) === folderId);
        const folderRoots = tree.roots.filter(entry => cleanText(entry.folderId, 200) === folderId);
        const visibleFolderEntries = query && !folderNameMatches
          ? folderRoots.filter(entry => tree.visibleIds.has(entry.id))
          : folderRoots;
        const expanded = query ? true : isLibraryFolderExpanded(folderId);
        return renderFolderTreeNode({
          key: folderId,
          expanded,
          label: folder.name,
          ...(folder.name ? {} : { labelHtml: dnaMessage('library.folder') }),
          ...dnaFolderDisclosure(folder.name || dnaText('library.folder'), expanded),
          meta: String(folderEntries.length),
          childrenHtml: visibleFolderEntries.length
            ? visibleFolderEntries.map(entry => entryHtml(entry, Boolean(folderNameMatches))).join('')
            : `<p class="sequence-viewer-library-folder-empty">${dnaMessage('library.folderEmpty')}</p>`,
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
            'data-sequence-folder-main': folderId
          }
        });
      }).join('')
    ].join('');
    libraryLists.forEach((libraryList) => {
      i18nUi.setHtml(libraryList, html);
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

  function toggleDnaEntry(entryId) {
    const expanded = new Set(state.expandedDnaEntryIds || []);
    if (expanded.has(entryId)) expanded.delete(entryId);
    else expanded.add(entryId);
    state.expandedDnaEntryIds = [...expanded];
    renderLibraryList();
  }


  return {
    renderPreview,
    renderLibraryList,
    isLibraryFolderExpanded,
    toggleLibraryFolder,
    toggleDnaEntry
  };
}

export { createLibraryRendering };
