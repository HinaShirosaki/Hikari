import { getContainerTypeLabel } from './constants.js';
import {
  renderFolderTreeLeaf,
  renderFolderTreeNode
} from '../../lib/folder-tree.js';

export function installSectionNavigation(ctx) {
  const { helpers, safeText, state, uiState } = ctx;
  const { inventoryLocationNav, inventorySummaryCard } = ctx.elements;

  function getFolderTreeKey(section, folderId) {
    return `${String(section || '')}::folder::${String(folderId || '')}`;
  }

  function revealFolderPath(section, folderId) {
    const folderIds = [folderId, ...(helpers.getFolderAncestorIds?.(section, folderId) || [])];
    ctx.folderTree.reveal(folderIds.map((id) => getFolderTreeKey(section, id)));
  }

  function revealContainerPath(section, containerId) {
    const container = helpers.getContainer(section, containerId);
    if (container?.folderId) {
      revealFolderPath(section, container.folderId);
    }
  }

  function openContainer(section, containerId) {
    const container = helpers.getContainer(section, containerId);
    if (!container) {
      return;
    }
    ctx.hideContainerContextMenu?.();
    uiState.selectedSectionName = section;
    uiState.selectedContainer = { section, containerId };
    uiState.editingWellIndex = -1;
    uiState.editingSampleId = '';
    uiState.wellEditorStatus = '';
    uiState.shouldAutoOpenContainer = false;
    revealContainerPath(section, containerId);
    ctx.renderSections();
  }

  function getContainerGlyphType(container) {
    return ['single', 'plate96'].includes(container?.type) ? container.type : 'box81';
  }

  function renderContainerLeaf(section, container) {
    const isActive = uiState.selectedContainer
      && uiState.selectedContainer.section === section
      && uiState.selectedContainer.containerId === container.id;
    const sampleCount = helpers.getContainerSampleCount(section, container.id);
    const glyphType = getContainerGlyphType(container);
    return renderFolderTreeLeaf({
      active: Boolean(isActive),
      wrapperClass: 'inventory-container-tree-node',
      wrapperAttributes: { 'data-container-node': container.id },
      controlClass: `inventory-container-btn${isActive ? ' active' : ''}`,
      controlAttributes: {
        'data-container-open': container.id,
        'data-section': section,
        title: getContainerTypeLabel(container)
      },
      contentHtml: `
          <span class="inventory-container-glyph inventory-container-glyph-${safeText(glyphType)}" aria-hidden="true"></span>
          <span class="inventory-container-copy">
            <span class="inventory-container-name">${safeText(container.name)}</span>
            <span class="inventory-container-type">${safeText(getContainerTypeLabel(container))}</span>
          </span>
          <span class="inventory-container-count">${safeText(String(sampleCount))}</span>
      `
    });
  }

  function renderFolderNode(section, folder, renderedFolderIds) {
    const folderId = String(folder?.id || '');
    if (!folderId || renderedFolderIds.has(folderId)) {
      return '';
    }
    renderedFolderIds.add(folderId);
    const childFolders = helpers.getFolderChildren?.(section, folder.id) || [];
    const childContainers = helpers.getContainersInFolder?.(section, folder.id) || [];
    const hasChildren = childFolders.length + childContainers.length > 0;
    const treeKey = getFolderTreeKey(section, folder.id);
    const isExpanded = ctx.folderTree.isExpanded(treeKey, hasChildren);
    const childMarkup = [
      ...childFolders.map((child) => renderFolderNode(section, child, renderedFolderIds)),
      ...childContainers.map((container) => renderContainerLeaf(section, container))
    ].filter(Boolean).join('');
    return renderFolderTreeNode({
      key: treeKey,
      expanded: isExpanded,
      expandable: hasChildren,
      label: folder.name,
      meta: String(childContainers.length),
      childrenHtml: childMarkup,
      nodeClass: 'inventory-folder-tree-node',
      rowClass: 'inventory-folder-item',
      disclosureClass: 'inventory-folder-toggle',
      mainClass: 'inventory-folder-btn',
      labelClass: 'inventory-folder-name',
      metaClass: 'inventory-folder-count',
      childrenClass: 'inventory-folder-children',
      nodeAttributes: { 'data-inventory-folder-node': folder.id },
      disclosureAttributes: {
        'data-inventory-folder-toggle': folder.id,
        'data-section': section
      },
      mainAttributes: {
        'data-folder-tree-toggle': treeKey,
        'data-inventory-folder-toggle': folder.id,
        'data-inventory-folder-context': folder.id,
        'data-section': section,
        'aria-expanded': String(isExpanded)
      },
      actionHtml: `
        <button
          type="button"
          class="inventory-folder-add-container-btn folder-tree-template__action"
          data-folder-add-container="${safeText(folder.id)}"
          data-section="${safeText(section)}"
          aria-label="Add a physical container to ${safeText(folder.name)}"
          title="Add container here"
        ><span aria-hidden="true">+</span></button>
      `
    });
  }

  function renderSectionNavigation(activeSection) {
    if (!inventoryLocationNav) {
      return;
    }

    inventoryLocationNav.innerHTML = helpers.getSectionNames().map((section) => {
      const display = helpers.getSectionDisplay(section);
      const containerCount = helpers.getSectionContainerCount(section);
      const folderCount = helpers.getSectionFolderCount?.(section) || 0;
      const sampleCount = helpers.getSectionSampleCount(section);
      const containers = state.inventory?.[section] || [];
      const folders = helpers.getFolders?.(section) || [];
      const renderedFolderIds = new Set();
      const rootFolders = helpers.getRootFolders?.(section) || [];
      const folderTree = [
        ...rootFolders.map((folder) => renderFolderNode(section, folder, renderedFolderIds)),
        ...folders
          .filter((folder) => !renderedFolderIds.has(String(folder?.id || '')))
          .map((folder) => renderFolderNode(section, folder, renderedFolderIds))
      ].filter(Boolean).join('');
      const rootContainers = helpers.getContainersInFolder?.(section, '') || containers;
      const containerLeaves = rootContainers.map((container) => renderContainerLeaf(section, container)).join('');
      const treeMarkup = `${folderTree}${containerLeaves}`;
      const itemCount = folders.length + containers.length;
      const containerMarkup = section === activeSection
        ? `
          <div class="inventory-container-nav">
            ${itemCount ? `<div class="inventory-container-tree folder-tree-template">${treeMarkup}</div>` : '<p class="small-note inventory-container-nav-empty">No folders or containers in this section yet.</p>'}
          </div>
        `
        : '';
      const folderMeta = folderCount ? ` · ${folderCount} folder${folderCount === 1 ? '' : 's'}` : '';
      return `
        <div class="inventory-location-group">
          <div class="inventory-location-row">
            <button type="button" class="inventory-location-btn${section === activeSection ? ' active' : ''}" data-inventory-section="${safeText(section)}">
              <span class="inventory-location-icon">${safeText(display.short)}</span>
              <span class="inventory-location-copy">
                <span class="inventory-location-title">${safeText(display.title)}</span>
                <span class="inventory-location-meta">${safeText(`${containerCount} container${containerCount === 1 ? '' : 's'}${folderMeta}`)}</span>
              </span>
              <span class="inventory-location-count">${safeText(String(sampleCount))}</span>
            </button>
            <button
              type="button"
              class="inventory-location-add-container-btn folder-tree-template__action"
              data-location-add-container="${safeText(section)}"
              aria-label="Add a physical container to ${safeText(display.title)}"
              title="Add container here"
            ><span aria-hidden="true">+</span></button>
          </div>
          ${containerMarkup}
        </div>
      `;
    }).join('');

    inventoryLocationNav.querySelectorAll('[data-inventory-section]').forEach((button) => {
      button.addEventListener('click', () => {
        const section = button.dataset.inventorySection || helpers.getPreferredSection();
        uiState.selectedSectionName = section;
        uiState.editingWellIndex = -1;
        uiState.editingSampleId = '';
        uiState.wellEditorStatus = '';
        const rootContainers = helpers.getContainersInFolder?.(section, '') || [];
        const firstContainer = rootContainers[0] || (state.inventory?.[section] || [])[0];
        if (firstContainer) {
          ctx.openContainer(section, firstContainer.id);
          return;
        }
        uiState.selectedContainer = null;
        ctx.renderSections();
      });
      button.addEventListener('contextmenu', (event) => {
        ctx.openLocationContextMenu?.(event, button.dataset.inventorySection);
      });
      button.addEventListener('dblclick', (event) => {
        event.preventDefault?.();
        ctx.beginInventoryRename?.({ section: button.dataset.inventorySection }, 'location');
      });
    });

    inventoryLocationNav.querySelectorAll('[data-container-open]').forEach((button) => {
      button.addEventListener('click', () => {
        ctx.openContainer(button.dataset.section, button.dataset.containerOpen);
      });
      button.addEventListener('contextmenu', (event) => {
        ctx.openContainerContextMenu?.(event, button.dataset.section, button.dataset.containerOpen);
      });
      button.addEventListener('dblclick', (event) => {
        event.preventDefault?.();
        ctx.beginInventoryRename?.({
          section: button.dataset.section,
          containerId: button.dataset.containerOpen
        }, 'container');
      });
    });

    inventoryLocationNav.querySelectorAll('[data-inventory-folder-toggle]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        const section = button.dataset.section;
        const folderId = button.dataset.inventoryFolderToggle;
        const hasChildren = (helpers.getFolderChildren?.(section, folderId) || []).length
          + (helpers.getContainersInFolder?.(section, folderId) || []).length > 0;
        ctx.folderTree.toggle(getFolderTreeKey(section, folderId), hasChildren);
        renderSectionNavigation(activeSection);
      });
      if (button.dataset.inventoryFolderContext) {
        button.addEventListener('contextmenu', (event) => {
          ctx.openFolderContextMenu?.(event, button.dataset.section, button.dataset.inventoryFolderContext);
        });
        button.addEventListener('dblclick', (event) => {
          event.preventDefault?.();
          ctx.beginInventoryRename?.({
            section: button.dataset.section,
            folderId: button.dataset.inventoryFolderContext
          }, 'folder');
        });
      }
    });

    inventoryLocationNav.querySelectorAll('[data-folder-add-container]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        ctx.hideContainerContextMenu?.();
        ctx.beginAddContainer?.({
          section: button.dataset.section,
          folderId: button.dataset.folderAddContainer
        });
      });
    });

    inventoryLocationNav.querySelectorAll('[data-location-add-container]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        ctx.hideContainerContextMenu?.();
        ctx.beginAddContainer?.({ section: button.dataset.locationAddContainer });
      });
    });
  }

  function renderSummaryCard() {
    if (!inventorySummaryCard) {
      return;
    }
    const summary = helpers.getInventorySummaryCounts();
    const plasmidLabel = helpers.getSampleTypeLabel('plasmid');
    const cellLineLabel = helpers.getSampleTypeLabel('cell_line');
    const proteinLabel = helpers.getSampleTypeLabel('protein');
    inventorySummaryCard.innerHTML = `
      <div class="inventory-summary-head">
        <h3>Inventory Summary</h3>
      </div>
      <div class="inventory-summary-stats">
        <div class="inventory-summary-row"><span class="inventory-summary-label"><span class="inventory-summary-dot inventory-summary-dot-total"></span>Total Samples</span><strong>${safeText(String(summary.total))}</strong></div>
        <div class="inventory-summary-row"><span class="inventory-summary-label"><span class="inventory-summary-dot inventory-summary-dot-plasmid"></span>${safeText(plasmidLabel)}</span><strong>${safeText(String(summary.plasmid))}</strong></div>
        <div class="inventory-summary-row"><span class="inventory-summary-label"><span class="inventory-summary-dot inventory-summary-dot-cell"></span>${safeText(cellLineLabel)}</span><strong>${safeText(String(summary.cell_line))}</strong></div>
        <div class="inventory-summary-row"><span class="inventory-summary-label"><span class="inventory-summary-dot inventory-summary-dot-protein"></span>${safeText(proteinLabel)}</span><strong>${safeText(String(summary.protein))}</strong></div>
      </div>
    `;
  }

  Object.assign(ctx, {
    openContainer,
    revealFolderPath,
    revealContainerPath,
    renderSectionNavigation,
    renderSummaryCard
  });
}
