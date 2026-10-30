import { getWellName } from './constants.js';
import { getSampleInventoryLocationNames } from '../../lib/inventory-settings.js';

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

  function getFolders(section) {
    return Array.isArray(state.inventoryFolders?.[section]) ? state.inventoryFolders[section] : [];
  }

  function getFolder(section, folderId) {
    const id = String(folderId || '');
    return getFolders(section).find((folder) => String(folder?.id || '') === id) || null;
  }

  function getFolderChildren(section, parentFolderId = '') {
    const parentId = String(parentFolderId || '');
    return getFolders(section).filter((folder) => {
      const id = String(folder?.id || '');
      return id && id !== parentId && String(folder?.parentFolderId || '') === parentId;
    });
  }

  // Also treats orphans (parent deleted) and self-parented folders as roots,
  // so a damaged tree still shows every folder instead of hiding some.
  function getRootFolders(section) {
    const folders = getFolders(section);
    const folderIds = new Set(folders.map((folder) => String(folder?.id || '')).filter(Boolean));
    return folders.filter((folder) => {
      const id = String(folder?.id || '');
      const parentId = String(folder?.parentFolderId || '');
      return id && (!parentId || parentId === id || !folderIds.has(parentId));
    });
  }

  function getContainersInFolder(section, folderId = '') {
    const targetFolderId = String(folderId || '');
    return (state.inventory?.[section] || []).filter((container) => (
      String(container?.folderId || '') === targetFolderId
    ));
  }

  function getFolderAncestorIds(section, folderId) {
    const folders = getFolders(section);
    const byId = new Map(folders.map((folder) => [String(folder?.id || ''), folder]));
    const ancestorIds = [];
    const visitedIds = new Set();
    let current = byId.get(String(folderId || ''));
    while (current) {
      const parentId = String(current.parentFolderId || '');
      if (!parentId || visitedIds.has(parentId)) {
        break;
      }
      visitedIds.add(parentId);
      ancestorIds.push(parentId);
      current = byId.get(parentId);
    }
    return ancestorIds;
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

  function getSectionFolderCount(section) {
    return getFolders(section).length;
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
    getFolders,
    getFolder,
    getFolderChildren,
    getRootFolders,
    getContainersInFolder,
    getFolderAncestorIds,
    getLinkedSamples,
    getContainerSampleCount,
    getSectionContainerCount,
    getSectionFolderCount,
    getSectionSampleCount,
    getPreferredSection,
    getSectionNames
  };
}
