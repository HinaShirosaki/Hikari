import {
  axisLabel,
  escapeCsv,
  oppositeAxis,
  parseCsvLine,
  sanitizeFilePart
} from './shared.js';
import {
  applyAxisTemplate,
  buildAllWells,
  buildMappedWellSet,
  filterResultsToMappedWells,
  getAssayAxisTemplateValues,
  getAxisLength,
  getPlateDefinition,
  isValidWellForDefinition,
  layoutToMap,
  layoutsEqual,
  mergeAxisTemplateValues,
  normalizeCurrentAxisTemplateValues,
  normalizeLayout,
  normalizeManualWellOverrideMap,
  normalizeResults,
  parseWellId,
  removeSuppressedWellsFromLayout,
  sortLayout,
  toRowLabel,
  wellIdFor
} from './plate-model.js';

export function createAssayLayoutManager({
  runtime,
  elements,
  safeText,
  getInventorySamples,
  setCsvStatus,
  setLayoutStatus,
  setResultStatus,
  renderResultTable,
  clearAnalysisOutput
}) {
  const {
    assayConcentrationAxisDisplay,
    assayImportFile,
    assayLayoutList,
    assayNumberDisplay,
    assayPlateDefinition,
    assayPlateFieldConcentrationBtn,
    assayPlateFieldSampleBtn,
    assayPlatePreview,
    assaySerialDilutionContent,
    assaySerialDilutionOverlay,
    assaySerialDilutionSummary,
    assaySerialDilutionVolumeInput,
    assaySampleAxisColumnBtn,
    assaySampleAxisInput,
    assaySampleAxisRowBtn,
    assayNameInput,
    assayPlateTypeInput
  } = elements;
  const samplePickerState = {
    wellId: '',
    query: ''
  };
  const serialDilutionState = {
    stockConcentrations: Object.create(null)
  };
  const assaySamplePicker = document.createElement('div');
  assaySamplePicker.className = 'assay-sample-picker';
  assaySamplePicker.hidden = true;
  document.body.append(assaySamplePicker);

  function getCurrentDefinition() {
    return getPlateDefinition(assayPlateTypeInput?.value);
  }

  function getSampleAxis() {
    return assaySampleAxisInput?.value === 'column' ? 'column' : 'row';
  }

  function setAxisTemplateValues(values, def = getCurrentDefinition(), sampleAxis = getSampleAxis()) {
    runtime.axisTemplateValues = normalizeCurrentAxisTemplateValues(values, def, sampleAxis);
    return runtime.axisTemplateValues;
  }

  function hasAxisTemplateValues(values) {
    return (Array.isArray(values) ? values : []).some((item) => String(item || '').trim());
  }

  function readAxisValuesFromPlatePreview() {
    if (!assayPlatePreview) {
      return null;
    }
    const rowInputs = [...assayPlatePreview.querySelectorAll('[data-axis-dimension="row"]')];
    const columnInputs = [...assayPlatePreview.querySelectorAll('[data-axis-dimension="column"]')];
    if (!rowInputs.length && !columnInputs.length) {
      return null;
    }
    const def = getCurrentDefinition();
    const sampleAxis = getSampleAxis();
    const sampleLength = getAxisLength(sampleAxis, def);
    const concentrationLength = getAxisLength(oppositeAxis(sampleAxis), def);
    const sampleValues = new Array(sampleLength).fill('');
    const concentrationValues = new Array(concentrationLength).fill('');
    rowInputs.forEach((input) => {
      const index = Number(input.dataset.axisIndex);
      if (!Number.isFinite(index) || index < 0) {
        return;
      }
      const text = String(input.value || '').trim();
      if (sampleAxis === 'row') {
        if (index < sampleValues.length) {
          sampleValues[index] = text;
        }
      } else if (index < concentrationValues.length) {
        concentrationValues[index] = text;
      }
    });
    columnInputs.forEach((input) => {
      const index = Number(input.dataset.axisIndex);
      if (!Number.isFinite(index) || index < 0) {
        return;
      }
      const text = String(input.value || '').trim();
      if (sampleAxis === 'column') {
        if (index < sampleValues.length) {
          sampleValues[index] = text;
        }
      } else if (index < concentrationValues.length) {
        concentrationValues[index] = text;
      }
    });
    return {
      sampleValues,
      concentrationValues
    };
  }

  function getAxisTemplateValues({ includePreview = true } = {}) {
    return mergeAxisTemplateValues({
      def: getCurrentDefinition(),
      sampleAxis: getSampleAxis(),
      sources: includePreview
        ? [runtime.axisTemplateValues, readAxisValuesFromPlatePreview()]
        : [runtime.axisTemplateValues]
    });
  }

  function normalizeManualWellOverrides(def) {
    runtime.manualWellOverrides = normalizeManualWellOverrideMap(runtime.manualWellOverrides, def);
  }

  function normalizeSuppressedWells(def) {
    const validIds = new Set(buildAllWells(def).map((item) => item.well));
    runtime.suppressedWells = new Set(
      Array.from(runtime.suppressedWells || [])
        .map((well) => String(well || '').trim().toUpperCase())
        .filter((well) => validIds.has(well))
    );
  }

  function getMappedWellSet() {
    return buildMappedWellSet(runtime.currentLayout);
  }

  function isMappedWell(wellId) {
    return getMappedWellSet().has(String(wellId || '').trim().toUpperCase());
  }

  function filterMappedResults(results) {
    return filterResultsToMappedWells(results, runtime.currentLayout);
  }

  function setLayoutFromAxisAndOverrides({ preserveActiveWell = true, axisValues = null } = {}) {
    const def = getCurrentDefinition();
    const sampleAxis = getSampleAxis();
    const normalizedAxisValues = axisValues
      ? normalizeCurrentAxisTemplateValues(axisValues, def, sampleAxis)
      : getAxisTemplateValues();
    const { sampleValues, concentrationValues } = normalizedAxisValues;
    setAxisTemplateValues(normalizedAxisValues, def, sampleAxis);
    normalizeManualWellOverrides(def);
    normalizeSuppressedWells(def);
    const baseLayout = applyAxisTemplate({
      def,
      sampleAxis,
      sampleValues,
      concentrationValues
    });
    const map = layoutToMap(baseLayout);
    Object.entries(runtime.manualWellOverrides).forEach(([well, value]) => {
      const sampleId = String(value?.sampleId || '').trim();
      const concentration = String(value?.concentration || '').trim();
      if (!sampleId && !concentration) {
        delete map[well];
        return;
      }
      map[well] = { sampleId, concentration };
    });
    runtime.suppressedWells.forEach((well) => {
      delete map[well];
    });
    runtime.currentLayout = normalizeLayout(Object.entries(map).map(([well, value]) => ({
      well,
      sampleId: value.sampleId,
      concentration: value.concentration
    })), def);
    runtime.currentResults = filterMappedResults(runtime.currentResults);
    if (preserveActiveWell && runtime.activeWellEditorId && !isValidWellForDefinition(runtime.activeWellEditorId, def)) {
      runtime.activeWellEditorId = '';
    }
  }

  function getEffectiveWellMapping(wellId) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    if (!normalizedWell) {
      return { sampleId: '', concentration: '' };
    }
    const currentMap = layoutToMap(runtime.currentLayout);
    const current = currentMap[normalizedWell];
    if (current) {
      return {
        sampleId: String(current.sampleId || '').trim(),
        concentration: String(current.concentration || '').trim()
      };
    }
    return { sampleId: '', concentration: '' };
  }

  function updateActiveWellPreviewState() {
    if (!assayPlatePreview) {
      return;
    }
    [...assayPlatePreview.querySelectorAll('[data-well]')].forEach((cell) => {
      cell.classList.toggle('is-active', String(cell.dataset.well || '').trim().toUpperCase() === runtime.activeWellEditorId);
    });
  }

  function setActiveWellSelection(wellId) {
    runtime.activeWellEditorId = String(wellId || '').trim().toUpperCase();
    updateActiveWellPreviewState();
  }

  function inventorySampleDisplayValue(sample) {
    return String(sample?.code || sample?.name || sample?.id || '').trim();
  }

  function getInventorySampleOptions() {
    return (typeof getInventorySamples === 'function' ? getInventorySamples() : [])
      .map((sample) => {
        const code = String(sample?.code || '').trim();
        const name = String(sample?.name || '').trim();
        const type = String(sample?.type || '').trim();
        const concentration = String(sample?.concentration || '').trim();
        const value = inventorySampleDisplayValue(sample);
        if (!value) {
          return null;
        }
        return {
          id: String(sample?.id || '').trim(),
          value,
          code,
          name,
          type,
          concentration,
          searchText: [
            value,
            code,
            name,
            type,
            concentration,
            sample?.lot,
            sample?.notes
          ].join(' ').toLowerCase()
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.value.localeCompare(right.value, undefined, { sensitivity: 'base' }));
  }

  function findInventorySampleRecordBySampleId(sampleId) {
    const target = String(sampleId || '').trim();
    if (!target) {
      return null;
    }
    return (typeof getInventorySamples === 'function' ? getInventorySamples() : []).find((sample) => {
      const candidates = [
        inventorySampleDisplayValue(sample),
        sample?.code,
        sample?.name,
        sample?.id
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      return candidates.includes(target);
    }) || null;
  }

  function parseConcentrationMagnitude(value) {
    const text = String(value || '').trim();
    if (!text) {
      return null;
    }
    const match = text.match(/([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-zA-Zµμ]*)/);
    if (!match) {
      return null;
    }
    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    const rawUnit = String(match[2] || '').toLowerCase().replace('μ', 'u').replace('µ', 'u');
    const scaleMap = {
      fm: 1e-15,
      pm: 1e-12,
      nm: 1e-9,
      um: 1e-6,
      mm: 1e-3,
      cm: 1e-2,
      m: 1,
      gm: 1,
      mg: 1e-3,
      ug: 1e-6,
      ng: 1e-9,
      pg: 1e-12,
      kg: 1e3
    };
    const unit = rawUnit.replace(/\/.*$/, '');
    const scale = scaleMap[unit] || 1;
    return numeric * scale;
  }

  function formatDecimal(value) {
    if (!Number.isFinite(value)) {
      return '';
    }
    const absolute = Math.abs(value);
    const decimals = absolute >= 100 ? 1 : absolute >= 10 ? 2 : absolute >= 1 ? 3 : 4;
    return value.toFixed(decimals).replace(/\.?0+$/, '');
  }

  function formatVolumeText(value) {
    return Number.isFinite(value) ? `${formatDecimal(value)} uL` : '-';
  }

  function hideInventorySamplePicker() {
    samplePickerState.wellId = '';
    samplePickerState.query = '';
    assaySamplePicker.hidden = true;
    assaySamplePicker.innerHTML = '';
  }

  function positionInventorySamplePicker(clientX, clientY) {
    const margin = 12;
    const rect = assaySamplePicker.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    assaySamplePicker.style.left = `${Math.min(Math.max(margin, clientX), maxLeft)}px`;
    assaySamplePicker.style.top = `${Math.min(Math.max(margin, clientY), maxTop)}px`;
  }

  function applyInventorySampleToWell(wellId, sampleValue) {
    updateInlineWellOverride(wellId, 'sampleId', sampleValue);
    renderLayoutList();
    renderPlatePreview();
    renderResultTable();
    setLayoutStatus(`Updated ${wellId} from inventory.`);
    setCsvStatus(`Mapped wells: ${runtime.currentLayout.length}.`);
    requestAnimationFrame(() => {
      assayPlatePreview
        ?.querySelector(`[data-well="${wellId}"] [data-well-inline-field="sampleId"]`)
        ?.focus();
    });
  }

  function renderInventorySamplePicker() {
    if (!samplePickerState.wellId) {
      hideInventorySamplePicker();
      return;
    }

    const options = getInventorySampleOptions();
    const query = samplePickerState.query.trim().toLowerCase();
    const filtered = query
      ? options.filter((item) => item.searchText.includes(query))
      : options;
    const currentValue = getEffectiveWellMapping(samplePickerState.wellId).sampleId;

    assaySamplePicker.innerHTML = `
      <div class="assay-sample-picker-head">
        <strong>Select Sample</strong>
        <span>${safeText(samplePickerState.wellId)}</span>
      </div>
      <div class="assay-sample-picker-search">
        <input
          type="search"
          class="assay-sample-picker-search-input"
          value="${safeText(samplePickerState.query)}"
          placeholder="Search inventory samples"
          aria-label="Search inventory samples"
        />
      </div>
      <div class="assay-sample-picker-list">
        ${currentValue ? `
          <button type="button" class="assay-sample-picker-item assay-sample-picker-clear" data-assay-sample-picker-clear="true">
            <span class="assay-sample-picker-item-title">Clear Sample</span>
            <span class="assay-sample-picker-item-meta">Remove the Sample ID for ${safeText(samplePickerState.wellId)}</span>
          </button>
        ` : ''}
        ${filtered.length ? filtered.map((item) => `
          <button
            type="button"
            class="assay-sample-picker-item${item.value === currentValue ? ' is-current' : ''}"
            data-assay-sample-picker-value="${safeText(item.value)}"
            title="${safeText(item.name || item.value)}"
          >
            <span class="assay-sample-picker-item-title">${safeText(item.value)}</span>
            <span class="assay-sample-picker-item-meta">${safeText([
              item.name && item.name !== item.value ? item.name : '',
              item.type || '',
              item.concentration || ''
            ].filter(Boolean).join(' • ') || 'Inventory sample')}</span>
          </button>
        `).join('') : '<p class="small-note assay-sample-picker-empty">No inventory samples match this search.</p>'}
      </div>
    `;
    assaySamplePicker.hidden = false;

    const searchInput = assaySamplePicker.querySelector('.assay-sample-picker-search-input');
    searchInput?.addEventListener('input', (event) => {
      samplePickerState.query = String(event.target?.value || '');
      renderInventorySamplePicker();
      const nextInput = assaySamplePicker.querySelector('.assay-sample-picker-search-input');
      nextInput?.focus();
      nextInput?.setSelectionRange(samplePickerState.query.length, samplePickerState.query.length);
    });

    assaySamplePicker.querySelectorAll('[data-assay-sample-picker-value]').forEach((button) => {
      button.addEventListener('click', () => {
        const wellId = samplePickerState.wellId;
        const nextValue = String(button.getAttribute('data-assay-sample-picker-value') || '').trim();
        hideInventorySamplePicker();
        if (!wellId) {
          return;
        }
        applyInventorySampleToWell(wellId, nextValue);
      });
    });

    assaySamplePicker.querySelector('[data-assay-sample-picker-clear="true"]')?.addEventListener('click', () => {
      const wellId = samplePickerState.wellId;
      hideInventorySamplePicker();
      if (!wellId) {
        return;
      }
      applyInventorySampleToWell(wellId, '');
    });
  }

  function showInventorySamplePicker(wellId, clientX, clientY) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    if (!normalizedWell) {
      return;
    }
    samplePickerState.wellId = normalizedWell;
    samplePickerState.query = '';
    setActiveWellSelection(normalizedWell);
    renderInventorySamplePicker();
    positionInventorySamplePicker(clientX, clientY);
    assaySamplePicker.querySelector('.assay-sample-picker-search-input')?.focus();
  }

  function getSerialDilutionStockValue(sampleId) {
    if (Object.prototype.hasOwnProperty.call(serialDilutionState.stockConcentrations, sampleId)) {
      return serialDilutionState.stockConcentrations[sampleId];
    }
    const inventorySample = findInventorySampleRecordBySampleId(sampleId);
    const nextValue = String(inventorySample?.concentration || '').trim();
    serialDilutionState.stockConcentrations[sampleId] = nextValue;
    return nextValue;
  }

  function buildSerialDilutionGroups() {
    const sampleAxis = getSampleAxis();
    const groupsBySample = new Map();

    sortLayout(runtime.currentLayout).forEach((item) => {
      const sampleId = String(item?.sampleId || '').trim();
      const concentration = String(item?.concentration || '').trim();
      if (!sampleId || !concentration) {
        return;
      }
      const parsed = parseWellId(item.well);
      if (!parsed) {
        return;
      }
      const sampleOrder = sampleAxis === 'row' ? parsed.rowIndex : parsed.columnIndex;
      const concentrationIndex = sampleAxis === 'row' ? parsed.columnIndex : parsed.rowIndex;
      if (!groupsBySample.has(sampleId)) {
        groupsBySample.set(sampleId, {
          sampleId,
          sampleOrder,
          entriesByIndex: new Map(),
          hasConflict: false
        });
      }
      const group = groupsBySample.get(sampleId);
      const existing = group.entriesByIndex.get(concentrationIndex);
      if (!existing) {
        group.entriesByIndex.set(concentrationIndex, {
          concentrationIndex,
          concentrationLabel: concentration,
          magnitude: parseConcentrationMagnitude(concentration),
          wells: [item.well]
        });
        return;
      }
      existing.wells.push(item.well);
      if (!existing.concentrationLabel && concentration) {
        existing.concentrationLabel = concentration;
        existing.magnitude = parseConcentrationMagnitude(concentration);
        return;
      }
      if (existing.concentrationLabel !== concentration) {
        group.hasConflict = true;
      }
    });

    return [...groupsBySample.values()]
      .sort((left, right) => {
        if (left.sampleOrder !== right.sampleOrder) {
          return left.sampleOrder - right.sampleOrder;
        }
        return left.sampleId.localeCompare(right.sampleId, undefined, { sensitivity: 'base' });
      })
      .map((group) => {
        const entries = [...group.entriesByIndex.values()]
          .sort((left, right) => left.concentrationIndex - right.concentrationIndex)
          .map((entry) => ({
            ...entry,
            wellLabel: entry.wells.join(', ')
          }));
        let lastNonZeroIndex = -1;
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          if (Number.isFinite(entries[index].magnitude) && entries[index].magnitude > 0) {
            lastNonZeroIndex = index;
            break;
          }
        }
        return {
          sampleId: group.sampleId,
          sampleOrder: group.sampleOrder,
          hasConflict: group.hasConflict,
          inventorySample: findInventorySampleRecordBySampleId(group.sampleId),
          entries,
          chainEntries: lastNonZeroIndex >= 0 ? entries.slice(0, lastNonZeroIndex + 1) : [],
          trailingEntries: lastNonZeroIndex >= 0 ? entries.slice(lastNonZeroIndex + 1) : entries.slice()
        };
      });
  }

  function calculateSerialDilutionPlan({ group, volumePerWellUl, stockConcentrationText }) {
    const notes = [];
    const trailingZeroEntries = group.trailingEntries.filter((entry) => entry.magnitude === 0);
    const trailingOtherEntries = group.trailingEntries.filter((entry) => entry.magnitude !== 0);

    if (group.hasConflict) {
      notes.push('Multiple mapped wells for one concentration position had different concentration labels. Using the first one.');
    }
    if (trailingZeroEntries.length) {
      notes.push(`Skipped trailing 0 concentration well${trailingZeroEntries.length === 1 ? '' : 's'}: ${trailingZeroEntries.map((entry) => entry.wellLabel).join('; ')}.`);
    }
    if (trailingOtherEntries.length) {
      notes.push(`Ignored trailing wells without a positive concentration: ${trailingOtherEntries.map((entry) => entry.wellLabel).join('; ')}.`);
    }
    if (!(Number.isFinite(volumePerWellUl) && volumePerWellUl > 0)) {
      return {
        rows: [],
        notes,
        error: 'Enter a positive volume per well to calculate the dilution recipe.'
      };
    }
    if (!group.chainEntries.length) {
      return {
        rows: [],
        notes,
        error: 'Add at least one mapped well with a positive concentration for this sample.'
      };
    }
    if (group.chainEntries.some((entry) => !(Number.isFinite(entry.magnitude) && entry.magnitude > 0))) {
      return {
        rows: [],
        notes,
        error: 'Concentrations must stay positive until the last active dilution well.'
      };
    }

    const stockMagnitude = parseConcentrationMagnitude(stockConcentrationText);
    if (!(Number.isFinite(stockMagnitude) && stockMagnitude > 0)) {
      return {
        rows: [],
        notes,
        error: 'Enter a valid stock concentration for this sample.'
      };
    }

    const rows = group.chainEntries.map((entry) => ({
      ...entry,
      inputLabel: '',
      inputVolume: null,
      bufferVolume: null,
      prepVolume: null,
      outputLabel: '-',
      outputVolume: 0,
      discardVolume: 0,
      finalVolume: volumePerWellUl
    }));

    if (!(stockMagnitude > rows[0].magnitude)) {
      return {
        rows: [],
        notes,
        error: 'Stock concentration must be higher than the first target concentration.'
      };
    }

    if (rows.length > 1) {
      for (let index = rows.length - 1; index >= 1; index -= 1) {
        const current = rows[index];
        const previous = rows[index - 1];
        const ratio = current.magnitude / previous.magnitude;
        if (!(ratio > 0 && ratio < 1)) {
          return {
            rows: [],
            notes,
            error: `Concentrations must decrease in dilution order (${previous.wellLabel} -> ${current.wellLabel}).`
          };
        }

        const outputVolume = index === rows.length - 1
          ? ((ratio * volumePerWellUl) / (1 - ratio))
          : rows[index + 1].inputVolume;

        if (!(Number.isFinite(outputVolume) && outputVolume > 0)) {
          return {
            rows: [],
            notes,
            error: `Could not calculate the carryover volume for ${current.wellLabel}.`
          };
        }

        const prepVolume = volumePerWellUl + outputVolume;
        const inputVolume = ratio * prepVolume;
        const bufferVolume = prepVolume - inputVolume;
        if (!(Number.isFinite(inputVolume) && inputVolume > 0 && inputVolume < prepVolume)) {
          return {
            rows: [],
            notes,
            error: `Could not calculate a valid transfer volume into ${current.wellLabel}.`
          };
        }

        current.inputLabel = `From ${previous.wellLabel}`;
        current.inputVolume = inputVolume;
        current.bufferVolume = bufferVolume;
        current.prepVolume = prepVolume;
        current.outputLabel = index === rows.length - 1 ? 'Discard' : `To ${rows[index + 1].wellLabel}`;
        current.outputVolume = outputVolume;
        current.discardVolume = index === rows.length - 1 ? outputVolume : 0;
      }
    }

    const firstOutputVolume = rows.length > 1 ? rows[1].inputVolume : 0;
    const firstPrepVolume = volumePerWellUl + firstOutputVolume;
    const stockVolume = (rows[0].magnitude / stockMagnitude) * firstPrepVolume;
    const firstBufferVolume = firstPrepVolume - stockVolume;
    if (!(Number.isFinite(stockVolume) && stockVolume > 0 && stockVolume < firstPrepVolume)) {
      return {
        rows: [],
        notes,
        error: `Could not calculate a valid stock dilution volume for ${rows[0].wellLabel}.`
      };
    }

    rows[0].inputLabel = 'From stock';
    rows[0].inputVolume = stockVolume;
    rows[0].bufferVolume = firstBufferVolume;
    rows[0].prepVolume = firstPrepVolume;
    rows[0].outputLabel = rows.length > 1 ? `To ${rows[1].wellLabel}` : '-';
    rows[0].outputVolume = firstOutputVolume;
    rows[0].discardVolume = 0;

    return { rows, notes, error: '' };
  }

  function renderSerialDilutionDialog() {
    if (!assaySerialDilutionContent || !assaySerialDilutionSummary) {
      return;
    }

    const groups = buildSerialDilutionGroups();
    const volumePerWellUl = Number(assaySerialDilutionVolumeInput?.value);
    const concentrationAxisName = axisLabel(oppositeAxis(getSampleAxis()));

    if (!groups.length) {
      assaySerialDilutionSummary.textContent = 'Map sample IDs and concentrations on the plate first.';
      assaySerialDilutionContent.innerHTML = '<p class="small-note">No mapped sample dilution series are available yet.</p>';
      return;
    }

    assaySerialDilutionSummary.textContent = `Calculated from the current ${concentrationAxisName} order. Trailing 0 concentration control wells are skipped from the serial dilution chain.`;

    const renderSerialDilutionTable = (headers, rows, className = '') => {
      if (!rows.length) {
        return '';
      }
      return `
        <div class="assay-serial-dilution-table-wrap">
          <table class="assay-serial-dilution-table ${className}">
            <thead>
              <tr>
                ${headers.map((header) => `<th>${safeText(header)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map((cells) => `
                <tr>
                  ${cells.map((cell) => `<td>${safeText(cell)}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    };

    const matchesSharedFollowingRecipe = (rows, referenceRows) => {
      if (rows.length !== referenceRows.length) {
        return false;
      }
      return rows.every((row, index) => {
        const referenceRow = referenceRows[index];
        return String(row.concentrationLabel || '') === String(referenceRow.concentrationLabel || '')
          && formatVolumeText(row.inputVolume) === formatVolumeText(referenceRow.inputVolume)
          && formatVolumeText(row.bufferVolume) === formatVolumeText(referenceRow.bufferVolume)
          && formatVolumeText(row.outputVolume) === formatVolumeText(referenceRow.outputVolume)
          && formatVolumeText(row.finalVolume) === formatVolumeText(referenceRow.finalVolume)
          && (row.outputLabel === 'Discard') === (referenceRow.outputLabel === 'Discard');
      });
    };

    const sampleInputTable = `
      <div class="assay-serial-dilution-stock-table-wrap">
        <table class="assay-serial-dilution-stock-table">
          <thead>
            <tr>
              <th>Sample</th>
              <th>Conc</th>
            </tr>
          </thead>
          <tbody>
            ${groups.map((group) => {
              const stockValue = getSerialDilutionStockValue(group.sampleId);
              return `
                <tr>
                  <td>${safeText(group.sampleId)}</td>
                  <td>
                    <input
                      type="text"
                      value="${safeText(stockValue)}"
                      placeholder="e.g. 10 mM"
                      data-assay-serial-stock-sample="${safeText(group.sampleId)}"
                    />
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="small-note">Stock concentration is loaded from inventory when available. You can edit any value in the table above.</p>
    `;

    const planResults = groups.map((group) => {
      const stockValue = getSerialDilutionStockValue(group.sampleId);
      return {
        group,
        plan: calculateSerialDilutionPlan({
          group,
          volumePerWellUl,
          stockConcentrationText: stockValue
        })
      };
    });

    const feedbackLines = planResults.flatMap(({ group, plan }) => {
      const lines = [];
      if (plan.error) {
        lines.push(`<p class="small-note assay-serial-dilution-error">${safeText(`${group.sampleId}: ${plan.error}`)}</p>`);
      }
      for (const note of plan.notes) {
        lines.push(`<p class="small-note assay-serial-dilution-note">${safeText(`${group.sampleId}: ${note}`)}</p>`);
      }
      return lines;
    }).join('');

    const validPlans = planResults.filter(({ plan }) => plan.rows.length && !plan.error);
    const initialDilutionRows = validPlans.map(({ group, plan }) => {
      const firstRow = plan.rows[0];
      return [
        group.sampleId,
        formatVolumeText(firstRow.inputVolume),
        formatVolumeText(firstRow.bufferVolume)
      ];
    });

    const referenceFollowingRows = validPlans.find(({ plan }) => plan.rows.length > 1)?.plan.rows.slice(1) || [];
    const followingRowsAreShared = referenceFollowingRows.length
      ? validPlans.every(({ plan }) => matchesSharedFollowingRecipe(plan.rows.slice(1), referenceFollowingRows))
      : true;

    const initialDilutionSection = initialDilutionRows.length
      ? `
        <section class="assay-serial-dilution-sample">
          <div class="assay-serial-dilution-sample-head">
            <h4>Initial Dilution</h4>
          </div>
          <p class="small-note">Prepare the first active dilution well for each sample using its stock concentration.</p>
          ${renderSerialDilutionTable(
            ['Sample', 'Stock Vol.', 'Buffer Vol.'],
            initialDilutionRows,
            'assay-serial-dilution-table-compact'
          )}
        </section>
      `
      : '';

    const followingDilutionRows = referenceFollowingRows.map((row, index) => [
      `Step ${index + 1}`,
      row.concentrationLabel,
      formatVolumeText(row.inputVolume),
      formatVolumeText(row.bufferVolume),
      row.outputLabel === 'Discard'
        ? `Discard ${formatVolumeText(row.outputVolume)}`
        : `Transfer ${formatVolumeText(row.outputVolume)}`,
      formatVolumeText(row.finalVolume)
    ]);

    const followingDilutionSection = referenceFollowingRows.length
      ? `
        <section class="assay-serial-dilution-sample">
          <div class="assay-serial-dilution-sample-head">
            <h4>Following Dilution</h4>
          </div>
          <p class="small-note">Repeat this same downstream dilution sequence for every sample after the initial well is prepared.</p>
          ${!followingRowsAreShared ? '<p class="small-note assay-serial-dilution-note">Following-dilution rows were not identical across every sample, so this table is based on the first valid sample sequence.</p>' : ''}
          ${renderSerialDilutionTable(
            ['Step', 'Target Conc.', 'From Previous Well', 'Buffer Vol.', 'Transfer / Discard', 'Final Vol.'],
            followingDilutionRows
          )}
        </section>
      `
      : validPlans.length
        ? `
        <section class="assay-serial-dilution-sample">
          <div class="assay-serial-dilution-sample-head">
            <h4>Following Dilution</h4>
          </div>
          <p class="small-note">No downstream dilution steps are needed for the current mapped series.</p>
        </section>
      `
        : '';

    const emptyState = !validPlans.length
      ? '<p class="small-note">No serial dilution recipe could be calculated yet.</p>'
      : '';

    assaySerialDilutionContent.innerHTML = `${sampleInputTable}${feedbackLines}${initialDilutionSection}${followingDilutionSection}${emptyState}`;
  }

  function openSerialDilutionDialog() {
    if (!assaySerialDilutionOverlay) {
      return;
    }
    hideInventorySamplePicker();
    assaySerialDilutionOverlay.hidden = false;
    renderSerialDilutionDialog();
    assaySerialDilutionVolumeInput?.focus();
    assaySerialDilutionVolumeInput?.select?.();
  }

  function closeSerialDilutionDialog() {
    if (!assaySerialDilutionOverlay) {
      return;
    }
    assaySerialDilutionOverlay.hidden = true;
  }

  function onSerialDilutionOverlayClick(event) {
    if (event?.target === assaySerialDilutionOverlay) {
      closeSerialDilutionDialog();
    }
  }

  function onSerialDilutionDialogInput(event) {
    const stockInput = event.target.closest('[data-assay-serial-stock-sample]');
    if (stockInput) {
      const sampleId = String(stockInput.dataset.assaySerialStockSample || '').trim();
      serialDilutionState.stockConcentrations[sampleId] = String(stockInput.value || '');
      renderSerialDilutionDialog();
      const nextInput = [...(assaySerialDilutionContent?.querySelectorAll('[data-assay-serial-stock-sample]') || [])]
        .find((input) => String(input.dataset.assaySerialStockSample || '').trim() === sampleId);
      nextInput?.focus();
      nextInput?.setSelectionRange?.(serialDilutionState.stockConcentrations[sampleId].length, serialDilutionState.stockConcentrations[sampleId].length);
      return;
    }
    if (event.target === assaySerialDilutionVolumeInput) {
      renderSerialDilutionDialog();
    }
  }

  function updateInlineWellOverride(wellId, field, rawValue) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    if (!normalizedWell) {
      return;
    }

    const def = getCurrentDefinition();
    const sampleAxis = getSampleAxis();
    const { sampleValues, concentrationValues } = getAxisTemplateValues();
    const baseMap = layoutToMap(applyAxisTemplate({
      def,
      sampleAxis,
      sampleValues,
      concentrationValues
    }));
    const current = getEffectiveWellMapping(normalizedWell);
    const base = baseMap[normalizedWell] || { sampleId: '', concentration: '' };
    const next = {
      sampleId: current.sampleId,
      concentration: current.concentration
    };

    next[field === 'concentration' ? 'concentration' : 'sampleId'] = String(rawValue || '').trim();

    const matchesBase = next.sampleId === String(base.sampleId || '').trim()
      && next.concentration === String(base.concentration || '').trim();

    if (!next.sampleId && !next.concentration) {
      delete runtime.manualWellOverrides[normalizedWell];
      if (base.sampleId || base.concentration) {
        runtime.suppressedWells.add(normalizedWell);
      } else {
        runtime.suppressedWells.delete(normalizedWell);
      }
    } else if (matchesBase) {
      delete runtime.manualWellOverrides[normalizedWell];
      runtime.suppressedWells.delete(normalizedWell);
    } else {
      runtime.suppressedWells.delete(normalizedWell);
      runtime.manualWellOverrides[normalizedWell] = next;
    }

    runtime.activeWellEditorId = normalizedWell;
    setLayoutFromAxisAndOverrides();
  }

  function deriveManualWellOverridesFromLayout(layout, def, axisValues = null) {
    const sampleAxis = getSampleAxis();
    const resolvedAxisValues = axisValues
      ? normalizeCurrentAxisTemplateValues(axisValues, def, sampleAxis)
      : getAxisTemplateValues();
    const baseLayout = applyAxisTemplate({
      def,
      sampleAxis,
      sampleValues: resolvedAxisValues.sampleValues,
      concentrationValues: resolvedAxisValues.concentrationValues
    });
    const baseMap = layoutToMap(baseLayout);
    const currentMap = layoutToMap(layout);
    const keys = new Set([
      ...Object.keys(baseMap),
      ...Object.keys(currentMap)
    ]);
    const overrides = {};
    keys.forEach((well) => {
      if (!isValidWellForDefinition(well, def)) {
        return;
      }
      const base = baseMap[well] || { sampleId: '', concentration: '' };
      const current = currentMap[well] || { sampleId: '', concentration: '' };
      if (!current.sampleId && !current.concentration) {
        return;
      }
      if (String(base.sampleId || '').trim() === String(current.sampleId || '').trim()
        && String(base.concentration || '').trim() === String(current.concentration || '').trim()) {
        return;
      }
      overrides[well] = {
        sampleId: String(current.sampleId || '').trim(),
        concentration: String(current.concentration || '').trim()
      };
    });
    runtime.manualWellOverrides = overrides;
  }

  function syncAxisTemplateValues(values = null) {
    setAxisTemplateValues(values || getAxisTemplateValues());
  }

  function renderAxisSwitchButtons() {
    const sampleAxis = getSampleAxis();
    assaySampleAxisRowBtn?.classList.toggle('calendar-view-active', sampleAxis === 'row');
    assaySampleAxisColumnBtn?.classList.toggle('calendar-view-active', sampleAxis === 'column');
  }

  function renderPlateEditFieldButtons() {
    assayPlateFieldSampleBtn?.classList.toggle('calendar-view-active', runtime.plateEditField === 'sampleId');
    assayPlateFieldConcentrationBtn?.classList.toggle('calendar-view-active', runtime.plateEditField === 'concentration');
  }

  function syncAxisDisplay() {
    if (!assayConcentrationAxisDisplay) {
      return;
    }
    const sampleAxis = getSampleAxis();
    assayConcentrationAxisDisplay.value = axisLabel(oppositeAxis(sampleAxis));
    renderAxisSwitchButtons();
  }

  function setSampleAxis(axis) {
    if (!assaySampleAxisInput) {
      return;
    }
    const next = axis === 'column' ? 'column' : 'row';
    if (assaySampleAxisInput.value === next) {
      return;
    }
    assaySampleAxisInput.value = next;
    syncAxisDisplay();
    setLayoutFromAxisAndOverrides();
    renderLayoutList();
    renderPlatePreview();
    renderResultTable();
  }

  function setPlateEditField(field) {
    runtime.plateEditField = field === 'concentration' ? 'concentration' : 'sampleId';
    renderPlateEditFieldButtons();
    renderPlatePreview();
  }

  function onSwapAxes() {
    if (!assaySampleAxisInput) {
      return;
    }
    const { sampleValues, concentrationValues } = getAxisTemplateValues();
    assaySampleAxisInput.value = assaySampleAxisInput.value === 'column' ? 'row' : 'column';
    syncAxisDisplay();
    const swapped = {
      sampleValues: concentrationValues,
      concentrationValues: sampleValues
    };
    syncAxisTemplateValues(swapped);
    setLayoutFromAxisAndOverrides();
    renderLayoutList();
    renderPlatePreview();
    renderResultTable();
    setLayoutStatus(`Switched axes. Sample axis is now ${axisLabel(assaySampleAxisInput.value)}.`);
  }

  function restoreAssayLayoutState(assay, def) {
    const sampleAxis = assay?.sampleAxis === 'column' ? 'column' : 'row';
    const axisValues = getAssayAxisTemplateValues(assay, def);
    setAxisTemplateValues(axisValues, def, sampleAxis);
    runtime.suppressedWells = new Set(Array.isArray(assay?.suppressedWells) ? assay.suppressedWells : []);
    runtime.activeWellEditorId = '';

    const savedLayout = normalizeLayout(assay?.wellLayout, def);
    const persistedOverrides = normalizeManualWellOverrideMap(assay?.manualWellOverrides, def);

    if (Object.keys(persistedOverrides).length) {
      runtime.manualWellOverrides = persistedOverrides;
    } else {
      runtime.manualWellOverrides = {};
      const expectedIntersectionLayout = removeSuppressedWellsFromLayout(applyAxisTemplate({
        def,
        sampleAxis,
        sampleValues: axisValues.sampleValues,
        concentrationValues: axisValues.concentrationValues
      }), def, runtime.suppressedWells);
      const expectedLegacyUnionLayout = removeSuppressedWellsFromLayout(applyAxisTemplate({
        def,
        sampleAxis,
        sampleValues: axisValues.sampleValues,
        concentrationValues: axisValues.concentrationValues,
        mappingMode: 'union'
      }), def, runtime.suppressedWells);

      if (!layoutsEqual(savedLayout, expectedIntersectionLayout, def)
        && !layoutsEqual(savedLayout, expectedLegacyUnionLayout, def)) {
        deriveManualWellOverridesFromLayout(savedLayout, def, axisValues);
      }
    }

    setLayoutFromAxisAndOverrides({ axisValues });
    runtime.currentResults = filterMappedResults(normalizeResults(assay?.resultValues, def));
    return axisValues;
  }

  function renderPlatePreview(sourceValues = null) {
    if (!assayPlatePreview) {
      return;
    }
    hideInventorySamplePicker();
    const def = getCurrentDefinition();
    const sampleAxis = getSampleAxis();
    const cellMap = layoutToMap(runtime.currentLayout);
    const totalWells = def.rows * def.columns;
    const maxRows = totalWells > 384 ? 16 : def.rows;
    const maxColumns = totalWells > 384 ? 24 : def.columns;

    const { sampleValues, concentrationValues } = sourceValues
      ? normalizeCurrentAxisTemplateValues(sourceValues, def, sampleAxis)
      : getAxisTemplateValues();
    const rowAxisRole = sampleAxis === 'row' ? 'sample' : 'concentration';
    const columnAxisRole = sampleAxis === 'row' ? 'concentration' : 'sample';
    const rowAxisLabel = rowAxisRole === 'sample' ? 'Sample ID' : 'Concentration';
    const columnAxisLabel = columnAxisRole === 'sample' ? 'Sample ID' : 'Concentration';
    const rowAxisValues = rowAxisRole === 'sample' ? sampleValues : concentrationValues;
    const columnAxisValues = columnAxisRole === 'sample' ? sampleValues : concentrationValues;
    const filledLayouts = Object.values(cellMap).filter((item) => item && (item.sampleId || item.concentration));

    function hashSampleId(sampleId) {
      let hash = 0;
      const text = String(sampleId || '').trim();
      for (let index = 0; index < text.length; index += 1) {
        hash = ((hash * 31) + text.charCodeAt(index)) % 360;
      }
      return hash;
    }

    function sampleHue(sampleId) {
      return (hashSampleId(sampleId) + 18) % 360;
    }

    const rankedConcentrations = (() => {
      const rawValues = filledLayouts
        .map((item) => String(item.concentration || '').trim())
        .filter(Boolean);
      const numericValues = rawValues
        .map((value) => ({ value, magnitude: parseConcentrationMagnitude(value) }))
        .filter((item) => item.magnitude !== null);
      if (numericValues.length >= 2) {
        const magnitudes = numericValues.map((item) => item.magnitude);
        const min = Math.min(...magnitudes);
        const max = Math.max(...magnitudes);
        const span = max - min || 1;
        return new Map(numericValues.map((item) => [
          item.value,
          0.28 + (((item.magnitude - min) / span) * 0.54)
        ]));
      }
      const unique = [...new Set(rawValues)];
      if (unique.length >= 2) {
        return new Map(unique.map((value, index) => [
          value,
          0.28 + ((index / (unique.length - 1 || 1)) * 0.54)
        ]));
      }
      return new Map(unique.map((value) => [value, 0.52]));
    })();

    const headers = ['<th></th>', `<th>${safeText(rowAxisLabel)}</th>`];
    for (let col = 0; col < maxColumns; col += 1) {
      headers.push(`<th>${col + 1}</th>`);
    }

    const axisRowCells = [`<th>${safeText(columnAxisLabel)}</th>`, '<td></td>'];
    for (let col = 0; col < maxColumns; col += 1) {
      const value = String(columnAxisValues[col] || '');
      axisRowCells.push(`
        <td class="assay-axis-cell">
          <input
            type="text"
            class="assay-axis-input"
            data-axis-dimension="column"
            data-axis-index="${col}"
            value="${safeText(value)}"
            placeholder="${columnAxisRole === 'sample' ? 'Sample' : 'Conc'}"
          />
        </td>
      `);
    }

    const rows = [];
    for (let row = 0; row < maxRows; row += 1) {
      const rowLabel = toRowLabel(row);
      const rowAxisValue = String(rowAxisValues[row] || '');
      const cells = [
        `<th>${rowLabel}</th>`,
        `
          <td class="assay-axis-cell">
            <input
              type="text"
              class="assay-axis-input"
              data-axis-dimension="row"
              data-axis-index="${row}"
              value="${safeText(rowAxisValue)}"
              placeholder="${rowAxisRole === 'sample' ? 'Sample' : 'Conc'}"
            />
          </td>
        `
      ];
      for (let col = 0; col < maxColumns; col += 1) {
        const well = wellIdFor(row, col);
        const layout = cellMap[well];
        const filled = layout && (layout.sampleId || layout.concentration) ? ' is-filled' : '';
        const active = runtime.activeWellEditorId === well ? ' is-active' : '';
        const sampleValue = String(layout?.sampleId || '').trim();
        const concentrationValue = String(layout?.concentration || '').trim();
        const sampleLabel = sampleValue || '-';
        const concentrationLabel = concentrationValue || '-';
        const editable = runtime.plateEditField === 'concentration' ? 'Concentration' : 'Sample ID';
        const editableValue = runtime.plateEditField === 'concentration' ? concentrationValue : sampleValue;
        const secondaryMeta = runtime.plateEditField === 'concentration'
          ? `S: ${safeText(sampleLabel)}`
          : `C: ${safeText(concentrationLabel)}`;
        const meta = layout
          ? `Sample ID: ${layout.sampleId || '-'} | Concentration: ${layout.concentration || '-'}`
          : 'Sample ID: - | Concentration: -';
        const hue = sampleValue ? sampleHue(sampleValue) : 210;
        const intensity = concentrationValue
          ? (rankedConcentrations.get(concentrationValue) || 0.58)
          : (sampleValue ? 0.36 : 0);
        const topAlpha = Math.min(0.92, 0.18 + (intensity * 0.68));
        const bottomAlpha = Math.min(0.98, 0.28 + (intensity * 0.78));
        const topLightness = Math.max(76, 96 - (intensity * 18));
        const bottomLightness = Math.max(54, 88 - (intensity * 30));
        const borderAlpha = Math.min(0.72, 0.24 + (intensity * 0.5));
        const highlightAlpha = Math.min(0.42, 0.12 + (intensity * 0.18));
        const shadowAlpha = Math.min(0.3, 0.08 + (intensity * 0.22));
        const cellStyle = sampleValue || concentrationValue
          ? ` style="background: linear-gradient(180deg, hsla(${hue}, 86%, ${topLightness}%, ${topAlpha}) 0%, hsla(${hue}, 92%, ${bottomLightness}%, ${bottomAlpha}) 100%); border-color: hsla(${hue}, 58%, 42%, ${borderAlpha}); box-shadow: inset 0 1px 0 hsla(${hue}, 90%, 98%, ${highlightAlpha}), inset 0 -10px 18px hsla(${hue}, 74%, 48%, ${shadowAlpha});"`
          : '';
        cells.push(`
          <td class="assay-well${filled}${active}" data-well="${well}" title="${safeText(`${well} • ${meta} • Click to edit ${editable}`)}"${cellStyle}>
            <div class="assay-well-id">${safeText(well)}</div>
            <input
              type="text"
              class="assay-well-inline-input"
              data-well-inline-field="${runtime.plateEditField}"
              data-well="${well}"
              value="${safeText(editableValue)}"
              placeholder="${runtime.plateEditField === 'concentration' ? 'Conc' : 'Sample'}"
            />
            <div class="assay-well-meta">${secondaryMeta}</div>
          </td>
        `);
      }
      rows.push(`<tr>${cells.join('')}</tr>`);
    }

    const note = totalWells > 384
      ? `<p class="small-note">Previewing first ${maxRows} rows x ${maxColumns} columns for ${def.label} plate.</p>`
      : '';

    assayPlatePreview.innerHTML = `
      ${note}
      <div class="assay-plate-table-wrap">
        <table class="assay-plate-table">
          <thead>
            <tr>${headers.join('')}</tr>
            <tr class="assay-plate-editor-row">${axisRowCells.join('')}</tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    `;
    if (!assaySerialDilutionOverlay?.hidden) {
      renderSerialDilutionDialog();
    }
  }

  function renderLayoutList() {
    if (!assayLayoutList) {
      return;
    }
    const rows = sortLayout(runtime.currentLayout);
    if (!rows.length) {
      assayLayoutList.innerHTML = '<p class="small-note">No mapped wells yet.</p>';
      return;
    }
    assayLayoutList.innerHTML = rows.map((item) => `
      <article class="list-row">
        <span><strong>${safeText(item.well)}</strong> — Sample: ${safeText(item.sampleId || '-')}</span>
        <span>Conc: ${safeText(item.concentration || '-')}</span>
        <div class="card-actions list-actions">
          <button type="button" class="ghost-btn" data-layout-edit="${item.well}">Edit</button>
          <button type="button" class="danger-btn" data-layout-delete="${item.well}">Delete</button>
        </div>
      </article>
    `).join('');
  }

  function onPlatePreviewInput(event) {
    const axisInput = event.target.closest('[data-axis-dimension]');
    if (axisInput) {
      syncAxisTemplateValues(getAxisTemplateValues());
      return;
    }

    const inlineInput = event.target.closest('[data-well-inline-field]');
    if (!inlineInput) {
      return;
    }

    updateInlineWellOverride(
      inlineInput.dataset.well,
      inlineInput.dataset.wellInlineField,
      inlineInput.value
    );
  }

  function onPlatePreviewChange(event) {
    const axisInput = event.target.closest('[data-axis-dimension]');
    if (axisInput) {
      setLayoutFromAxisAndOverrides();
      renderLayoutList();
      renderPlatePreview();
      renderResultTable();
      setLayoutStatus('Updated axis-based mapping from in-plate row/column definitions.');
      setCsvStatus(`Mapped wells: ${runtime.currentLayout.length}.`);
      return;
    }

    const inlineInput = event.target.closest('[data-well-inline-field]');
    if (!inlineInput) {
      return;
    }

    updateInlineWellOverride(
      inlineInput.dataset.well,
      inlineInput.dataset.wellInlineField,
      inlineInput.value
    );
    renderLayoutList();
    renderPlatePreview();
    renderResultTable();
    setLayoutStatus(`Updated ${String(inlineInput.dataset.well || '').trim().toUpperCase()}.`);
    setCsvStatus(`Mapped wells: ${runtime.currentLayout.length}.`);
  }

  function onPlatePreviewFocusIn(event) {
    const inlineInput = event.target.closest('[data-well-inline-field]');
    if (!inlineInput) {
      return;
    }
    setActiveWellSelection(inlineInput.dataset.well);
  }

  function onPlatePreviewClick(event) {
    if (event.target.closest('.assay-sample-picker')) {
      return;
    }
    if (event.target.closest('[data-axis-dimension]')) {
      return;
    }

    const inlineInput = event.target.closest('[data-well-inline-field]');
    if (inlineInput) {
      setActiveWellSelection(inlineInput.dataset.well);
      return;
    }

    const cell = event.target.closest('[data-well]');
    if (!cell) {
      return;
    }
    const wellId = String(cell.dataset.well || '').trim().toUpperCase();
    if (!wellId) {
      return;
    }
    setActiveWellSelection(wellId);
    cell.querySelector('[data-well-inline-field]')?.focus();
  }

  function onPlatePreviewKeyDown(event) {
    if (String(event?.key || '') !== 'Enter') {
      return;
    }

    const axisInput = event.target.closest('[data-axis-dimension]');
    if (axisInput) {
      event.preventDefault();
      const nextTarget = getNextAxisInputTarget(
        axisInput.dataset.axisDimension,
        axisInput.dataset.axisIndex
      );
      if (nextTarget) {
        focusAxisInput(nextTarget.dimension, nextTarget.index);
      }
      return;
    }

    const inlineInput = event.target.closest('[data-well-inline-field]');
    if (!inlineInput) {
      return;
    }

    event.preventDefault();
    const nextWell = getNextWellTarget(
      inlineInput.dataset.well,
      inlineInput.dataset.wellInlineField
    );
    if (nextWell) {
      focusPlateWellField(nextWell, inlineInput.dataset.wellInlineField);
    }
  }

  function onPlatePreviewContextMenu(event) {
    const cell = event.target.closest('[data-well]');
    if (!cell || event.target.closest('[data-axis-dimension]')) {
      hideInventorySamplePicker();
      return;
    }
    const wellId = String(cell.dataset.well || '').trim().toUpperCase();
    if (!wellId) {
      hideInventorySamplePicker();
      return;
    }
    event.preventDefault();
    showInventorySamplePicker(wellId, event.clientX, event.clientY);
  }

  function onGlobalPointerDown(event) {
    if (assaySamplePicker.hidden) {
      return;
    }
    if (event.target.closest('.assay-sample-picker')) {
      return;
    }
    hideInventorySamplePicker();
  }

  function onGlobalKeyDown(event) {
    if (String(event?.key || '') === 'Escape') {
      hideInventorySamplePicker();
      closeSerialDilutionDialog();
    }
  }

  function onPlatePreviewScroll() {
    hideInventorySamplePicker();
  }

  function onClearWellMappings() {
    runtime.manualWellOverrides = {};
    runtime.suppressedWells = new Set();
    setAxisTemplateValues({ sampleValues: [], concentrationValues: [] });
    runtime.currentLayout = [];
    runtime.activeWellEditorId = '';
    runtime.currentResults = {};
    renderLayoutList();
    renderPlatePreview();
    renderResultTable();
    setLayoutStatus('Cleared all well mappings.');
    setCsvStatus('');
    updateActiveWellPreviewState();
    if (typeof clearAnalysisOutput === 'function') {
      clearAnalysisOutput();
    }
  }

  function focusPlateWellInput(wellId) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    if (!normalizedWell || !assayPlatePreview) {
      return;
    }
    const selector = `[data-well="${normalizedWell}"] [data-well-inline-field="${runtime.plateEditField}"]`;
    assayPlatePreview.querySelector(selector)?.focus();
  }

  function focusPlateWellField(wellId, field) {
    const normalizedWell = String(wellId || '').trim().toUpperCase();
    const normalizedField = field === 'concentration' ? 'concentration' : 'sampleId';
    if (!normalizedWell || !assayPlatePreview) {
      return;
    }
    const input = assayPlatePreview.querySelector(`[data-well="${normalizedWell}"] [data-well-inline-field="${normalizedField}"]`);
    input?.focus();
    input?.select?.();
  }

  function focusAxisInput(dimension, index) {
    const normalizedDimension = dimension === 'column' ? 'column' : 'row';
    const normalizedIndex = Number(index);
    if (!assayPlatePreview || !Number.isFinite(normalizedIndex) || normalizedIndex < 0) {
      return;
    }
    const input = assayPlatePreview.querySelector(`[data-axis-dimension="${normalizedDimension}"][data-axis-index="${normalizedIndex}"]`);
    input?.focus();
    input?.select?.();
  }

  function getNextAxisInputTarget(dimension, index) {
    const def = getCurrentDefinition();
    const max = dimension === 'column' ? def.columns : def.rows;
    const nextIndex = Number(index) + 1;
    if (!Number.isFinite(nextIndex) || nextIndex < 0 || nextIndex >= max) {
      return null;
    }
    return { dimension, index: nextIndex };
  }

  function getWellEntryDirection(field) {
    return field === 'concentration' ? oppositeAxis(getSampleAxis()) : getSampleAxis();
  }

  function getNextWellTarget(wellId, field) {
    const parsed = parseWellId(wellId);
    const def = getCurrentDefinition();
    if (!parsed) {
      return '';
    }

    let nextRow = parsed.rowIndex;
    let nextColumn = parsed.columnIndex;

    if (getWellEntryDirection(field) === 'column') {
      if (parsed.rowIndex + 1 < def.rows) {
        nextRow = parsed.rowIndex + 1;
      } else if (parsed.columnIndex + 1 < def.columns) {
        nextRow = 0;
        nextColumn = parsed.columnIndex + 1;
      } else {
        return '';
      }
    } else if (parsed.columnIndex + 1 < def.columns) {
      nextColumn = parsed.columnIndex + 1;
    } else if (parsed.rowIndex + 1 < def.rows) {
      nextRow = parsed.rowIndex + 1;
      nextColumn = 0;
    } else {
      return '';
    }

    return wellIdFor(nextRow, nextColumn);
  }

  function onLayoutListClick(event) {
    const editBtn = event.target.closest('[data-layout-edit]');
    if (editBtn) {
      const well = editBtn.dataset.layoutEdit;
      const item = runtime.currentLayout.find((entry) => entry.well === well);
      if (!item) {
        return;
      }
      setActiveWellSelection(item.well || '');
      focusPlateWellInput(item.well || '');
      setLayoutStatus(`Focused ${well} in plate preview.`);
      return;
    }
    const deleteBtn = event.target.closest('[data-layout-delete]');
    if (deleteBtn) {
      const well = deleteBtn.dataset.layoutDelete;
      delete runtime.manualWellOverrides[well];
      runtime.suppressedWells.add(well);
      setLayoutFromAxisAndOverrides();
      if (runtime.activeWellEditorId === well) {
        runtime.activeWellEditorId = '';
      }
      renderLayoutList();
      renderPlatePreview();
      renderResultTable();
      setLayoutStatus(`Deleted ${well}.`);
      setCsvStatus(`Mapped wells: ${runtime.currentLayout.length}.`);
    }
  }

  function renderPlateDefinition() {
    if (!assayPlateDefinition) {
      return;
    }
    const def = getCurrentDefinition();
    assayPlateDefinition.textContent = `Plate layout: ${def.rows} rows x ${def.columns} columns (${def.rows * def.columns} wells).`;
  }

  function renderAssayNumberDisplay(numberText = '') {
    if (!assayNumberDisplay) {
      return;
    }
    assayNumberDisplay.textContent = numberText || '';
  }

  function onPlateTypeChange() {
    runtime.currentResults = normalizeResults(runtime.currentResults, getCurrentDefinition());
    setLayoutFromAxisAndOverrides();
    runtime.activeWellEditorId = '';
    syncAxisTemplateValues();
    renderPlateDefinition();
    renderPlatePreview();
    renderResultTable();
    renderLayoutList();
    if (typeof clearAnalysisOutput === 'function') {
      clearAnalysisOutput();
    }
    setCsvStatus(`Mapped wells: ${runtime.currentLayout.length}. Result wells: ${Object.keys(runtime.currentResults || {}).length}.`);
  }

  function exportCsvTemplate() {
    const def = getCurrentDefinition();
    const layoutMap = layoutToMap(runtime.currentLayout);
    const lines = ['well,row,column,sample_id,concentration'];
    buildAllWells(def).forEach((well) => {
      const value = layoutMap[well.well] || { sampleId: '', concentration: '' };
      lines.push([
        well.well,
        well.row,
        well.column,
        escapeCsv(value.sampleId),
        escapeCsv(value.concentration)
      ].join(','));
    });

    const content = `${lines.join('\n')}\n`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = sanitizeFilePart(assayNameInput?.value, 'assay');
    link.href = url;
    link.download = `${baseName}-${def.value}well-template.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setCsvStatus(`Exported ${def.label} CSV template.`);
  }

  async function onImportCsv(event) {
    const file = event?.target?.files?.[0];
    if (!file) {
      return;
    }
    try {
      const raw = await file.text();
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length) {
        setCsvStatus('Import failed: CSV file is empty.');
        return;
      }

      const header = parseCsvLine(lines[0]).map((cell) => String(cell || '').trim().toLowerCase());
      const indexWell = header.indexOf('well');
      const indexRow = header.indexOf('row');
      const indexColumn = header.indexOf('column');
      const indexSample = header.indexOf('sample_id');
      const indexConcentration = header.indexOf('concentration');
      if (indexWell < 0 && (indexRow < 0 || indexColumn < 0)) {
        setCsvStatus('Import failed: CSV needs "well" or both "row" and "column" columns.');
        return;
      }

      const def = getCurrentDefinition();
      const valid = new Set(buildAllWells(def).map((item) => item.well));
      const imported = [];
      for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
        const cells = parseCsvLine(lines[rowIndex]);
        const well = (indexWell >= 0 ? cells[indexWell] : '').trim().toUpperCase();
        const fallbackRow = (indexRow >= 0 ? cells[indexRow] : '').trim().toUpperCase();
        const fallbackColumn = Number((indexColumn >= 0 ? cells[indexColumn] : '').trim());
        const resolvedWell = well || (fallbackRow && Number.isFinite(fallbackColumn) ? `${fallbackRow}${fallbackColumn}` : '');
        if (!resolvedWell || !valid.has(resolvedWell)) {
          continue;
        }
        const sampleId = indexSample >= 0 ? String(cells[indexSample] || '').trim() : '';
        const concentration = indexConcentration >= 0 ? String(cells[indexConcentration] || '').trim() : '';
        if (!sampleId && !concentration) {
          continue;
        }
        imported.push({ well: resolvedWell, sampleId, concentration });
      }

      setAxisTemplateValues({ sampleValues: [], concentrationValues: [] }, def, getSampleAxis());
      runtime.suppressedWells = new Set();
      runtime.manualWellOverrides = layoutToMap(normalizeLayout(imported, def));
      setLayoutFromAxisAndOverrides();
      renderPlatePreview();
      renderLayoutList();
      renderResultTable();
      setCsvStatus(`Imported ${runtime.currentLayout.length} mapped wells from ${file.name}.`);
    } catch {
      setCsvStatus('Import failed: could not parse CSV file.');
    } finally {
      if (assayImportFile) {
        assayImportFile.value = '';
      }
    }
  }

  return {
    getCurrentDefinition,
    getSampleAxis,
    getMappedWellSet,
    isMappedWell,
    filterMappedResults,
    setAxisTemplateValues,
    getAxisTemplateValues,
    syncAxisTemplateValues,
    setLayoutFromAxisAndOverrides,
    restoreAssayLayoutState,
    renderAxisSwitchButtons,
    renderPlateEditFieldButtons,
    setSampleAxis,
    setPlateEditField,
    syncAxisDisplay,
    onSwapAxes,
    renderPlatePreview,
    renderLayoutList,
    onPlatePreviewInput,
    onPlatePreviewChange,
    onPlatePreviewFocusIn,
    onPlatePreviewClick,
    onPlatePreviewKeyDown,
    onPlatePreviewContextMenu,
    onClearWellMappings,
    openSerialDilutionDialog,
    closeSerialDilutionDialog,
    onSerialDilutionOverlayClick,
    onSerialDilutionDialogInput,
    focusPlateWellInput,
    onLayoutListClick,
    renderPlateDefinition,
    renderAssayNumberDisplay,
    updateActiveWellPreviewState,
    onPlateTypeChange,
    exportCsvTemplate,
    onImportCsv,
    hideInventorySamplePicker,
    onGlobalPointerDown,
    onGlobalKeyDown,
    onPlatePreviewScroll
  };
}
