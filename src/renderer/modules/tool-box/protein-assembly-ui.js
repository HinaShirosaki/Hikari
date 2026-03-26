import { escapeHtml, formatSequenceLines } from './common.js';
import { peptideStats } from './peptide.js';
import {
  PROTEIN_ASSEMBLY_PART_TYPES,
  getProteinAssemblyLibraryByType,
  defaultProteinAssemblyRows,
  sanitizeProteinAssemblySequence,
  buildProteinAssemblyConstruct
} from './protein-assembly.js';

export function initProteinAssemblyTool(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  if (!rootDocument) {
    return;
  }

  const proteinAssemblyForm = rootDocument.getElementById('protein-assembly-form');
  const proteinAssemblyConstructNameInput = rootDocument.getElementById('protein-assembly-name');
  const proteinAssemblyPoiNameInput = rootDocument.getElementById('protein-assembly-poi-name');
  const proteinAssemblyPoiSequenceInput = rootDocument.getElementById('protein-assembly-poi-sequence');
  const proteinAssemblyRows = rootDocument.getElementById('protein-assembly-rows');
  const proteinAssemblyAddBlockBtn = rootDocument.getElementById('protein-assembly-add-block-btn');
  const proteinAssemblyResetBtn = rootDocument.getElementById('protein-assembly-reset-btn');
  const proteinAssemblyResult = rootDocument.getElementById('protein-assembly-result');
  const proteinAssemblySequence = rootDocument.getElementById('protein-assembly-sequence');
  const proteinAssemblyMeta = rootDocument.getElementById('protein-assembly-meta');
  const proteinAssemblyMapSummary = rootDocument.getElementById('protein-assembly-map-summary');
  const proteinAssemblyTableBody = rootDocument.getElementById('protein-assembly-table-body');

  if (!proteinAssemblyForm || !proteinAssemblyRows || !proteinAssemblyResult) {
    return;
  }

  const proteinAssemblyState = {
    nextRowId: 1
  };

  function formatProteinAssemblyTypeOptions(selectedType = 'tag') {
    return PROTEIN_ASSEMBLY_PART_TYPES
      .map((typeEntry) => (
        `<option value="${typeEntry.id}"${typeEntry.id === selectedType ? ' selected' : ''}>${escapeHtml(typeEntry.label)}</option>`
      ))
      .join('');
  }

  function formatProteinAssemblyLibraryOptions(type, selectedId = '') {
    const libraryOptions = getProteinAssemblyLibraryByType(type);
    if (!libraryOptions.length) {
      return '<option value="">No library blocks</option>';
    }

    return libraryOptions
      .map((entry, index) => {
        const shouldSelect = selectedId
          ? entry.id === selectedId
          : index === 0;
        const selectedAttr = shouldSelect ? ' selected' : '';
        const detail = entry.note ? ` | ${entry.note}` : '';
        return `<option value="${entry.id}"${selectedAttr}>${escapeHtml(entry.label)} (${entry.sequence.length} aa${escapeHtml(detail)})</option>`;
      })
      .join('');
  }

  function describeProteinAssemblyLibrarySelection(type, libraryId) {
    const library = getProteinAssemblyLibraryByType(type);
    const selected = library.find((entry) => entry.id === libraryId) || library[0];
    if (!selected) {
      return 'No library block selected.';
    }
    const detail = selected.note ? `${selected.note} ` : '';
    return `${detail}Length: ${selected.sequence.length} aa.`;
  }

  function createProteinAssemblyRow(seed = {}) {
    const wrapper = rootDocument.createElement('div');
    wrapper.className = 'protein-assembly-row';
    wrapper.dataset.rowId = String(proteinAssemblyState.nextRowId++);

    const selectedType = seed.type || 'tag';
    wrapper.innerHTML = `
      <label>
        Block Type
        <select class="protein-assembly-row-type">
          ${formatProteinAssemblyTypeOptions(selectedType)}
        </select>
      </label>
      <label class="protein-assembly-library-wrap">
        Library Block
        <select class="protein-assembly-row-library"></select>
      </label>
      <label class="protein-assembly-custom-label-wrap" hidden>
        Custom Label
        <input class="protein-assembly-row-custom-label" placeholder="e.g. Targeting peptide" />
      </label>
      <label class="protein-assembly-custom-sequence-wrap" hidden>
        Custom Sequence
        <input class="protein-assembly-row-custom-sequence" placeholder="Amino-acid sequence" />
      </label>
      <div class="form-actions protein-assembly-row-actions">
        <button type="button" class="ghost-btn protein-assembly-up-btn">Up</button>
        <button type="button" class="ghost-btn protein-assembly-down-btn">Down</button>
        <button type="button" class="ghost-btn protein-assembly-remove-btn">Remove</button>
      </div>
      <p class="small-note protein-assembly-row-note"></p>
    `;

    const typeSelect = wrapper.querySelector('.protein-assembly-row-type');
    const librarySelect = wrapper.querySelector('.protein-assembly-row-library');
    const customLabelInput = wrapper.querySelector('.protein-assembly-row-custom-label');
    const customSequenceInput = wrapper.querySelector('.protein-assembly-row-custom-sequence');
    typeSelect.value = selectedType;
    librarySelect.value = seed.libraryId || '';
    customLabelInput.value = seed.customLabel || '';
    customSequenceInput.value = seed.customSequence || '';
    return wrapper;
  }

  function syncProteinAssemblyRow(row, seed = {}) {
    if (!row) {
      return;
    }

    const typeSelect = row.querySelector('.protein-assembly-row-type');
    const libraryWrap = row.querySelector('.protein-assembly-library-wrap');
    const librarySelect = row.querySelector('.protein-assembly-row-library');
    const customLabelWrap = row.querySelector('.protein-assembly-custom-label-wrap');
    const customSequenceWrap = row.querySelector('.protein-assembly-custom-sequence-wrap');
    const customLabelInput = row.querySelector('.protein-assembly-row-custom-label');
    const customSequenceInput = row.querySelector('.protein-assembly-row-custom-sequence');
    const rowNote = row.querySelector('.protein-assembly-row-note');
    const type = typeSelect.value;

    if (type === 'poi') {
      libraryWrap.hidden = true;
      customLabelWrap.hidden = true;
      customSequenceWrap.hidden = true;
      rowNote.textContent = 'Uses the POI sequence entered above.';
      return;
    }

    if (type === 'custom') {
      libraryWrap.hidden = true;
      customLabelWrap.hidden = false;
      customSequenceWrap.hidden = false;
      const customSequence = sanitizeProteinAssemblySequence(customSequenceInput.value, true);
      rowNote.textContent = customSequence.length
        ? `Custom block length: ${customSequence.length} aa.`
        : 'Enter a custom amino-acid sequence.';
      if (!customLabelInput.value.trim()) {
        customLabelInput.placeholder = 'Custom part';
      }
      return;
    }

    libraryWrap.hidden = false;
    customLabelWrap.hidden = true;
    customSequenceWrap.hidden = true;

    const preferredId = seed.libraryId || librarySelect.value || '';
    librarySelect.innerHTML = formatProteinAssemblyLibraryOptions(type, preferredId);
    const resolvedLibrary = getProteinAssemblyLibraryByType(type);
    if (!resolvedLibrary.some((entry) => entry.id === librarySelect.value) && resolvedLibrary[0]) {
      librarySelect.value = resolvedLibrary[0].id;
    }
    rowNote.textContent = describeProteinAssemblyLibrarySelection(type, librarySelect.value);
  }

  function addProteinAssemblyRow(seed = {}) {
    const row = createProteinAssemblyRow(seed);
    proteinAssemblyRows.appendChild(row);
    syncProteinAssemblyRow(row, seed);
  }

  function resetProteinAssemblyRows() {
    proteinAssemblyRows.innerHTML = '';
    defaultProteinAssemblyRows().forEach((row) => addProteinAssemblyRow(row));
  }

  function collectProteinAssemblyRows() {
    return [...proteinAssemblyRows.querySelectorAll('.protein-assembly-row')].map((row) => ({
      type: row.querySelector('.protein-assembly-row-type')?.value || 'custom',
      libraryId: row.querySelector('.protein-assembly-row-library')?.value || '',
      customLabel: row.querySelector('.protein-assembly-row-custom-label')?.value || '',
      customSequence: row.querySelector('.protein-assembly-row-custom-sequence')?.value || ''
    }));
  }

  function renderProteinAssemblyTable(rows) {
    if (!proteinAssemblyTableBody) {
      return;
    }

    if (!rows.length) {
      proteinAssemblyTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="small-note">No blocks assembled.</td>
        </tr>
      `;
      return;
    }

    proteinAssemblyTableBody.innerHTML = rows.map((row) => `
      <tr>
        <td>${row.index}</td>
        <td>${escapeHtml(row.label)}</td>
        <td>${escapeHtml(row.typeLabel)}</td>
        <td>${row.start}-${row.end}</td>
        <td>${row.length}</td>
        <td><span class="protein-assembly-cell-seq">${escapeHtml(row.sequence)}</span></td>
      </tr>
    `).join('');
  }

  function renderProteinAssembly() {
    const constructName = proteinAssemblyConstructNameInput?.value || '';
    const poiName = proteinAssemblyPoiNameInput?.value || '';
    const poiSequence = sanitizeProteinAssemblySequence(proteinAssemblyPoiSequenceInput?.value || '', true);
    const rows = collectProteinAssemblyRows();
    const assembled = buildProteinAssemblyConstruct({
      constructName,
      poiName,
      poiSequence,
      rows
    });

    const sequenceForStats = assembled.sequence.replace(/\*/g, '');
    const stats = sequenceForStats.length ? peptideStats(sequenceForStats) : null;
    const massText = stats ? `${stats.mass.toFixed(2)} Da` : 'n/a';
    const pIText = stats ? stats.pI.toFixed(2) : 'n/a';
    const chargeText = stats ? stats.netCharge7.toFixed(2) : 'n/a';

    if (proteinAssemblyMeta) {
      proteinAssemblyMeta.textContent = `${assembled.length} aa | ${assembled.parts.length} blocks`;
    }

    if (proteinAssemblyMapSummary) {
      const typeCounts = assembled.parts.reduce((acc, part) => {
        acc[part.type] = (acc[part.type] || 0) + 1;
        return acc;
      }, {});
      const segments = [
        `tags ${typeCounts.tag || 0}`,
        `linkers ${typeCounts.linker || 0}`,
        `cleavage ${typeCounts.cleavage || 0}`,
        `POI ${typeCounts.poi || 0}`,
        `custom ${typeCounts.custom || 0}`
      ];
      proteinAssemblyMapSummary.textContent = segments.join(' | ');
    }

    if (proteinAssemblySequence) {
      proteinAssemblySequence.innerHTML = assembled.sequence
        ? formatSequenceLines(assembled.sequence, 70)
        : '-';
    }

    renderProteinAssemblyTable(assembled.parts);

    const warningMarkup = assembled.warnings
      .map((warning) => `<p class="small-note">Warning: ${escapeHtml(warning)}</p>`)
      .join('');
    const errorMarkup = assembled.errors
      .map((error) => `<p class="small-note">Error: ${escapeHtml(error)}</p>`)
      .join('');
    const statusText = assembled.ok ? 'Ready for cloning/expression planning.' : 'Assembly has issues to resolve.';

    proteinAssemblyResult.innerHTML = `
      <p><strong>Construct:</strong> ${escapeHtml(assembled.constructName)}</p>
      <p><strong>Status:</strong> ${escapeHtml(statusText)}</p>
      <p><strong>Total length:</strong> ${assembled.length} aa</p>
      <p><strong>Estimated MW:</strong> ${massText}</p>
      <p><strong>Estimated pI:</strong> ${pIText}</p>
      <p><strong>Estimated net charge (pH 7.0):</strong> ${chargeText}</p>
      ${warningMarkup}
      ${errorMarkup}
    `;
  }

  resetProteinAssemblyRows();

  proteinAssemblyAddBlockBtn?.addEventListener('click', () => {
    addProteinAssemblyRow({ type: 'tag' });
    renderProteinAssembly();
  });

  proteinAssemblyResetBtn?.addEventListener('click', () => {
    resetProteinAssemblyRows();
    renderProteinAssembly();
  });

  proteinAssemblyRows.addEventListener('change', (event) => {
    const row = event.target.closest('.protein-assembly-row');
    if (!row) {
      return;
    }
    if (
      event.target.classList.contains('protein-assembly-row-type')
      || event.target.classList.contains('protein-assembly-row-library')
    ) {
      syncProteinAssemblyRow(row);
    }
    renderProteinAssembly();
  });

  proteinAssemblyRows.addEventListener('input', (event) => {
    const row = event.target.closest('.protein-assembly-row');
    if (!row) {
      renderProteinAssembly();
      return;
    }
    if (
      event.target.classList.contains('protein-assembly-row-custom-sequence')
      || event.target.classList.contains('protein-assembly-row-custom-label')
    ) {
      syncProteinAssemblyRow(row);
    }
    renderProteinAssembly();
  });

  proteinAssemblyRows.addEventListener('click', (event) => {
    const row = event.target.closest('.protein-assembly-row');
    if (!row) {
      return;
    }

    if (event.target.classList.contains('protein-assembly-remove-btn')) {
      row.remove();
      if (!proteinAssemblyRows.children.length) {
        addProteinAssemblyRow({ type: 'poi' });
      }
      renderProteinAssembly();
      return;
    }

    if (event.target.classList.contains('protein-assembly-up-btn')) {
      const previous = row.previousElementSibling;
      if (previous) {
        proteinAssemblyRows.insertBefore(row, previous);
        renderProteinAssembly();
      }
      return;
    }

    if (event.target.classList.contains('protein-assembly-down-btn')) {
      const next = row.nextElementSibling;
      if (next) {
        proteinAssemblyRows.insertBefore(next, row);
        renderProteinAssembly();
      }
    }
  });

  proteinAssemblyForm.addEventListener('input', (event) => {
    if (event.target.closest('.protein-assembly-row')) {
      return;
    }
    renderProteinAssembly();
  });

  proteinAssemblyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderProteinAssembly();
  });

  renderProteinAssembly();
}
