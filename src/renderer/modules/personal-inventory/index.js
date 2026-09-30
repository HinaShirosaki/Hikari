import { installContainerForm } from './container-form.js';
import { installContainerContextMenu } from './container-context-menu.js';
import { createPersonalInventoryContext } from './controller-context.js';
import { bindPersonalInventoryEvents } from './events.js';
import { installPersonalInventoryRendering } from './rendering.js';
import { installSectionNavigation } from './section-navigation.js';
import { installStructureActions } from './structure-actions.js';
import { installStructureState } from './structure-state.js';

// Sample storage (freezers, boxes, plates). Data model:
//   state.inventory[location]        -> containers { id, type, folderId, wells }
//   state.inventoryFolders[location] -> folders { id, parentFolderId }
//   sample.inventoryLink             -> { section: location, containerId, wellIndex }
// Samples live in state.samples and point at their slot; containers never
// list their samples. wellIndex is null for a single (non-grid) container.
// install* functions share one ctx; later ones call earlier ones through it.
export function initPersonalInventory(options = {}) {
  const ctx = createPersonalInventoryContext(options);
  installStructureState(ctx);
  installStructureActions(ctx);
  installContainerForm(ctx);
  installContainerContextMenu(ctx);
  installSectionNavigation(ctx);
  installPersonalInventoryRendering(ctx);
  bindPersonalInventoryEvents(ctx);

  function openSample(sampleId) {
    const sample = ctx.helpers.getSampleById(sampleId);
    const section = String(sample?.inventoryLink?.section || '');
    const containerId = String(sample?.inventoryLink?.containerId || '');
    const container = section && containerId ? ctx.helpers.getContainer(section, containerId) : null;
    if (!sample || !container) {
      return false;
    }
    const rawWellIndex = sample.inventoryLink?.wellIndex;
    const wellIndex = Number(rawWellIndex);
    ctx.uiState.selectedSectionName = section;
    ctx.uiState.selectedContainer = { section, containerId };
    ctx.uiState.editingWellIndex = rawWellIndex !== null
      && rawWellIndex !== ''
      && Number.isInteger(wellIndex)
      && wellIndex >= 0
      ? wellIndex
      : -1;
    ctx.uiState.editingSampleId = sample.id;
    ctx.uiState.wellEditorStatus = '';
    ctx.uiState.shouldAutoOpenContainer = false;
    ctx.revealContainerPath?.(section, containerId);
    ctx.renderSections();
    return true;
  }

  return { renderSections: ctx.renderSections, openSample };
}
