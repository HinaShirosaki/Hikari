import {
  SAMPLE_TYPE_COLORS,
  SAMPLE_TYPE_LABELS,
  getSectionNames,
  getSectionDisplay,
  getWellName
} from './constants.js';

export function createPersonalInventoryStateHelpers({ state, safeText, uiState }) {
  function getWellLabel(container, index) {
    const rawWell = Array.isArray(container?.wells) ? container.wells[index] : null;
    if (rawWell && typeof rawWell === 'object') {
      const explicitName = String(rawWell.name || '').trim();
      if (explicitName) {
        return explicitName;
      }
    }
    return getWellName(container, index);
  }

  function getContainer(section, containerId) {
    return (state.inventory?.[section] || []).find((item) => item.id === containerId);
  }

  function getLinkedSamples(section, containerId, wellIndex = null) {
    return (state.samples || []).filter((sample) => {
      const link = sample.inventoryLink;
      if (!link || link.section !== section || link.containerId !== containerId) {
        return false;
      }
      if (wellIndex === null) {
        return link.wellIndex === null || link.wellIndex === undefined;
      }
      return Number(link.wellIndex) === Number(wellIndex);
    });
  }

  function getContainerSampleCount(section, containerId) {
    const container = getContainer(section, containerId);
    if (!container) {
      return 0;
    }
    const directCount = getLinkedSamples(section, containerId, null).length;
    if (container.type === 'single') {
      return directCount;
    }
    return directCount + (container.wells || []).reduce((count, _well, index) => (
      count + getLinkedSamples(section, containerId, index).length
    ), 0);
  }

  function getSectionContainerCount(section) {
    return Array.isArray(state.inventory?.[section]) ? state.inventory[section].length : 0;
  }

  function getSectionSampleCount(section) {
    return (state.inventory?.[section] || []).reduce((count, container) => (
      count + getContainerSampleCount(section, container.id)
    ), 0);
  }

  function getPreferredSection() {
    const sections = getSectionNames();
    if (uiState.selectedContainer?.section && sections.includes(uiState.selectedContainer.section)) {
      return uiState.selectedContainer.section;
    }
    if (uiState.selectedSectionName && sections.includes(uiState.selectedSectionName)) {
      return uiState.selectedSectionName;
    }
    const firstWithContainers = sections.find((section) => getSectionContainerCount(section) > 0);
    return firstWithContainers || sections[0];
  }

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
    const key = String(type || '').trim().toLowerCase();
    if (!key) {
      return 'other';
    }
    return Object.prototype.hasOwnProperty.call(SAMPLE_TYPE_COLORS, key) ? key : 'other';
  }

  function getSampleTypeColor(type) {
    return SAMPLE_TYPE_COLORS[normalizeSampleType(type)] || SAMPLE_TYPE_COLORS.other;
  }

  function getSampleTypeLabel(type) {
    return SAMPLE_TYPE_LABELS[normalizeSampleType(type)] || SAMPLE_TYPE_LABELS.other;
  }

  function renderSampleTypeOptions(selectedType = 'plasmid') {
    const selected = normalizeSampleType(selectedType);
    return Object.entries(SAMPLE_TYPE_LABELS)
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

  function buildSampleDotFill(sampleTypes) {
    const unique = Array.from(new Set((sampleTypes || []).map((type) => normalizeSampleType(type))));
    if (!unique.length) {
      return '';
    }
    if (unique.length === 1) {
      return getSampleTypeColor(unique[0]);
    }
    const segmentSize = 100 / unique.length;
    const segments = unique.map((type, index) => {
      const start = Number((segmentSize * index).toFixed(2));
      const end = Number((segmentSize * (index + 1)).toFixed(2));
      return `${getSampleTypeColor(type)} ${start}% ${end}%`;
    });
    return `conic-gradient(${segments.join(', ')})`;
  }

  function renderSampleLegendForContainer(section, container) {
    const linkedTypeSet = new Set();
    (state.samples || []).forEach((sample) => {
      const link = sample?.inventoryLink;
      if (!link || link.section !== section || link.containerId !== container.id) {
        return;
      }
      linkedTypeSet.add(normalizeSampleType(sample.type));
    });
    const linkedTypes = Array.from(linkedTypeSet);
    if (!linkedTypes.length) {
      return '';
    }

    return `
      <div class="well-sample-legend" aria-label="Sample type color legend">
        ${linkedTypes.map((type) => `
          <span class="well-sample-legend-item">
            <span class="well-sample-legend-dot" style="--sample-type-color:${getSampleTypeColor(type)};"></span>
            ${safeText(getSampleTypeLabel(type))}
          </span>
        `).join('')}
      </div>
    `;
  }

  function getWellDataForType(containerOrType, rawWell, index) {
    const fallbackName = getWellName(containerOrType, index);
    if (rawWell && typeof rawWell === 'object') {
      return {
        name: String(rawWell.name || '').trim() || fallbackName,
        content: String(rawWell.content || '').trim()
      };
    }
    return { name: fallbackName, content: String(rawWell || '').trim() };
  }

  return {
    getContainer,
    getLinkedSamples,
    getContainerSampleCount,
    getSectionContainerCount,
    getSectionSampleCount,
    getPreferredSection,
    ensureSamples,
    makeDefaultSampleCode,
    normalizeSampleCode,
    getSampleById,
    isLocationEmpty,
    buildAutoLocationFromLink,
    normalizeSampleType,
    getSampleTypeColor,
    getSampleTypeLabel,
    renderSampleTypeOptions,
    getInventorySummaryCounts,
    buildSampleDotFill,
    renderSampleLegendForContainer,
    getWellDataForType,
    getSectionNames,
    getSectionDisplay
  };
}
