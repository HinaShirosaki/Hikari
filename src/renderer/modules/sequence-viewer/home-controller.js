import { escapeHtml } from '../tool-box/common.js';
import { DEFAULT_MAX_RECORDS } from './constants.js';
import { parseInputRecords } from './parsing.js';
import { cleanText } from './shared.js';

export function createSequenceViewerHomeController(config = {}) {
  const rootDocument = config?.rootDocument || globalThis?.document || null;
  const elements = config?.elements || {};
  const state = config?.state || {};
  const libraryStatusSaved = config?.libraryStatusSaved || 'saved';
  const libraryStatusTemporary = config?.libraryStatusTemporary || 'temporary';
  const fileAccept = config?.fileAccept || '';

  const getBridge = config?.getBridge || (() => null);
  const getStoragePath = config?.getStoragePath || (() => '');
  const hasStoragePath = config?.hasStoragePath || (() => false);
  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const setMode = config?.setMode || (() => {});
  const setInputComposerVisible = config?.setInputComposerVisible || (() => {});
  const setRecords = config?.setRecords || (() => {});
  const setStatus = config?.setStatus || (() => {});
  const readFileAsText = config?.readFileAsText || (async () => '');
  const hideFeatureContextMenu = config?.hideFeatureContextMenu || (() => {});
  const hideFeatureEditor = config?.hideFeatureEditor || (() => {});
  const onNavigateHome = typeof config?.onNavigateHome === 'function' ? config.onNavigateHome : null;
  const onNavigateDetail = typeof config?.onNavigateDetail === 'function' ? config.onNavigateDetail : null;
  const onClearAll = config?.onClearAll || (() => {});
  const onParsedRecordsOpened = config?.onParsedRecordsOpened || (async () => null);
  const onLibraryEntryLoaded = typeof config?.onLibraryEntryLoaded === 'function'
    ? config.onLibraryEntryLoaded
    : () => {};

  function setHomeStatus(message, isError = false) {
    if (!elements.homeStatusNote) {
      return;
    }
    elements.homeStatusNote.textContent = message;
    elements.homeStatusNote.style.color = isError ? 'var(--danger)' : '';
  }

  function setFeatureSearchStatus(message, isError = false) {
    if (!elements.featureSearchStatus) {
      return;
    }
    elements.featureSearchStatus.textContent = message;
    elements.featureSearchStatus.style.color = isError ? 'var(--danger)' : '';
  }

  function setLocalWorkspaceVisibility(mode) {
    const next = mode === 'detail'
      ? 'detail'
      : mode === 'alignment'
        ? 'alignment'
        : mode === 'builder'
          ? 'builder'
          : mode === 'cloning'
            ? 'cloning'
            : 'home';
    state.localWorkspaceMode = next;
    rootDocument?.body?.classList?.toggle?.('sequence-viewer-fixed-scroll', next === 'builder' || next === 'alignment');
    if (elements.homeWorkspace) {
      elements.homeWorkspace.hidden = next !== 'home';
    }
    if (elements.proteinBuilderWorkspace) {
      elements.proteinBuilderWorkspace.hidden = next !== 'builder';
    }
    if (elements.detailWorkspace) {
      elements.detailWorkspace.hidden = next !== 'detail' && next !== 'alignment';
    }
    if (elements.cloningDesignWorkspace) {
      elements.cloningDesignWorkspace.hidden = next !== 'cloning';
    }
    if (elements.alignmentWorkspace) {
      elements.alignmentWorkspace.hidden = next !== 'alignment';
    }
  }

  function navigateToHome() {
    hideFeatureContextMenu();
    hideFeatureEditor();
    setLocalWorkspaceVisibility('home');
    if (onNavigateHome) {
      onNavigateHome();
    }
  }

  function navigateToDetail() {
    hideFeatureContextMenu();
    hideFeatureEditor();
    setLocalWorkspaceVisibility('detail');
    if (onNavigateDetail) {
      onNavigateDetail();
    }
  }

  function setLibraryFilter(status) {
    state.libraryFilter = status === libraryStatusTemporary ? libraryStatusTemporary : libraryStatusSaved;
    if (elements.libraryFilterSavedBtn) {
      elements.libraryFilterSavedBtn.classList.toggle(
        'sequence-viewer-library-switch-btn-active',
        state.libraryFilter === libraryStatusSaved
      );
    }
    if (elements.libraryFilterTemporaryBtn) {
      elements.libraryFilterTemporaryBtn.classList.toggle(
        'sequence-viewer-library-switch-btn-active',
        state.libraryFilter === libraryStatusTemporary
      );
    }
  }

  function syncHomeControlsState() {
    const hasStorage = hasStoragePath();
    if (elements.libraryFilterSavedBtn) {
      elements.libraryFilterSavedBtn.disabled = !hasStorage;
    }
    if (elements.libraryFilterTemporaryBtn) {
      elements.libraryFilterTemporaryBtn.disabled = !hasStorage;
    }
    if (elements.saveBtn) {
      elements.saveBtn.disabled = !getSelectedRecord()?.sequence?.length;
    }
    if (elements.featureSearchInput) {
      elements.featureSearchInput.disabled = !hasStorage || Boolean(state.isSearchingFeatures);
    }
    if (elements.featureSearchBtn) {
      elements.featureSearchBtn.disabled = !hasStorage || Boolean(state.isSearchingFeatures);
    }
  }

  function renderPreviewFromHtml(entry, htmlText) {
    if (!elements.previewHost) {
      return;
    }
    if (!entry || !String(htmlText || '').trim()) {
      elements.previewHost.innerHTML = '<p class="small-note">Select a sequence in the library to preview.</p>';
      return;
    }

    const title = String(entry?.name || 'Sequence preview');
    if (typeof rootDocument?.createElement === 'function' && typeof elements.previewHost?.replaceChildren === 'function') {
      const frame = rootDocument.createElement('iframe');
      frame.className = 'sequence-viewer-preview-frame';
      frame.loading = 'lazy';
      frame.title = title;
      frame.setAttribute('scrolling', 'no');
      frame.srcdoc = String(htmlText);
      frame.addEventListener('load', () => {
        schedulePreviewFrameHeightSync(frame);
      }, { once: true });
      elements.previewHost.replaceChildren(frame);
      schedulePreviewFrameHeightSync(frame);
      return;
    }

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(String(htmlText))}`;
    elements.previewHost.innerHTML = `<iframe class="sequence-viewer-preview-frame" src="${dataUrl}" loading="lazy" scrolling="no" title="${escapeHtml(title)}"></iframe>`;
  }

  function getPreviewFrameElement() {
    if (!elements.previewHost || typeof elements.previewHost.querySelector !== 'function') {
      return null;
    }
    return elements.previewHost.querySelector('.sequence-viewer-preview-frame');
  }

  function syncPreviewFrameHeight(frame = getPreviewFrameElement()) {
    if (!frame) {
      return;
    }

    const hostRect = typeof elements.previewHost?.getBoundingClientRect === 'function'
      ? elements.previewHost.getBoundingClientRect()
      : null;
    const frameRect = typeof frame.getBoundingClientRect === 'function'
      ? frame.getBoundingClientRect()
      : null;
    const viewWindow = rootDocument?.defaultView || globalThis || null;
    const viewportHeight = Math.max(0, Number(viewWindow?.innerHeight) || 0);
    const previewWidth = Math.max(
      0,
      Number(frameRect?.width) || Number(hostRect?.width) || Number(elements.previewHost?.clientWidth) || 0
    );
    const previewTop = Math.max(0, Number(hostRect?.top) || Number(frameRect?.top) || 0);
    const availableHeight = viewportHeight > 0
      ? Math.max(280, viewportHeight - previewTop - 28)
      : 520;
    const fallbackSize = Math.max(280, Math.min(availableHeight, 520));
    const widthBound = previewWidth > 0 ? previewWidth : fallbackSize;
    const nextSize = Math.min(widthBound, availableHeight, 1120);

    frame.style.height = `${Math.round(nextSize > 0 ? nextSize : fallbackSize)}px`;
  }

  function schedulePreviewFrameHeightSync(frame = getPreviewFrameElement()) {
    if (!frame) {
      return;
    }

    syncPreviewFrameHeight(frame);
    globalThis?.requestAnimationFrame?.(() => {
      syncPreviewFrameHeight(frame);
    });
    globalThis?.setTimeout?.(() => {
      syncPreviewFrameHeight(frame);
    }, 120);
  }

  function buildFeatureSequencePreview(sequence) {
    const text = cleanText(String(sequence || '').toUpperCase(), 1200);
    if (text.length <= 42) {
      return text || '-';
    }
    return `${text.slice(0, 18)}...${text.slice(-18)}`;
  }

  function buildHostLocationLabel(host) {
    const locations = Array.isArray(host?.locations) ? host.locations : [];
    if (!locations.length) {
      return 'Stored vector';
    }

    const first = locations[0];
    const firstLabel = `${first.startPos}-${first.endPos} (${first.strand === -1 ? '-' : '+'})`;
    if (locations.length === 1) {
      return firstLabel;
    }
    return `${firstLabel} +${locations.length - 1} more`;
  }

  function renderFeatureSearchResults() {
    if (!elements.featureSearchResults) {
      return;
    }

    const query = cleanText(state.featureSearchQuery, 600);
    const results = Array.isArray(state.featureSearchResults) ? state.featureSearchResults : [];
    if (!query) {
      elements.featureSearchResults.innerHTML = '<p class="small-note">Search by feature name, full sequence, or partial sequence.</p>';
      return;
    }
    if (!results.length) {
      elements.featureSearchResults.innerHTML = `<p class="small-note">No stored features matched "${escapeHtml(query)}".</p>`;
      return;
    }

    elements.featureSearchResults.innerHTML = results
      .map((feature) => {
        const hostCount = Math.max(0, Number(feature?.hostCount) || 0);
        const hosts = Array.isArray(feature?.hosts) ? feature.hosts : [];
        return `
          <article class="sequence-viewer-feature-search-item">
            <div class="sequence-viewer-feature-search-head">
              <div>
                <span class="sequence-viewer-feature-search-name">${escapeHtml(feature?.name || 'feature')}</span>
                <span class="sequence-viewer-feature-search-type">${escapeHtml(feature?.type || 'misc_feature')}</span>
              </div>
              <span class="small-note">${escapeHtml(`${hostCount} vector${hostCount === 1 ? '' : 's'}`)}</span>
            </div>
            <p class="sequence-viewer-feature-search-sequence">${escapeHtml(buildFeatureSequencePreview(feature?.sequence))}</p>
            <div class="sequence-viewer-feature-search-hosts">
              ${hosts.map((host) => `
                <button
                  type="button"
                  class="sequence-viewer-feature-search-host"
                  data-feature-host-entry-id="${escapeHtml(host?.hostVectorId || '')}"
                  data-feature-host-status="${escapeHtml(host?.hostVectorStatus || '')}"
                >
                  <span class="sequence-viewer-feature-search-host-name">${escapeHtml(host?.hostVectorName || 'vector')}</span>
                  <span class="sequence-viewer-feature-search-host-meta">${escapeHtml(buildHostLocationLabel(host))}</span>
                </button>
              `).join('')}
            </div>
          </article>
        `;
      })
      .join('');
  }

  function renderLibraryList() {
    if (!elements.libraryList) {
      return;
    }

    const entries = Array.isArray(state.libraryEntries) ? state.libraryEntries : [];
    if (!entries.length) {
      const noun = state.libraryFilter === libraryStatusSaved ? 'saved' : 'unsaved';
      elements.libraryList.innerHTML = `<p class="small-note">No ${noun} sequence entries.</p>`;
      return;
    }

    elements.libraryList.innerHTML = entries
      .map((entry) => {
        const active = cleanText(entry.id, 200) === cleanText(state.selectedLibraryEntryId, 200);
        return `
          <button
            type="button"
            class="sequence-viewer-library-item${active ? ' sequence-viewer-library-item-active' : ''}"
            data-sequence-entry-id="${escapeHtml(entry.id)}"
            title="${escapeHtml(entry.name || 'sequence')}"
          >
            <span class="sequence-viewer-library-item-name">${escapeHtml(entry.name || 'sequence')}</span>
          </button>
        `;
      })
      .join('');
  }

  async function loadSelectedLibraryPreview() {
    const entryId = cleanText(state.selectedLibraryEntryId, 200);
    const storagePath = getStoragePath();
    if (!entryId || !storagePath) {
      renderPreviewFromHtml(null, '');
      return;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibraryGet) {
      renderPreviewFromHtml(null, '');
      return;
    }

    try {
      const response = await bridge.sequenceLibraryGet({
        storagePath,
        id: entryId,
        includeHtml: true
      });
      if (!response?.ok || !response?.entry) {
        throw new Error(response?.error || 'Failed to load preview.');
      }
      renderPreviewFromHtml(response.entry, response.htmlText || '');
    } catch (error) {
      renderPreviewFromHtml(null, '');
      setHomeStatus(error?.message || 'Failed to load preview.', true);
    }
  }

  async function refreshLibraryEntries(options = {}) {
    const requestedFilter = cleanText(options.filter || options.status, 40);
    if (requestedFilter === libraryStatusSaved || requestedFilter === libraryStatusTemporary) {
      setLibraryFilter(requestedFilter);
    }

    const storagePath = getStoragePath();
    syncHomeControlsState();
    if (!storagePath) {
      state.libraryEntries = [];
      state.selectedLibraryEntryId = '';
      state.featureSearchResults = [];
      state.featureSearchQuery = '';
      renderLibraryList();
      renderFeatureSearchResults();
      renderPreviewFromHtml(null, '');
      setHomeStatus('Use New or Open to continue. Set Storage Folder Path in Settings to enable the saved/unsaved library.');
      setFeatureSearchStatus('Set Storage Folder Path in Settings to search stored features.');
      return;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibraryList) {
      setHomeStatus('Sequence library storage API unavailable.', true);
      return;
    }

    try {
      const response = await bridge.sequenceLibraryList({
        storagePath,
        status: state.libraryFilter
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to list sequence entries.');
      }

      const entries = Array.isArray(response.entries) ? response.entries : [];
      state.libraryEntries = entries;

      const preferred = cleanText(options.selectedId, 200) || cleanText(state.selectedLibraryEntryId, 200);
      const nextSelected = entries.some((entry) => cleanText(entry.id, 200) === preferred)
        ? preferred
        : (entries[0]?.id || '');
      state.selectedLibraryEntryId = cleanText(nextSelected, 200);

      renderLibraryList();
      await loadSelectedLibraryPreview();
      if (!options.silent) {
        setHomeStatus(`Loaded ${entries.length} ${state.libraryFilter} sequence entr${entries.length === 1 ? 'y' : 'ies'}.`);
      }
      if (!state.featureSearchQuery) {
        setFeatureSearchStatus('Search stored features and open the host vector directly.');
      }
    } catch (error) {
      state.libraryEntries = [];
      state.selectedLibraryEntryId = '';
      renderLibraryList();
      renderPreviewFromHtml(null, '');
      setHomeStatus(error?.message || 'Failed to load sequence library.', true);
    }
  }

  async function setSelectedLibraryEntry(entryId) {
    state.selectedLibraryEntryId = cleanText(entryId, 200);
    renderLibraryList();
    await loadSelectedLibraryPreview();
  }

  function resolveLibraryEntryIdFromEvent(event) {
    const target = event?.target;
    const direct = cleanText(target?.dataset?.sequenceEntryId, 200);
    if (direct) {
      return direct;
    }

    const viaClosest = cleanText(
      target?.closest?.('[data-sequence-entry-id]')?.dataset?.sequenceEntryId,
      200
    );
    if (viaClosest) {
      return viaClosest;
    }

    let cursor = target?.parentElement || target?.parentNode || null;
    while (cursor) {
      const resolved = cleanText(cursor?.dataset?.sequenceEntryId, 200);
      if (resolved) {
        return resolved;
      }
      cursor = cursor.parentElement || cursor.parentNode || null;
    }

    return '';
  }

  async function openParsedRecordsInDetail(parsed, rawText = '', statusPrefix = 'Loaded') {
    const hasRecords = Array.isArray(parsed?.records) && parsed.records.length > 0;
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    if (elements.inputTextarea) {
      elements.inputTextarea.value = rawText || '';
    }
    setMode('paste');
    setInputComposerVisible(!hasRecords);
    setRecords(parsed, statusPrefix);
    navigateToDetail();
    await onParsedRecordsOpened(parsed);
  }

  async function runFeatureSearch(options = {}) {
    const query = cleanText(options?.query ?? elements.featureSearchInput?.value, 600);
    state.featureSearchQuery = query;
    if (elements.featureSearchInput) {
      elements.featureSearchInput.value = query;
    }

    const storagePath = getStoragePath();
    if (!storagePath) {
      state.featureSearchResults = [];
      renderFeatureSearchResults();
      setFeatureSearchStatus('Set Storage Folder Path in Settings to search stored features.', true);
      return;
    }

    if (query.length < 2) {
      state.featureSearchResults = [];
      renderFeatureSearchResults();
      setFeatureSearchStatus('Enter at least 2 characters to search stored features.');
      return;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibrarySearchFeatures) {
      setFeatureSearchStatus('Feature search API unavailable.', true);
      return;
    }

    state.isSearchingFeatures = true;
    syncHomeControlsState();
    setFeatureSearchStatus(`Searching for "${query}"...`);

    try {
      const response = await bridge.sequenceLibrarySearchFeatures({
        storagePath,
        query,
        limit: 30
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to search stored features.');
      }

      state.featureSearchResults = Array.isArray(response.results) ? response.results : [];
      renderFeatureSearchResults();
      setFeatureSearchStatus(`Found ${state.featureSearchResults.length} matching feature${state.featureSearchResults.length === 1 ? '' : 's'}.`);
    } catch (error) {
      state.featureSearchResults = [];
      renderFeatureSearchResults();
      setFeatureSearchStatus(error?.message || 'Failed to search stored features.', true);
    } finally {
      state.isSearchingFeatures = false;
      syncHomeControlsState();
    }
  }

  async function openFeatureHostVector(entryId, status = '') {
    const resolvedEntryId = cleanText(entryId, 200);
    if (!resolvedEntryId) {
      return;
    }

    if (status === libraryStatusSaved || status === libraryStatusTemporary) {
      setLibraryFilter(status);
      await refreshLibraryEntries({ selectedId: resolvedEntryId, silent: true });
    } else {
      await setSelectedLibraryEntry(resolvedEntryId);
    }

    await openLibraryEntryInDetail(resolvedEntryId);
  }

  async function openLibraryEntryInDetail(entryId) {
    const storagePath = getStoragePath();
    if (!storagePath) {
      setHomeStatus('Set Storage Folder Path in Settings before opening library entries.', true);
      return;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibraryGet) {
      setHomeStatus('Sequence library storage API unavailable.', true);
      return;
    }

    try {
      const response = await bridge.sequenceLibraryGet({
        storagePath,
        id: cleanText(entryId, 200),
        includeGbk: true,
        includeAlignments: true
      });
      if (!response?.ok || !response?.entry) {
        throw new Error(response?.error || 'Failed to load sequence entry.');
      }

      const parsed = parseInputRecords(String(response.gbkText || ''), { maxRecords: DEFAULT_MAX_RECORDS });
      if (!Array.isArray(parsed.records) || !parsed.records.length) {
        throw new Error(parsed?.errors?.[0] || 'Stored sequence entry contains no valid records.');
      }

      state.activeEntryId = cleanText(response.entry.id, 200);
      state.activeEntryStatus = String(response.entry.status || '').toLowerCase();
      if (elements.inputTextarea) {
        elements.inputTextarea.value = String(response.gbkText || '');
      }
      if (elements.saveNameInput) {
        elements.saveNameInput.value = response.entry.name || parsed.records[0].name || 'sequence';
      }
      setMode('paste');
      setInputComposerVisible(false);
      setRecords(parsed, 'Loaded');
      onLibraryEntryLoaded({
        entry: response.entry,
        alignments: Array.isArray(response.alignments) ? response.alignments : []
      });
      navigateToDetail();
      setStatus(`Opened ${response.entry.name}.`);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to open sequence entry.', true);
    }
  }

  function bindEvents() {
    const ResizeObserverCtor = rootDocument?.defaultView?.ResizeObserver || globalThis?.ResizeObserver;
    if (elements.previewHost && typeof ResizeObserverCtor === 'function') {
      const previewResizeObserver = new ResizeObserverCtor(() => {
        schedulePreviewFrameHeightSync();
      });
      previewResizeObserver.observe(elements.previewHost);
    }
    globalThis.addEventListener?.('resize', () => {
      schedulePreviewFrameHeightSync();
    });

    if (elements.homeOpenInput && typeof elements.homeOpenInput.setAttribute === 'function') {
      elements.homeOpenInput.setAttribute('accept', fileAccept);
    }

    elements.homePasteBtn?.addEventListener('click', () => {
      onClearAll();
      navigateToDetail();
      setMode('paste');
      setInputComposerVisible(true);
      setStatus('Paste sequence text, then click Load.');
      elements.inputTextarea?.focus?.();
      setHomeStatus('Opened a new sequence detail page.');
    });

    elements.homeOpenBtn?.addEventListener('click', () => {
      elements.homeOpenInput?.click();
    });

    elements.homeOpenInput?.addEventListener('change', async () => {
      const file = elements.homeOpenInput.files?.[0];
      if (!file) {
        return;
      }

      try {
        setHomeStatus(`Reading ${file.name}...`);
        const text = await readFileAsText(file);
        const parsed = parseInputRecords(text, { maxRecords: DEFAULT_MAX_RECORDS });
        await openParsedRecordsInDetail(parsed, text, 'Loaded');
        setStatus(`Opened ${file.name} in detail workspace.`);
      } catch (error) {
        setHomeStatus(error?.message || 'Failed to open selected file.', true);
      } finally {
        elements.homeOpenInput.value = '';
      }
    });

    elements.libraryFilterSavedBtn?.addEventListener('click', () => {
      setLibraryFilter(libraryStatusSaved);
      void refreshLibraryEntries({ silent: true });
    });

    elements.libraryFilterTemporaryBtn?.addEventListener('click', () => {
      setLibraryFilter(libraryStatusTemporary);
      void refreshLibraryEntries({ silent: true });
    });

    elements.libraryList?.addEventListener('click', (event) => {
      const entryId = resolveLibraryEntryIdFromEvent(event);
      if (!entryId) {
        return;
      }
      if (Number.isFinite(Number(event?.detail)) && Number(event.detail) > 1) {
        return;
      }

      const now = Date.now();
      const previousEntryId = cleanText(state.lastLibraryClickEntryId, 200);
      const elapsedMs = now - (Number(state.lastLibraryClickAt) || 0);
      const isDoubleActivate = previousEntryId === entryId && elapsedMs >= 0 && elapsedMs <= 450;
      state.lastLibraryClickEntryId = entryId;
      state.lastLibraryClickAt = now;

      void setSelectedLibraryEntry(entryId);
      if (isDoubleActivate) {
        void openLibraryEntryInDetail(entryId);
      }
    });

    elements.libraryList?.addEventListener('dblclick', (event) => {
      const entryId = resolveLibraryEntryIdFromEvent(event);
      if (!entryId) {
        return;
      }
      void setSelectedLibraryEntry(entryId);
      void openLibraryEntryInDetail(entryId);
    });

    elements.featureSearchBtn?.addEventListener('click', () => {
      void runFeatureSearch();
    });

    elements.featureSearchInput?.addEventListener('keydown', (event) => {
      if (String(event?.key || '') !== 'Enter') {
        return;
      }
      event.preventDefault?.();
      void runFeatureSearch();
    });

    elements.featureSearchResults?.addEventListener('click', (event) => {
      const trigger = event?.target?.closest?.('[data-feature-host-entry-id]');
      const entryId = cleanText(trigger?.dataset?.featureHostEntryId, 200);
      if (!entryId) {
        return;
      }
      const status = cleanText(trigger?.dataset?.featureHostStatus, 40);
      void openFeatureHostVector(entryId, status);
    });
  }

  return {
    bindEvents,
    navigateToHome,
    navigateToDetail,
    openLibraryEntryInDetail,
    openParsedRecordsInDetail,
    refreshLibraryEntries,
    setHomeStatus,
    setLibraryFilter,
    setLocalWorkspaceVisibility,
    setSelectedLibraryEntry,
    syncHomeControlsState
  };
}
