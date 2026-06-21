import {
  SAMPLE_TYPE_COLORS
} from './constants.js';
import {
  getSampleTypeLabels,
  normalizeConfiguredSampleType
} from '../sample-inventory-settings.js';

export function createSampleStateHelpers({ state, safeText, getWellLabel }) {
  function ensureSamples() {
    if (!Array.isArray(state.samples)) {
      state.samples = [];
    }
  }

  function makeDefaultSampleCode() {
    return `S-${Date.now().toString().slice(-6)}`;
  }

  function normalizeSampleCode(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '');
  }

  function getSampleById(sampleId) {
    return (state.samples || []).find((sample) => sample.id === sampleId) || null;
  }

  function getSavedSamplesForWellFill() {
    ensureSamples();
    return state.samples
      .filter((sample) => sample && sample.id)
      .sort((a, b) => String(a.code || a.name || a.id).localeCompare(String(b.code || b.name || b.id)));
  }

  function isLocationEmpty(location) {
    if (!location || typeof location !== 'object') {
      return true;
    }
    return Object.entries(location)
      .filter(([key]) => key !== 'storageType')
      .every(([, value]) => !String(value || '').trim());
  }

  function buildAutoLocationFromLink(section, container, index) {
    if (section === '4 Degree') {
      return { storageType: 'fridge', fridge: '4 Degree', shelf: container.name || '' };
    }
    if (section === 'Room Temp') {
      return { storageType: 'rt_cabinet', cabinet: 'Room Temp', slot: container.name || '' };
    }
    return {
      storageType: 'freezer',
      freezer: section,
      rack: '',
      box: container.name || '',
      position: Number.isInteger(index) && index >= 0 ? getWellLabel(container, index) : ''
    };
  }

  function normalizeSampleType(type) {
    return normalizeConfiguredSampleType(type);
  }

  function getSampleTypeColor(type) {
    return SAMPLE_TYPE_COLORS[normalizeSampleType(type)] || SAMPLE_TYPE_COLORS.other;
  }

  function getSampleTypeLabel(type) {
    const labels = getSampleTypeLabels(state.settings);
    return labels[normalizeSampleType(type)] || labels.other;
  }

  function renderSampleTypeOptions(selectedType = 'plasmid') {
    const selected = normalizeSampleType(selectedType);
    return Object.entries(getSampleTypeLabels(state.settings))
      .filter(([value]) => value !== 'other')
      .map(([value, label]) => `<option value="${safeText(value)}"${selected === value ? ' selected' : ''}>${safeText(label)}</option>`)
      .join('');
  }

  function getInventorySummaryCounts() {
    const counts = { total: Array.isArray(state.samples) ? state.samples.length : 0, plasmid: 0, cell_line: 0, protein: 0 };
    (state.samples || []).forEach((sample) => {
      const type = normalizeSampleType(sample?.type);
      if (Object.prototype.hasOwnProperty.call(counts, type)) {
        counts[type] += 1;
      }
    });
    return counts;
  }

  return {
    ensureSamples,
    makeDefaultSampleCode,
    normalizeSampleCode,
    getSampleById,
    getSavedSamplesForWellFill,
    isLocationEmpty,
    buildAutoLocationFromLink,
    normalizeSampleType,
    getSampleTypeColor,
    getSampleTypeLabel,
    renderSampleTypeOptions,
    getInventorySummaryCounts
  };
}
