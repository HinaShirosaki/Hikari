import {
  SAMPLE_TYPE_COLORS
} from './constants.js';
import {
  getEditableSampleTypeEntries,
  getSampleTypeLabels,
  normalizeConfiguredSampleType
} from '../../lib/inventory-settings.js';
import { buildSampleLocation, makeDefaultSampleCode, normalizeSampleCode } from '../../lib/sample-records.js';

export function createSampleStateHelpers({ state, safeText }) {
  function ensureSamples() {
    if (!Array.isArray(state.samples)) {
      state.samples = [];
    }
  }

  function getSampleById(sampleId) {
    return (state.samples || []).find((sample) => sample.id === sampleId) || null;
  }

  function isLocationEmpty(location) {
    if (!location || typeof location !== 'object') {
      return true;
    }
    return Object.entries(location)
      .filter(([key]) => key !== 'storageType')
      .every(([, value]) => !String(value || '').trim());
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
    return getEditableSampleTypeEntries(state.settings)
      .map(({ type, label }) => `<option value="${safeText(type)}"${selected === type ? ' selected' : ''}>${safeText(label)}</option>`)
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
    isLocationEmpty,
    buildAutoLocationFromLink: buildSampleLocation,
    normalizeSampleType,
    getSampleTypeColor,
    getSampleTypeLabel,
    renderSampleTypeOptions,
    getInventorySummaryCounts
  };
}
