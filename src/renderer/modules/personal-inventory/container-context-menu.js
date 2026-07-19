import { deleteContainer } from './container-delete-events.js';
import { renameContainer } from './container-rename-events.js';
import { deleteInventoryFolder, renameInventoryFolder } from './folder-actions.js';

export function installContainerContextMenu(ctx) {
  const { containerContextMenu } = ctx.elements;
  const { uiState } = ctx;
  const documentRef = typeof document !== 'undefined' ? document : null;
  const windowRef = typeof window !== 'undefined' ? window : null;

  function hideContainerContextMenu() {
    uiState.contextContainer = null;
    uiState.contextFolder = null;
    if (containerContextMenu) {
      containerContextMenu.hidden = true;
      renderMenuButtons();
    }
  }

  function renderMenuButtons() {
    if (!containerContextMenu) {
      return;
    }
    const isFolder = Boolean(uiState.contextFolder);
    containerContextMenu.innerHTML = isFolder ? `
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
      : ctx.helpers?.getContainer?.(target.section, target.containerId);
    containerContextMenu.innerHTML = '<input type="text" class="personal-inventory-context-rename-input" maxlength="120" />';
    const input = containerContextMenu.querySelector('.personal-inventory-context-rename-input');
    if (!input) {
      return;
    }
    input.value = item?.name || '';
    input.focus();
    input.select();

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

  function openContextMenu(event, targetType, section, itemId) {
    if (!containerContextMenu || !section || !itemId) {
      return;
    }
    event?.preventDefault?.();
    event?.stopPropagation?.();
    uiState.contextContainer = targetType === 'container' ? { section, containerId: itemId } : null;
    uiState.contextFolder = targetType === 'folder' ? { section, folderId: itemId } : null;
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
    openFolderContextMenu
  });
}
