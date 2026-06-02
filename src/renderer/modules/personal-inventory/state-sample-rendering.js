import { getWellName } from './constants.js';

export function createSampleRenderingStateHelpers({ state, safeText, sampleHelpers }) {
  const {
    normalizeSampleType,
    getSampleTypeColor,
    getSampleTypeLabel
  } = sampleHelpers;

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
    buildSampleDotFill,
    renderSampleLegendForContainer,
    getWellDataForType
  };
}
