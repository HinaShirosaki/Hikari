import { escapeHtml } from '../../../../lib/html.js';
import { normalizeFeatureType } from '../../feature-types.js';
import { parseInputRecords } from '../../parsing.js';
import {
  clamp,
  cleanText,
  normalizeSequenceText,
  reverseComplementIupac
} from '../../shared.js';
import { buildSequenceMapSvg } from '../sequence-map.js';
import { showTransientNotice } from '../../../../lib/notify.js';

// The "replace this feature with a stored one" dialog: searching the sequence
// library for a matching feature, previewing its host vector, and splicing the
// chosen sequence into the record.
function createVectorFeatureReplace({
  elements,
  state,
  vb,
  getSelectedRecord,
  getBridge,
  getStoragePath,
  setStatus,
  persistFeatureMutation,
  onApplySequenceEdit,
  sequenceEditing,
  clearSelection,
  hideContextMenu,
  getFeatureByIndex,
  getFeatureRange,
  getRecordedFeaturesInRange,
  formatRangeLabel,
  isPrimerRelatedType,
  render
} = {}) {
  let featureReplaceIndex = -1;
  let featureReplaceQuery = '';
  let featureReplaceResults = [];
  // The same stored feature usually sits in several vectors, and which one is
  // picked is the plasmid the fragment gets amplified from, so the choice is
  // held until Confirm rather than applied on the first click.
  let featureReplaceSelectedId = '';
  let featureReplaceHostId = '';
  // Hydrated host records, keyed by library entry id: the search result carries
  // only the occurrence, and a map needs the whole plasmid.
  const featureReplaceHostRecords = new Map();
  // Every preview load owns a token, so a slow read for a vector the user has
  // already clicked past cannot overwrite the current preview.
  let featureReplaceHostRequestId = 0;
  // Search responses can also finish out of order; only the newest query owns
  // the result list and status text.
  let featureReplaceSearchRequestId = 0;


  function hideFeatureReplaceDialog() {
    featureReplaceIndex = -1;
    featureReplaceSelectedId = '';
    featureReplaceHostId = '';
    featureReplaceHostRequestId += 1;
    featureReplaceSearchRequestId += 1;
    if (elements.vectorBuilderFeatureReplaceOverlay) {
      elements.vectorBuilderFeatureReplaceOverlay.hidden = true;
    }
  }

  function setFeatureReplaceStatus(message, isError = false) {
    if (isError && message) {
      showTransientNotice(message, { type: 'error' });
    }
    if (!elements.vectorBuilderFeatureReplaceStatus) {
      return;
    }
    elements.vectorBuilderFeatureReplaceStatus.textContent = String(message || '');
    elements.vectorBuilderFeatureReplaceStatus.classList.toggle('is-error', Boolean(isError));
  }

  function describeFeatureReplaceTarget(record) {
    const feature = (Array.isArray(record?.features) ? record.features : [])[featureReplaceIndex] || null;
    const range = getFeatureRange(feature, Math.max(0, Number(record?.sequence?.length) || 0));
    if (!feature || !range || !elements.vectorBuilderFeatureReplaceNote) {
      return;
    }
    elements.vectorBuilderFeatureReplaceNote.textContent =
      `Replacing ${feature.name || feature.type || 'feature'} at ${formatRangeLabel(range)} with a stored feature.`;
  }

  function renderFeatureReplaceResults() {
    const host = elements.vectorBuilderFeatureReplaceResults;
    if (!host) {
      return;
    }
    // Below the 2-character minimum no search has run, so the panel stays quiet
    // instead of claiming nothing matched.
    if (featureReplaceQuery.length < 2) {
      host.innerHTML = '';
      return;
    }
    if (!featureReplaceResults.length) {
      host.innerHTML = `<p class="small-note">No stored features matched "${escapeHtml(featureReplaceQuery)}".</p>`;
      return;
    }
    host.innerHTML = featureReplaceResults.map((feature) => {
      const length = Math.max(0, Number(feature?.sequenceLength) || normalizeSequenceText(feature?.sequence || '').length);
      const featureId = cleanText(feature?.id, 200);
      const hostCount = Math.max(0, Number(feature?.hostCount) || asArrayOf(feature?.hosts).length);
      const featureName = feature?.name || 'feature';
      const selected = featureId && featureId === featureReplaceSelectedId;
      return `
        <article
          class="sequence-viewer-protein-builder-feature-item${selected ? ' is-selected' : ''}"
          role="button"
          tabindex="0"
          aria-pressed="${selected ? 'true' : 'false'}"
          aria-label="Use ${escapeHtml(featureName)} feature"
          data-vector-replace-feature-id="${escapeHtml(featureId)}"
        >
          <div class="sequence-viewer-protein-builder-feature-head">
            <div>
              <strong>${escapeHtml(featureName)}</strong>
              <p class="small-note">${escapeHtml(feature?.type || 'feature')} | ${length.toLocaleString()} bp | in ${hostCount} vector${hostCount === 1 ? '' : 's'}</p>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  function asArrayOf(value) {
    return Array.isArray(value) ? value : [];
  }

  function getSelectedStoredFeature() {
    return featureReplaceResults
      .find((feature) => cleanText(feature?.id, 200) === featureReplaceSelectedId) || null;
  }

  function getStoredFeatureHosts(feature) {
    return asArrayOf(feature?.hosts).filter((entry) => cleanText(entry?.hostVectorId, 200));
  }

  function getSelectedHost() {
    const hosts = getStoredFeatureHosts(getSelectedStoredFeature());
    return hosts.find((entry) => cleanText(entry?.hostVectorId, 200) === featureReplaceHostId) || null;
  }

  function renderFeatureReplaceHosts() {
    const host = elements.vectorBuilderFeatureReplaceHosts;
    if (!host) {
      return;
    }
    const feature = getSelectedStoredFeature();
    if (!feature) {
      host.innerHTML = '<p class="small-note">Pick a stored feature to list the vectors that carry it.</p>';
      return;
    }
    const hosts = getStoredFeatureHosts(feature);
    if (!hosts.length) {
      host.innerHTML = '<p class="small-note">No source vector is recorded for this feature.</p>';
      return;
    }
    host.innerHTML = hosts.map((entry) => {
      const hostId = cleanText(entry?.hostVectorId, 200);
      const selected = hostId === featureReplaceHostId;
      const length = Math.max(0, Number(entry?.sequenceLength) || 0);
      const copies = asArrayOf(entry?.locations).length;
      return `
        <button
          type="button"
          class="sequence-viewer-feature-source-item${selected ? ' is-selected' : ''}"
          aria-pressed="${selected ? 'true' : 'false'}"
          data-vector-replace-host-id="${escapeHtml(hostId)}"
        >
          <strong>${escapeHtml(cleanText(entry?.hostVectorName, 160) || 'stored vector')}</strong>
          <span class="small-note">${length.toLocaleString()} bp | ${escapeHtml(cleanText(entry?.topology, 40) || 'circular')} | ${copies} copy${copies === 1 ? '' : ' sites'}</span>
        </button>
      `;
    }).join('');
  }

  function renderFeatureReplacePreview(message = '') {
    const host = elements.vectorBuilderFeatureReplacePreview;
    if (!host) {
      return;
    }
    const selectedHost = getSelectedHost();
    const record = selectedHost
      ? featureReplaceHostRecords.get(cleanText(selectedHost.hostVectorId, 200))
      : null;
    if (record?.sequence?.length) {
      host.innerHTML = buildSequenceMapSvg(record, { features: asArrayOf(record.features) });
      return;
    }
    host.innerHTML = `<p class="small-note">${escapeHtml(message
      || (selectedHost ? 'Loading plasmid preview...' : 'Pick a source vector to preview it.'))}</p>`;
  }

  function syncFeatureReplaceConfirm() {
    if (!elements.vectorBuilderFeatureReplaceConfirm) {
      return;
    }
    elements.vectorBuilderFeatureReplaceConfirm.disabled = !getSelectedStoredFeature();
  }

  function clearFeatureReplaceSelection() {
    featureReplaceResults = [];
    featureReplaceSelectedId = '';
    featureReplaceHostId = '';
    featureReplaceHostRequestId += 1;
    renderFeatureReplaceSelection();
  }

  function renderFeatureReplaceSelection() {
    renderFeatureReplaceResults();
    renderFeatureReplaceHosts();
    renderFeatureReplacePreview();
    syncFeatureReplaceConfirm();
  }

  async function loadFeatureReplacePreview() {
    const selectedHost = getSelectedHost();
    const hostId = cleanText(selectedHost?.hostVectorId, 200);
    featureReplaceHostRequestId += 1;
    const requestId = featureReplaceHostRequestId;
    if (!hostId || featureReplaceHostRecords.has(hostId)) {
      renderFeatureReplacePreview();
      return;
    }
    const bridge = getBridge();
    const storagePath = getStoragePath();
    if (!bridge?.sequenceLibraryGet || !storagePath) {
      renderFeatureReplacePreview('Plasmid preview needs the sequence library storage folder.');
      return;
    }
    renderFeatureReplacePreview();
    try {
      const response = await bridge.sequenceLibraryGet({ storagePath, id: hostId, includeGbk: true });
      if (!response?.ok) {
        throw new Error(response?.error || 'That vector could not be read.');
      }
      const parsed = parseInputRecords(String(response.gbkText || ''));
      const record = (Array.isArray(parsed?.records) ? parsed.records : [])[0] || null;
      if (requestId !== featureReplaceHostRequestId) {
        return;
      }
      if (!record?.sequence?.length) {
        renderFeatureReplacePreview('That vector has no sequence to preview.');
        return;
      }
      featureReplaceHostRecords.set(hostId, record);
      renderFeatureReplacePreview();
    } catch (error) {
      if (requestId !== featureReplaceHostRequestId) {
        return;
      }
      renderFeatureReplacePreview(cleanText(error?.message || error, 200) || 'Plasmid preview unavailable.');
    }
  }

  function selectFeatureReplaceResult(featureId) {
    const safeId = cleanText(featureId, 200);
    if (!safeId || safeId === featureReplaceSelectedId) {
      return;
    }
    featureReplaceSelectedId = safeId;
    // The first host is the most recently updated one, which is the vector most
    // likely still on the bench.
    featureReplaceHostId = cleanText(
      getStoredFeatureHosts(getSelectedStoredFeature())[0]?.hostVectorId,
      200
    );
    renderFeatureReplaceSelection();
    void loadFeatureReplacePreview();
  }

  function selectFeatureReplaceHost(hostId) {
    const safeId = cleanText(hostId, 200);
    if (!safeId || safeId === featureReplaceHostId) {
      return;
    }
    featureReplaceHostId = safeId;
    renderFeatureReplaceSelection();
    void loadFeatureReplacePreview();
  }

  async function runFeatureReplaceSearch() {
    const query = cleanText(elements.vectorBuilderFeatureReplaceSearch?.value, 600);
    featureReplaceSearchRequestId += 1;
    const requestId = featureReplaceSearchRequestId;
    featureReplaceQuery = query;
    const storagePath = getStoragePath();
    const bridge = getBridge();

    if (!storagePath) {
      clearFeatureReplaceSelection();
      setFeatureReplaceStatus('Set Storage Folder Path in Settings to search stored features.', true);
      return;
    }
    if (query.length < 2) {
      clearFeatureReplaceSelection();
      setFeatureReplaceStatus('');
      return;
    }
    if (!bridge?.sequenceLibrarySearchFeatures) {
      clearFeatureReplaceSelection();
      setFeatureReplaceStatus('Feature search API unavailable.', true);
      return;
    }

    setFeatureReplaceStatus(`Searching for "${query}"...`);
    try {
      const response = await bridge.sequenceLibrarySearchFeatures({ storagePath, query, limit: 24 });
      if (requestId !== featureReplaceSearchRequestId) {
        return;
      }
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to search stored features.');
      }
      featureReplaceResults = (Array.isArray(response.results) ? response.results : [])
        .filter((feature) => normalizeSequenceText(feature?.sequence || '').length > 0)
        .filter((feature) => !isPrimerRelatedType(feature?.type));
      featureReplaceSelectedId = '';
      featureReplaceHostId = '';
      renderFeatureReplaceSelection();
      setFeatureReplaceStatus('');
    } catch (error) {
      if (requestId !== featureReplaceSearchRequestId) {
        return;
      }
      clearFeatureReplaceSelection();
      setFeatureReplaceStatus(error?.message || 'Failed to search stored features.', true);
    }
  }

  function hideOverlays() {
    hideContextMenu();
    hideFeatureReplaceDialog();
    sequenceEditing.hideSequenceEditDialog();
  }

  function openFeatureReplaceDialog(record, range) {
    const candidates = getRecordedFeaturesInRange(record, range);
    if (!candidates.length) {
      setStatus('No replaceable feature in that range. Primer binding sites cannot be replaced.', true);
      return;
    }

    // Prefer whichever feature is already selected on the map.
    const selected = getFeatureByIndex(record, vb().selectedFeatureIndex);
    const preferred = candidates.find((entry) => entry.feature === selected) || candidates[0];
    featureReplaceIndex = preferred.index;
    featureReplaceQuery = '';
    clearFeatureReplaceSelection();

    if (elements.vectorBuilderFeatureReplaceSearch) {
      elements.vectorBuilderFeatureReplaceSearch.value = '';
    }

    describeFeatureReplaceTarget(record);
    renderFeatureReplaceSelection();
    const hasStorage = Boolean(getStoragePath());
    setFeatureReplaceStatus(
      hasStorage
        ? ''
        : 'Set Storage Folder Path in Settings to search stored features.',
      !hasStorage
    );
    if (elements.vectorBuilderFeatureReplaceOverlay) {
      elements.vectorBuilderFeatureReplaceOverlay.hidden = false;
    }
    elements.vectorBuilderFeatureReplaceSearch?.focus?.();
  }

  async function applyFeatureReplace(storedFeatureId) {
    const stored = featureReplaceResults
      .find((item) => cleanText(item?.id, 200) === cleanText(storedFeatureId, 200));
    const record = getSelectedRecord();
    const target = (Array.isArray(record?.features) ? record.features : [])[featureReplaceIndex] || null;
    const range = getFeatureRange(target, Math.max(0, Number(record?.sequence?.length) || 0));
    if (!stored || !target || !range) {
      return;
    }

    const storedSequence = normalizeSequenceText(stored.sequence || '');
    if (!storedSequence.length) {
      setFeatureReplaceStatus('That stored feature has no sequence to insert.', true);
      return;
    }

    // Keep the site's orientation: dropping a stored (plus-strand) sequence onto
    // a reverse-strand feature has to go in as its reverse complement, or the
    // construct reads the wrong way round.
    const strand = Number(target.strand) === -1 ? -1 : 1;
    const replacement = strand === -1 ? reverseComplementIupac(storedSequence) : storedSequence;
    const targetIndex = featureReplaceIndex;
    const previousName = String(target.name || 'feature');
    const nextName = cleanText(stored.name, 140) || previousName;

    const sourceHost = getSelectedHost();
    const sourceVectorName = cleanText(sourceHost?.hostVectorName, 160);
    try {
      // Rewrite the bases through the shared edit action, which drops the old
      // feature, truncates neighbours and feeds the Cloning Design handoff. The
      // chosen vector rides along as the donor, since that is the plasmid this
      // fragment has to be amplified from.
      await onApplySequenceEdit({
        mode: 'replace',
        range,
        sequence: replacement,
        replacedFeature: target,
        donorEntryId: cleanText(sourceHost?.hostVectorId, 200),
        donorName: sourceVectorName
      });
    } catch (error) {
      setFeatureReplaceStatus(error?.message || 'Failed to replace the feature.', true);
      return;
    }

    const editedRecord = getSelectedRecord();
    const features = Array.isArray(editedRecord?.features) ? [...editedRecord.features] : [];
    features.splice(Math.min(targetIndex, features.length), 0, {
      ...target,
      name: nextName,
      type: normalizeFeatureType(cleanText(stored.type, 120)),
      strand,
      locationText: '',
      source: 'vector_builder',
      description: sourceVectorName
        ? `Replaced from ${sourceVectorName} (${storedSequence.length} bp).`
        : `Replaced from the stored feature database (${storedSequence.length} bp).`,
      segments: [{ start: range.start, end: range.start + replacement.length }]
    });
    const records = [...state.records];
    const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, records.length - 1));
    const nextRecord = { ...records[selectedIndex], features };
    records[selectedIndex] = nextRecord;
    state.records = records;

    hideFeatureReplaceDialog();
    clearSelection();
    vb().selectedFeatureIndex = -1;
    render();

    try {
      await persistFeatureMutation(nextRecord, `Replaced ${previousName} with ${nextName}.`);
    } catch (error) {
      setStatus(error?.message || 'Replaced the feature but failed to save it.', true);
      return;
    }
    setStatus(`Replaced ${previousName} with stored feature ${nextName} (${replacement.length.toLocaleString()} bp).`);
  }

  return {
    getSelectedFeatureReplaceId: () => featureReplaceSelectedId,
    getSelectedStoredFeature,
    hideFeatureReplaceDialog,
    setFeatureReplaceStatus,
    renderFeatureReplaceResults,
    renderFeatureReplaceHosts,
    renderFeatureReplacePreview,
    syncFeatureReplaceConfirm,
    clearFeatureReplaceSelection,
    renderFeatureReplaceSelection,
    loadFeatureReplacePreview,
    selectFeatureReplaceResult,
    selectFeatureReplaceHost,
    runFeatureReplaceSearch,
    hideOverlays,
    openFeatureReplaceDialog,
    applyFeatureReplace
  };
}

export { createVectorFeatureReplace };
