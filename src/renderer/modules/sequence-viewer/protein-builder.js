import { escapeHtml, formatSequenceLines } from '../tool-box/common.js';
import { cleanProteinSequence, translateDnaSequence } from '../tool-box/sequence.js';
import {
  PROTEIN_ASSEMBLY_CLEAVAGE_SITES,
  PROTEIN_ASSEMBLY_LINKERS,
  PROTEIN_ASSEMBLY_TAGS,
  sanitizeProteinAssemblySequence
} from '../tool-box/protein-assembly.js';
import { cleanText } from './shared.js';

const BLOCK_TYPE_LABELS = Object.freeze({
  tag: 'Tag',
  linker: 'Linker',
  cleavage: 'Cleavage Site',
  feature: 'Feature DB',
  custom: 'Custom',
  poi: 'POI'
});

const DNA_ALPHABET = /^[ACGTRYSWKMBDHVN*]+$/;
const DEFAULT_CHAIN = Object.freeze([
  { kind: 'library', type: 'tag', libraryId: 'his6' },
  { kind: 'library', type: 'cleavage', libraryId: 'tev' },
  { kind: 'poi', type: 'poi' }
]);

const COMMON_BLOCK_GROUPS = Object.freeze([
  {
    id: 'tag',
    label: 'Common peptide tags',
    items: PROTEIN_ASSEMBLY_TAGS
  },
  {
    id: 'linker',
    label: 'Linkers',
    items: PROTEIN_ASSEMBLY_LINKERS
  },
  {
    id: 'cleavage',
    label: 'Protease sites',
    items: PROTEIN_ASSEMBLY_CLEAVAGE_SITES
  }
]);

function buildLibraryLookup() {
  const lookup = new Map();
  COMMON_BLOCK_GROUPS.forEach((group) => {
    (group.items || []).forEach((item) => {
      lookup.set(`${group.id}:${item.id}`, {
        type: group.id,
        ...item
      });
    });
  });
  return lookup;
}

const LIBRARY_LOOKUP = buildLibraryLookup();

function getBlockTypeLabel(type) {
  return BLOCK_TYPE_LABELS[String(type || '').trim().toLowerCase()] || 'Custom';
}

function isLikelyDnaSequence(sequence) {
  const cleaned = String(sequence || '').toUpperCase().replace(/[^A-Z*]/g, '');
  return Boolean(cleaned) && DNA_ALPHABET.test(cleaned);
}

function buildFeatureDerivedSequence(feature) {
  const rawSequence = String(feature?.sequence || '').toUpperCase().replace(/[^A-Z*]/g, '');
  if (!rawSequence) {
    return {
      sequence: '',
      mode: 'empty',
      warnings: ['Stored feature has no sequence.'],
      sourceSequence: ''
    };
  }

  if (!isLikelyDnaSequence(rawSequence)) {
    return {
      sequence: cleanProteinSequence(rawSequence, true),
      mode: 'protein',
      warnings: [],
      sourceSequence: rawSequence
    };
  }

  const translation = translateDnaSequence(rawSequence, 1, 'star');
  const warnings = [];
  let protein = String(translation?.protein || '');
  if (protein.endsWith('*')) {
    protein = protein.slice(0, -1);
  }
  if (protein.includes('*')) {
    warnings.push('Translated feature contains an internal stop codon.');
  }
  if (translation?.remainderBases) {
    warnings.push(`${translation.remainderBases} trailing base(s) were ignored during translation.`);
  }
  if (!protein.length) {
    warnings.push('Stored feature did not yield an amino-acid block.');
  }
  return {
    sequence: sanitizeProteinAssemblySequence(protein, true),
    mode: 'translated',
    warnings,
    sourceSequence: rawSequence
  };
}

function cloneLibraryRow(nextRowId, type, libraryId) {
  const preset = LIBRARY_LOOKUP.get(`${type}:${libraryId}`);
  if (!preset) {
    return null;
  }
  return {
    id: `builder_row_${nextRowId}`,
    kind: 'library',
    type,
    libraryId,
    label: preset.label,
    sequence: preset.sequence,
    note: preset.note || ''
  };
}

function createPoiRow(nextRowId) {
  return {
    id: `builder_row_${nextRowId}`,
    kind: 'poi',
    type: 'poi',
    label: 'Protein of Interest',
    sequence: '',
    note: 'Uses the POI fields in the left column.'
  };
}

function createCustomRow(nextRowId) {
  return {
    id: `builder_row_${nextRowId}`,
    kind: 'custom',
    type: 'custom',
    label: 'Custom Block',
    sequence: '',
    note: 'Add a custom amino-acid block.'
  };
}

function createFeatureRow(nextRowId, feature) {
  const derived = buildFeatureDerivedSequence(feature);
  const hostCount = Math.max(0, Number(feature?.hostCount) || 0);
  const noteParts = [
    feature?.type ? `Stored type: ${feature.type}` : '',
    derived.mode === 'translated'
      ? `Translated from ${Math.max(0, Number(feature?.sequenceLength) || String(derived.sourceSequence || '').length)} nt`
      : 'Stored as protein sequence',
    hostCount ? `${hostCount} host vector${hostCount === 1 ? '' : 's'}` : ''
  ].filter(Boolean);

  return {
    id: `builder_row_${nextRowId}`,
    kind: 'feature',
    type: 'feature',
    label: cleanText(feature?.name, 140) || 'Feature Block',
    sequence: derived.sequence,
    note: noteParts.join(' | '),
    sourceFeatureId: cleanText(feature?.id, 200),
    sourceFeatureType: cleanText(feature?.type, 120),
    sourceSequence: derived.sourceSequence,
    warnings: derived.warnings
  };
}

function formatCount(count, singular, plural = `${singular}s`) {
  const safeCount = Math.max(0, Number(count) || 0);
  return `${safeCount} ${safeCount === 1 ? singular : plural}`;
}

function previewSequence(sequence, maxLength = 36) {
  const cleaned = sanitizeProteinAssemblySequence(sequence, true);
  if (!cleaned.length) {
    return '-';
  }
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength)}...`;
}

function escapeAttribute(value) {
  return escapeHtml(String(value || '')).replace(/"/g, '&quot;');
}

function buildConstruct(payload = {}) {
  const constructName = cleanText(payload?.constructName, 140) || 'Untitled construct';
  const poiName = cleanText(payload?.poiName, 140) || 'Protein of Interest';
  const poiSequence = sanitizeProteinAssemblySequence(payload?.poiSequence || '', true);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];

  const errors = [];
  const warnings = [];
  const parts = [];
  let poiCount = 0;

  rows.forEach((row, index) => {
    const rowType = String(row?.type || '').trim().toLowerCase();
    if (rowType === 'poi') {
      poiCount += 1;
      if (!poiSequence.length) {
        warnings.push('POI block exists, but POI sequence is empty.');
        return;
      }
      parts.push({
        index: index + 1,
        type: 'poi',
        typeLabel: getBlockTypeLabel('poi'),
        label: poiName,
        sequence: poiSequence,
        note: 'User-supplied POI sequence'
      });
      return;
    }

    const rowSequence = sanitizeProteinAssemblySequence(row?.sequence || '', true);
    const rowLabel = cleanText(row?.label, 160) || `Block ${index + 1}`;
    if (!rowSequence.length) {
      errors.push(`Block ${index + 1} (${rowLabel}) has no amino-acid sequence.`);
      return;
    }

    parts.push({
      index: index + 1,
      type: rowType || 'custom',
      typeLabel: getBlockTypeLabel(rowType || 'custom'),
      label: rowLabel,
      sequence: rowSequence,
      note: cleanText(row?.note, 240)
    });

    (Array.isArray(row?.warnings) ? row.warnings : []).forEach((warning) => {
      warnings.push(`${rowLabel}: ${warning}`);
    });
  });

  if (!poiCount) {
    warnings.push('No POI block is present in the chain.');
  }
  if (poiCount > 1) {
    warnings.push('Multiple POI blocks are present. The same POI sequence will repeat in the chain.');
  }
  if (!poiCount && poiSequence.length) {
    warnings.push('POI sequence is provided but not placed in the chain.');
  }

  let cursor = 1;
  const mappedParts = parts.map((part) => {
    const start = cursor;
    const end = cursor + part.sequence.length - 1;
    cursor = end + 1;
    return {
      ...part,
      length: part.sequence.length,
      start,
      end
    };
  });

  const sequence = mappedParts.map((part) => part.sequence).join('');
  const length = sequence.length;

  if (sequence.includes('*')) {
    if (sequence.endsWith('*') && sequence.indexOf('*') === sequence.length - 1) {
      warnings.push('Construct ends with a stop symbol (*).');
    } else {
      warnings.push('Construct contains an internal stop symbol (*).');
    }
  }
  if (length > 0 && sequence[0] !== 'M') {
    warnings.push('Construct does not start with M. Confirm the N-terminus before expression.');
  }
  if (length > 2500) {
    warnings.push('Construct is very long (>2500 aa). Verify cloning and expression feasibility.');
  }

  return {
    ok: length > 0 && errors.length === 0,
    constructName,
    poiName,
    parts: mappedParts,
    sequence,
    length,
    errors,
    warnings
  };
}

function buildFeatureResultMeta(feature) {
  const hostCount = Math.max(0, Number(feature?.hostCount) || 0);
  const derived = buildFeatureDerivedSequence(feature);
  const aaLength = sanitizeProteinAssemblySequence(derived.sequence, true).length;
  const sourceLength = Math.max(0, Number(feature?.sequenceLength) || String(derived.sourceSequence || '').length);
  const lengthText = derived.mode === 'translated'
    ? `${sourceLength} nt -> ${aaLength} aa`
    : `${aaLength} aa`;
  return {
    ...derived,
    lengthText,
    hostText: formatCount(hostCount, 'vector')
  };
}

export function createSequenceViewerProteinBuilderController(config = {}) {
  const elements = config?.elements || {};
  const getBridge = config?.getBridge || (() => null);
  const getStoragePath = config?.getStoragePath || (() => '');
  const hasStoragePath = config?.hasStoragePath || (() => false);
  const setStatus = config?.setStatus || (() => {});
  const onNavigateHome = typeof config?.onNavigateHome === 'function'
    ? config.onNavigateHome
    : (() => {});
  const onNavigateBuilder = typeof config?.onNavigateBuilder === 'function'
    ? config.onNavigateBuilder
    : (() => {});

  const state = {
    nextRowId: 1,
    rows: [],
    featureSearchQuery: '',
    featureSearchResults: [],
    isSearchingFeatures: false,
    statusMessage: 'Linear chain: each block accepts one upstream and one downstream connection.',
    statusError: false
  };

  function setBuilderStatus(message, isError = false) {
    state.statusMessage = String(message || '');
    state.statusError = isError === true;
    if (!elements.proteinBuilderStatus) {
      return;
    }
    elements.proteinBuilderStatus.textContent = state.statusMessage;
    elements.proteinBuilderStatus.style.color = state.statusError ? 'var(--danger)' : '';
  }

  function setFeatureSearchStatus(message, isError = false) {
    if (!elements.proteinBuilderFeatureSearchStatus) {
      return;
    }
    elements.proteinBuilderFeatureSearchStatus.textContent = String(message || '');
    elements.proteinBuilderFeatureSearchStatus.style.color = isError ? 'var(--danger)' : '';
  }

  function syncFeatureSearchControls() {
    const disabled = !hasStoragePath() || Boolean(state.isSearchingFeatures);
    if (elements.proteinBuilderFeatureSearchInput) {
      elements.proteinBuilderFeatureSearchInput.disabled = disabled;
    }
    if (elements.proteinBuilderFeatureSearchBtn) {
      elements.proteinBuilderFeatureSearchBtn.disabled = disabled;
    }
  }

  function appendRow(row, options = {}) {
    if (!row) {
      return;
    }
    const insertBeforePoi = options?.insertBeforePoi !== false;
    const poiIndex = state.rows.findIndex((item) => item.type === 'poi');
    if (insertBeforePoi && row.type !== 'poi' && poiIndex >= 0) {
      state.rows.splice(poiIndex, 0, row);
      return;
    }
    state.rows.push(row);
  }

  function resetRows() {
    state.rows = [];
    DEFAULT_CHAIN.forEach((entry) => {
      if (entry.kind === 'library') {
        appendRow(cloneLibraryRow(state.nextRowId++, entry.type, entry.libraryId), { insertBeforePoi: false });
      }
      if (entry.kind === 'poi') {
        appendRow(createPoiRow(state.nextRowId++), { insertBeforePoi: false });
      }
    });
  }

  function currentRows() {
    return state.rows.map((row) => ({ ...row }));
  }

  function renderCommonGroup(group) {
    const itemsMarkup = group.items.map((item) => `
      <button
        type="button"
        class="sequence-viewer-protein-builder-common-item"
        data-protein-builder-add-library-type="${escapeAttribute(group.id)}"
        data-protein-builder-add-library-id="${escapeAttribute(item.id)}"
      >
        <span class="sequence-viewer-protein-builder-common-item-name">${escapeHtml(item.label)}</span>
        <span class="sequence-viewer-protein-builder-common-item-meta">${escapeHtml(`${item.sequence.length} aa`)}</span>
      </button>
    `).join('');

    if (group.id === 'tag' || group.id === 'linker') {
      return `
        <details class="sequence-viewer-protein-builder-common-fold">
          <summary>
            <span>${escapeHtml(group.label)}</span>
            <span class="sequence-viewer-protein-builder-common-fold-meta">${escapeHtml(formatCount(group.items.length, 'block'))}</span>
          </summary>
          <div class="sequence-viewer-protein-builder-common-list">
            ${itemsMarkup}
          </div>
        </details>
      `;
    }

    return `
      <section class="sequence-viewer-protein-builder-common-group">
        <h5>${escapeHtml(group.label)}</h5>
        <div class="sequence-viewer-protein-builder-common-list">
          ${itemsMarkup}
        </div>
      </section>
    `;
  }

  function renderCommonBlocks() {
    if (!elements.proteinBuilderCommonBlocks) {
      return;
    }
    elements.proteinBuilderCommonBlocks.innerHTML = COMMON_BLOCK_GROUPS.map((group) => renderCommonGroup(group)).join('');
  }

  function renderFeatureSearchResults() {
    if (!elements.proteinBuilderFeatureSearchResults) {
      return;
    }

    const query = cleanText(state.featureSearchQuery, 600);
    const results = Array.isArray(state.featureSearchResults) ? state.featureSearchResults : [];
    if (!query) {
      elements.proteinBuilderFeatureSearchResults.innerHTML = '<p class="small-note">Search by feature name or stored sequence.</p>';
      return;
    }
    if (!results.length) {
      elements.proteinBuilderFeatureSearchResults.innerHTML = `<p class="small-note">No stored features matched "${escapeHtml(query)}".</p>`;
      return;
    }

    elements.proteinBuilderFeatureSearchResults.innerHTML = results.map((feature) => {
      const meta = buildFeatureResultMeta(feature);
      return `
        <article class="sequence-viewer-protein-builder-feature-item">
          <div class="sequence-viewer-protein-builder-feature-head">
            <div>
              <strong>${escapeHtml(feature?.name || 'feature')}</strong>
              <p class="small-note">${escapeHtml(feature?.type || 'feature')} | ${escapeHtml(meta.lengthText)} | ${escapeHtml(meta.hostText)}</p>
            </div>
            <button
              type="button"
              class="ghost-btn"
              data-protein-builder-feature-add-id="${escapeAttribute(feature?.id || '')}"
            >
              Add Block
            </button>
          </div>
          <p class="sequence-viewer-protein-builder-feature-sequence">${escapeHtml(previewSequence(meta.sequence || feature?.sequence || ''))}</p>
          ${meta.warnings.length
            ? `<p class="small-note">${escapeHtml(meta.warnings.join(' | '))}</p>`
            : ''}
        </article>
      `;
    }).join('');
  }

  function renderWorkflow() {
    if (!elements.proteinBuilderWorkflow) {
      return;
    }

    const poiName = cleanText(elements.proteinBuilderPoiNameInput?.value, 140) || 'Protein of Interest';
    const poiSequence = sanitizeProteinAssemblySequence(elements.proteinBuilderPoiSequenceInput?.value || '', true);

    if (!state.rows.length) {
      elements.proteinBuilderWorkflow.innerHTML = '<p class="small-note">Add a block to start the chain.</p>';
      return;
    }

    elements.proteinBuilderWorkflow.innerHTML = state.rows.map((row, index) => {
      const label = row.type === 'poi' ? poiName : row.label;
      const sequence = row.type === 'poi' ? poiSequence : sanitizeProteinAssemblySequence(row.sequence || '', true);
      const note = row.type === 'poi'
        ? `Uses the POI sequence from the left column. ${sequence.length ? `${sequence.length} aa.` : 'Sequence required.'}`
        : (row.note || 'No annotation.');

      const customFields = row.kind === 'custom'
        ? `
          <div class="sequence-viewer-protein-builder-custom-fields">
            <label>
              Label
              <input
                type="text"
                value="${escapeAttribute(row.label)}"
                data-protein-builder-custom-label="${escapeAttribute(row.id)}"
              />
            </label>
            <label>
              Sequence
              <input
                type="text"
                value="${escapeAttribute(row.sequence)}"
                data-protein-builder-custom-sequence="${escapeAttribute(row.id)}"
                placeholder="Amino-acid sequence"
              />
            </label>
          </div>
        `
        : '';

      const connector = index > 0
        ? '<div class="sequence-viewer-protein-builder-link" aria-hidden="true"><span></span></div>'
        : '';

      return `
        ${connector}
        <article class="sequence-viewer-protein-builder-block sequence-viewer-protein-builder-block-${escapeAttribute(row.type)}" data-protein-builder-row-id="${escapeAttribute(row.id)}">
          <div class="sequence-viewer-protein-builder-block-studs" aria-hidden="true">
            <span></span>
            <span></span>
          </div>
          <div class="sequence-viewer-protein-builder-block-body">
            <div class="sequence-viewer-protein-builder-block-head">
              <div>
                <strong>${escapeHtml(label || `Block ${index + 1}`)}</strong>
                <p class="small-note">${escapeHtml(getBlockTypeLabel(row.type))} | ${escapeHtml(`${sequence.length} aa`)}</p>
              </div>
              <div class="form-actions sequence-viewer-protein-builder-block-actions">
                <button type="button" class="ghost-btn" data-protein-builder-row-up="${escapeAttribute(row.id)}">Up</button>
                <button type="button" class="ghost-btn" data-protein-builder-row-down="${escapeAttribute(row.id)}">Down</button>
                <button type="button" class="ghost-btn" data-protein-builder-row-remove="${escapeAttribute(row.id)}">Remove</button>
              </div>
            </div>
            ${customFields}
            <p class="small-note">${escapeHtml(note)}</p>
            <p class="sequence-viewer-protein-builder-block-sequence">${escapeHtml(previewSequence(sequence))}</p>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderSummary() {
    const construct = buildConstruct({
      constructName: elements.proteinBuilderNameInput?.value,
      poiName: elements.proteinBuilderPoiNameInput?.value,
      poiSequence: elements.proteinBuilderPoiSequenceInput?.value,
      rows: currentRows()
    });

    if (elements.proteinBuilderMeta) {
      elements.proteinBuilderMeta.textContent = `${construct.length} aa | ${construct.parts.length} blocks`;
    }

    if (elements.proteinBuilderSequence) {
      elements.proteinBuilderSequence.innerHTML = construct.sequence
        ? formatSequenceLines(construct.sequence, 70)
        : '-';
    }
  }

  function moveRow(rowId, direction) {
    const index = state.rows.findIndex((row) => row.id === rowId);
    if (index < 0) {
      return;
    }

    const targetIndex = direction === 'up'
      ? index - 1
      : index + 1;
    if (targetIndex < 0 || targetIndex >= state.rows.length) {
      return;
    }
    const [row] = state.rows.splice(index, 1);
    state.rows.splice(targetIndex, 0, row);
  }

  function removeRow(rowId) {
    state.rows = state.rows.filter((row) => row.id !== rowId);
  }

  function addPoiRow() {
    if (state.rows.some((row) => row.type === 'poi')) {
      setBuilderStatus('POI block already exists in the chain.');
      return;
    }
    appendRow(createPoiRow(state.nextRowId++), { insertBeforePoi: false });
    render();
  }

  function addCustomRow() {
    appendRow(createCustomRow(state.nextRowId++));
    render();
  }

  function addLibraryRow(type, libraryId) {
    const row = cloneLibraryRow(state.nextRowId++, type, libraryId);
    if (!row) {
      return;
    }
    appendRow(row);
    render();
  }

  function addFeatureRowById(featureId) {
    const feature = (state.featureSearchResults || []).find((item) => cleanText(item?.id, 200) === cleanText(featureId, 200));
    if (!feature) {
      return;
    }
    appendRow(createFeatureRow(state.nextRowId++, feature));
    render();
  }

  async function runFeatureSearch(options = {}) {
    const query = cleanText(options?.query ?? elements.proteinBuilderFeatureSearchInput?.value, 600);
    state.featureSearchQuery = query;
    if (elements.proteinBuilderFeatureSearchInput) {
      elements.proteinBuilderFeatureSearchInput.value = query;
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
      state.featureSearchResults = [];
      renderFeatureSearchResults();
      setFeatureSearchStatus('Feature search API unavailable.', true);
      return;
    }

    state.isSearchingFeatures = true;
    syncFeatureSearchControls();
    setFeatureSearchStatus(`Searching for "${query}"...`);

    try {
      const response = await bridge.sequenceLibrarySearchFeatures({
        storagePath,
        query,
        limit: 24
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
      syncFeatureSearchControls();
    }
  }

  function render() {
    renderCommonBlocks();
    renderFeatureSearchResults();
    renderWorkflow();
    renderSummary();
    syncFeatureSearchControls();
    if (!state.featureSearchQuery) {
      setFeatureSearchStatus(
        hasStoragePath()
          ? 'Search stored features and convert them into protein blocks.'
          : 'Set Storage Folder Path in Settings to search stored features.',
        !hasStoragePath()
      );
    }
    setBuilderStatus(state.statusMessage, state.statusError);
  }

  function bindEvents() {
    elements.homeProteinBuilderBtn?.addEventListener('click', () => {
      onNavigateBuilder();
      setStatus('Opened Protein Builder.');
      setBuilderStatus('Protein Builder is ready.');
    });

    elements.detailProteinBuilderBtn?.addEventListener('click', () => {
      onNavigateBuilder();
      setStatus('Opened Protein Builder.');
      setBuilderStatus('Protein Builder is ready.');
    });

    elements.proteinBuilderBackBtn?.addEventListener('click', () => {
      onNavigateHome();
      setBuilderStatus('Returned to Sequence Library.');
    });

    elements.proteinBuilderResetBtn?.addEventListener('click', () => {
      resetRows();
      setBuilderStatus('Reset the chain to the default layout.');
      render();
    });

    elements.proteinBuilderAddCustomBtn?.addEventListener('click', () => {
      addCustomRow();
      setBuilderStatus('Added a custom block.');
    });

    elements.proteinBuilderAddPoiBtn?.addEventListener('click', () => {
      addPoiRow();
    });

    elements.proteinBuilderForm?.addEventListener('input', () => {
      render();
    });

    elements.proteinBuilderCommonBlocks?.addEventListener('click', (event) => {
      const trigger = event?.target?.closest?.('[data-protein-builder-add-library-id]');
      const type = cleanText(trigger?.dataset?.proteinBuilderAddLibraryType, 40);
      const libraryId = cleanText(trigger?.dataset?.proteinBuilderAddLibraryId, 120);
      if (!type || !libraryId) {
        return;
      }
      addLibraryRow(type, libraryId);
      setBuilderStatus(`Added ${libraryId} to the chain.`);
    });

    elements.proteinBuilderFeatureSearchBtn?.addEventListener('click', () => {
      void runFeatureSearch();
    });

    elements.proteinBuilderFeatureSearchInput?.addEventListener('keydown', (event) => {
      if (String(event?.key || '') !== 'Enter') {
        return;
      }
      event.preventDefault?.();
      void runFeatureSearch();
    });

    elements.proteinBuilderFeatureSearchResults?.addEventListener('click', (event) => {
      const trigger = event?.target?.closest?.('[data-protein-builder-feature-add-id]');
      const featureId = cleanText(trigger?.dataset?.proteinBuilderFeatureAddId, 200);
      if (!featureId) {
        return;
      }
      addFeatureRowById(featureId);
      setBuilderStatus('Added feature-derived block to the chain.');
    });

    elements.proteinBuilderWorkflow?.addEventListener('click', (event) => {
      const removeTrigger = event?.target?.closest?.('[data-protein-builder-row-remove]');
      const upTrigger = event?.target?.closest?.('[data-protein-builder-row-up]');
      const downTrigger = event?.target?.closest?.('[data-protein-builder-row-down]');

      if (removeTrigger?.dataset?.proteinBuilderRowRemove) {
        removeRow(cleanText(removeTrigger.dataset.proteinBuilderRowRemove, 160));
        render();
        return;
      }
      if (upTrigger?.dataset?.proteinBuilderRowUp) {
        moveRow(cleanText(upTrigger.dataset.proteinBuilderRowUp, 160), 'up');
        render();
        return;
      }
      if (downTrigger?.dataset?.proteinBuilderRowDown) {
        moveRow(cleanText(downTrigger.dataset.proteinBuilderRowDown, 160), 'down');
        render();
      }
    });

    elements.proteinBuilderWorkflow?.addEventListener('input', (event) => {
      const customLabelTrigger = event?.target?.closest?.('[data-protein-builder-custom-label]');
      const customSequenceTrigger = event?.target?.closest?.('[data-protein-builder-custom-sequence]');

      if (customLabelTrigger?.dataset?.proteinBuilderCustomLabel) {
        const rowId = cleanText(customLabelTrigger.dataset.proteinBuilderCustomLabel, 160);
        const row = state.rows.find((item) => item.id === rowId);
        if (row) {
          row.label = cleanText(customLabelTrigger.value, 160) || 'Custom Block';
        }
        render();
        return;
      }

      if (customSequenceTrigger?.dataset?.proteinBuilderCustomSequence) {
        const rowId = cleanText(customSequenceTrigger.dataset.proteinBuilderCustomSequence, 160);
        const row = state.rows.find((item) => item.id === rowId);
        if (row) {
          row.sequence = sanitizeProteinAssemblySequence(customSequenceTrigger.value, true);
        }
        render();
      }
    });
  }

  resetRows();
  render();

  return {
    bindEvents,
    render
  };
}
