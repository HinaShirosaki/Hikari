import { getWellName } from './constants.js';
import { getSampleInventoryLocationNames } from '../sample-inventory-settings.js';

export function createContainerStateHelpers({ state, uiState }) {
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

  function getSectionNames() {
    return getSampleInventoryLocationNames(state.settings, state.inventory);
  }

  return {
    getWellLabel,
    getContainer,
    getLinkedSamples,
    getContainerSampleCount,
    getSectionContainerCount,
    getSectionSampleCount,
    getPreferredSection,
    getSectionNames
  };
}
