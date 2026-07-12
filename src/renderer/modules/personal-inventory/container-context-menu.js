import { deleteContainer } from './container-delete-events.js';
import { renameContainer } from './container-rename-events.js';

export function installContainerContextMenu(ctx) {
  const { containerContextMenu } = ctx.elements;
  const { uiState } = ctx;
  const documentRef = typeof document !== 'undefined' ? document : null;
  const windowRef = typeof window !== 'undefined' ? window : null;

  function hideContainerContextMenu() {
    uiState.contextContainer = null;
    if (containerContextMenu) {
      containerContextMenu.hidden = true;
      renderMenuButtons();
    }
  }

  function renderMenuButtons() {
    if (!containerContextMenu) {
      return;
    }
    containerContextMenu.innerHTML = `
      <button type="button" class="personal-inventory-context-item" data-container-context-add-child>
        Add Subcontainer
      </button>
      <button type="button" class="personal-inventory-context-item" data-container-context-rename>
        Rename
      </button>
      <button type="button" class="personal-inventory-context-item personal-inventory-context-item-danger" data-container-context-delete>
        Delete
      </button>
    `;
    containerContextMenu.querySelector('[data-container-context-add-child]')?.addEventListener('click', () => {
      const target = uiState.contextContainer;
      hideContainerContextMenu();
      if (target) {
        ctx.beginAddSubcontainer?.(target.section, target.containerId);
      }
    });
    containerContextMenu.querySelector('[data-container-context-rename]')?.addEventListener('click', () => {
      enterRenameMode(uiState.contextContainer);
    });
    containerContextMenu.querySelector('[data-container-context-delete]')?.addEventListener('click', () => {
      const target = uiState.contextContainer;
      hideContainerContextMenu();
      if (target) {
        deleteContainer(ctx, target.section, target.containerId);
      }
    });
  }

  function enterRenameMode(target) {
    if (!containerContextMenu || !target) {
      return;
    }
    const container = ctx.helpers?.getContainer?.(target.section, target.containerId);
    containerContextMenu.innerHTML = '<input type="text" class="personal-inventory-context-rename-input" maxlength="120" />';
    const input = containerContextMenu.querySelector('.personal-inventory-context-rename-input');
    if (!input) {
      return;
    }
    input.value = container?.name || '';
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
      renameContainer(ctx, target.section, target.containerId, nextName);
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

  function openContainerContextMenu(event, section, containerId) {
    if (!containerContextMenu || !section || !containerId) {
      return;
    }
    event?.preventDefault?.();
    event?.stopPropagation?.();
    uiState.contextContainer = { section, containerId };
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
    openContainerContextMenu
  });
}
