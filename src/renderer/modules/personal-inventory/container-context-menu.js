import { deleteContainer } from './container-delete-events.js';
import { renameContainer } from './container-rename-events.js';
import { deleteInventoryFolder, renameInventoryFolder } from './folder-actions.js';
import { getSampleInventoryLocationNames, normalizeSampleInventoryLocations } from '../../lib/inventory-settings.js';

export function installContainerContextMenu(ctx) {
  const { containerContextMenu } = ctx.elements;
  const { uiState } = ctx;
  const documentRef = typeof document !== 'undefined' ? document : null;
  const windowRef = typeof window !== 'undefined' ? window : null;

  function hideContainerContextMenu() {
    uiState.contextContainer = null;
    uiState.contextFolder = null;
    uiState.contextLocation = null;
    if (containerContextMenu) {
      containerContextMenu.hidden = true;
      renderMenuButtons();
    }
  }

  function renderMenuButtons() {
    if (!containerContextMenu) {
      return;
    }
    const isLocation = Boolean(uiState.contextLocation);
    const isFolder = Boolean(uiState.contextFolder);
    containerContextMenu.innerHTML = isLocation ? `
      <button type="button" class="personal-inventory-context-item" data-location-context-add-container>
        Add Container Here
      </button>
      <button type="button" class="personal-inventory-context-item" data-location-context-add-folder>
        New Folder Inside
      </button>
      <button type="button" class="personal-inventory-context-item" data-location-context-rename>
        Rename Folder
      </button>
      <button type="button" class="personal-inventory-context-item personal-inventory-context-item-danger" data-location-context-delete${canDeleteLocation(uiState.contextLocation.section) ? '' : ' disabled'} title="${canDeleteLocation(uiState.contextLocation.section) ? 'Delete location' : 'Move or remove its folders and containers before deleting this location.'}">
        Delete Folder
      </button>
    ` : isFolder ? `
      <button type="button" class="personal-inventory-context-item" data-folder-context-add-container>
        Add Container Here
      </button>
      <button type="button" class="personal-inventory-context-item" data-folder-context-add-folder>
        New Folder Inside
      </button>
      <button type="button" class="personal-inventory-context-item" data-folder-context-rename>
        Rename Folder
      </button>
      <button type="button" class="personal-inventory-context-item personal-inventory-context-item-danger" data-folder-context-delete>
        Delete Folder
      </button>
    ` : `
      <button type="button" class="personal-inventory-context-item" data-container-context-rename>
        Rename Container
      </button>
      <button type="button" class="personal-inventory-context-item personal-inventory-context-item-danger" data-container-context-delete>
        Delete Container
      </button>
    `;

    containerContextMenu.querySelector('[data-folder-context-add-container]')?.addEventListener('click', () => {
      const target = uiState.contextFolder;
      hideContainerContextMenu();
      if (target) {
        ctx.beginAddContainer?.({ section: target.section, folderId: target.folderId });
      }
    });
    containerContextMenu.querySelector('[data-folder-context-add-folder]')?.addEventListener('click', () => {
      const target = uiState.contextFolder;
      hideContainerContextMenu();
      if (target) {
        ctx.beginAddFolder?.({ section: target.section, folderId: target.folderId });
      }
    });
    containerContextMenu.querySelector('[data-folder-context-rename]')?.addEventListener('click', () => {
      enterRenameMode(uiState.contextFolder, 'folder');
    });
    containerContextMenu.querySelector('[data-folder-context-delete]')?.addEventListener('click', () => {
      const target = uiState.contextFolder;
      hideContainerContextMenu();
      if (target) {
        deleteInventoryFolder(ctx, target.section, target.folderId);
      }
    });
    containerContextMenu.querySelector('[data-location-context-add-container]')?.addEventListener('click', () => {
      const target = uiState.contextLocation;
      hideContainerContextMenu();
      if (target) {
        ctx.beginAddContainer?.({ section: target.section });
      }
    });
    containerContextMenu.querySelector('[data-location-context-add-folder]')?.addEventListener('click', () => {
      const target = uiState.contextLocation;
      hideContainerContextMenu();
      if (target) {
        ctx.beginAddFolder?.({ section: target.section });
      }
    });
    containerContextMenu.querySelector('[data-location-context-rename]')?.addEventListener('click', () => {
      enterRenameMode(uiState.contextLocation, 'location');
    });
    containerContextMenu.querySelector('[data-location-context-delete]')?.addEventListener('click', () => {
      const target = uiState.contextLocation;
      hideContainerContextMenu();
      if (target) {
        deleteInventoryLocation(target.section);
      }
    });
    containerContextMenu.querySelector('[data-container-context-rename]')?.addEventListener('click', () => {
      enterRenameMode(uiState.contextContainer, 'container');
    });
    containerContextMenu.querySelector('[data-container-context-delete]')?.addEventListener('click', () => {
      const target = uiState.contextContainer;
      hideContainerContextMenu();
      if (target) {
        deleteContainer(ctx, target.section, target.containerId);
      }
    });
  }

  function enterRenameMode(target, targetType) {
    if (!containerContextMenu || !target) {
      return;
    }
    const item = targetType === 'folder'
      ? ctx.helpers?.getFolder?.(target.section, target.folderId)
      : targetType === 'location'
        ? { name: target.section }
        : ctx.helpers?.getContainer?.(target.section, target.containerId);
    containerContextMenu.innerHTML = '<input type="text" class="personal-inventory-context-rename-input" data-personal-inventory-context-rename-input maxlength="120" />';
    const input = containerContextMenu.querySelector('[data-personal-inventory-context-rename-input]');
    if (!input) {
      return;
    }
    input.value = item?.name || '';
    input.focus();
    input.select?.();

    let settled = false;
    const commit = () => {
      if (settled) {
        return;
      }
      settled = true;
      const nextName = input.value;
      hideContainerContextMenu();
      if (targetType === 'folder') {
        renameInventoryFolder(ctx, target.section, target.folderId, nextName);
      } else if (targetType === 'location') {
        renameInventoryLocation(target.section, nextName);
      } else {
        renameContainer(ctx, target.section, target.containerId, nextName);
      }
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        settled = true;
        hideContainerContextMenu();
      }
    });
    input.addEventListener('blur', commit);
  }

  function getLocationNames() {
    return getSampleInventoryLocationNames(ctx.state.settings, ctx.state.inventory);
  }

  function sameLocation(left, right) {
    return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
  }

  function canDeleteLocation(section) {
    const locations = getLocationNames();
    const containers = Array.isArray(ctx.state.inventory?.[section]) ? ctx.state.inventory[section] : [];
    const folders = Array.isArray(ctx.state.inventoryFolders?.[section]) ? ctx.state.inventoryFolders[section] : [];
    return locations.length > 1 && containers.length === 0 && folders.length === 0;
  }

  function renameInventoryLocation(section, rawName) {
    const nextName = String(rawName || '').trim().replace(/\s+/g, ' ');
    const locations = getLocationNames();
    const locationIndex = locations.findIndex((location) => sameLocation(location, section));
    if (!nextName || locationIndex < 0 || sameLocation(nextName, section)) {
      return false;
    }
    if (locations.some((location, index) => index !== locationIndex && sameLocation(location, nextName))) {
      return false;
    }

    ctx.state.settings = ctx.state.settings && typeof ctx.state.settings === 'object' ? ctx.state.settings : {};
    ctx.state.inventory = ctx.state.inventory && typeof ctx.state.inventory === 'object' ? ctx.state.inventory : {};
    ctx.state.inventoryFolders = ctx.state.inventoryFolders && typeof ctx.state.inventoryFolders === 'object'
      ? ctx.state.inventoryFolders
      : {};
    const sourceContainers = Array.isArray(ctx.state.inventory[section]) ? ctx.state.inventory[section] : [];
    const sourceFolders = Array.isArray(ctx.state.inventoryFolders[section]) ? ctx.state.inventoryFolders[section] : [];
    if (sourceContainers.length) {
      ctx.state.inventory[nextName] = (ctx.state.inventory[nextName] || []).concat(sourceContainers);
    }
    if (sourceFolders.length) {
      ctx.state.inventoryFolders[nextName] = (ctx.state.inventoryFolders[nextName] || []).concat(sourceFolders);
    }
    delete ctx.state.inventory[section];
    delete ctx.state.inventoryFolders[section];
    ctx.state.samples = (ctx.state.samples || []).map((sample) => {
      if (sample?.inventoryLink?.section !== section) {
        return sample;
      }
      return { ...sample, inventoryLink: { ...sample.inventoryLink, section: nextName } };
    });
    locations[locationIndex] = nextName;
    ctx.state.settings.sampleInventoryLocations = normalizeSampleInventoryLocations(locations);
    if (uiState.selectedSectionName === section) {
      uiState.selectedSectionName = nextName;
    }
    if (uiState.selectedContainer?.section === section) {
      uiState.selectedContainer = { ...uiState.selectedContainer, section: nextName };
    }
    ctx.persist();
    ctx.notifyInventoryChanged();
    ctx.renderSections();
    return true;
  }

  function deleteInventoryLocation(section) {
    if (!canDeleteLocation(section)) {
      return false;
    }
    const locations = getLocationNames().filter((location) => !sameLocation(location, section));
    ctx.state.settings = ctx.state.settings && typeof ctx.state.settings === 'object' ? ctx.state.settings : {};
    ctx.state.settings.sampleInventoryLocations = normalizeSampleInventoryLocations(locations);
    delete ctx.state.inventory?.[section];
    delete ctx.state.inventoryFolders?.[section];
    if (uiState.selectedSectionName === section) {
      uiState.selectedSectionName = ctx.helpers.getPreferredSection();
      uiState.selectedContainer = null;
    }
    ctx.persist();
    ctx.notifyInventoryChanged();
    ctx.renderSections();
    return true;
  }

  function openContextMenu(event, targetType, section, itemId = '') {
    if (!containerContextMenu || !section || (targetType !== 'location' && !itemId)) {
      return;
    }
    event?.preventDefault?.();
    event?.stopPropagation?.();
    uiState.contextContainer = targetType === 'container' ? { section, containerId: itemId } : null;
    uiState.contextFolder = targetType === 'folder' ? { section, folderId: itemId } : null;
    uiState.contextLocation = targetType === 'location' ? { section } : null;
    renderMenuButtons();
    containerContextMenu.style.left = `${Math.max(0, Number(event?.clientX) || 0)}px`;
    containerContextMenu.style.top = `${Math.max(0, Number(event?.clientY) || 0)}px`;
    containerContextMenu.hidden = false;

    const rect = containerContextMenu.getBoundingClientRect?.();
    if (rect && windowRef) {
      const left = Math.max(8, Math.min(rect.left, windowRef.innerWidth - rect.width - 8));
      const top = Math.max(8, Math.min(rect.top, windowRef.innerHeight - rect.height - 8));
      containerContextMenu.style.left = `${left}px`;
      containerContextMenu.style.top = `${top}px`;
    }
  }

  function openContainerContextMenu(event, section, containerId) {
    openContextMenu(event, 'container', section, containerId);
  }

  function openFolderContextMenu(event, section, folderId) {
    openContextMenu(event, 'folder', section, folderId);
  }

  function openLocationContextMenu(event, section) {
    openContextMenu(event, 'location', section);
  }

  if (containerContextMenu) {
    containerContextMenu.hidden = true;
    containerContextMenu.addEventListener('click', (event) => event.stopPropagation());
    renderMenuButtons();
  }

  documentRef?.addEventListener?.('click', (event) => {
    if (!containerContextMenu?.hidden && !containerContextMenu.contains?.(event.target)) {
      hideContainerContextMenu();
    }
  });
  documentRef?.addEventListener?.('keydown', (event) => {
    if (event.key === 'Escape') {
      hideContainerContextMenu();
    }
  });
  windowRef?.addEventListener?.('resize', hideContainerContextMenu);
  windowRef?.addEventListener?.('scroll', hideContainerContextMenu, true);

  Object.assign(ctx, {
    hideContainerContextMenu,
    openContainerContextMenu,
    openFolderContextMenu,
    openLocationContextMenu
  });
}
