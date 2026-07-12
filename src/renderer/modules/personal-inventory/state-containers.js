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

  function getContainerChildren(section, parentContainerId) {
    const parentId = String(parentContainerId || '');
    if (!parentId) {
      return [];
    }
    return (state.inventory?.[section] || []).filter((item) => (
      item?.id
      && String(item.id) !== parentId
      && String(item.parentContainerId || '') === parentId
    ));
  }

  function getRootContainers(section) {
    const containers = state.inventory?.[section] || [];
    const containerIds = new Set(containers.map((item) => String(item?.id || '')).filter(Boolean));
    return containers.filter((item) => {
      const id = String(item?.id || '');
      const parentId = String(item?.parentContainerId || '');
      return !parentId || parentId === id || !containerIds.has(parentId);
    });
  }

  function getContainerDescendantIds(section, containerId) {
    const containers = state.inventory?.[section] || [];
    const rootId = String(containerId || '');
    if (!rootId) {
      return [];
    }
    const descendantIds = [];
    const visitedIds = new Set([rootId]);
    const queue = [rootId];
    while (queue.length) {
      const currentId = queue.shift();
      containers.forEach((item) => {
        const id = String(item?.id || '');
        if (!id || visitedIds.has(id) || String(item?.parentContainerId || '') !== currentId) {
          return;
        }
        visitedIds.add(id);
        descendantIds.push(id);
        queue.push(id);
      });
    }
    return descendantIds;
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
    getContainerChildren,
    getRootContainers,
    getContainerDescendantIds,
    getLinkedSamples,
    getContainerSampleCount,
    getSectionContainerCount,
    getSectionSampleCount,
    getPreferredSection,
    getSectionNames
  };
}
