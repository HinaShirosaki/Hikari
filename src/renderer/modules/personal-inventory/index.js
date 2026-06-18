import { installContainerForm } from './container-form.js';
import { createPersonalInventoryContext } from './controller-context.js';
import { bindPersonalInventoryEvents } from './events.js';
import { installPersonalInventoryRendering } from './rendering.js';
import { installSectionNavigation } from './section-navigation.js';
import { installStructureActions } from './structure-actions.js';
import { installStructureState } from './structure-state.js';

export function initPersonalInventory(options = {}) {
  const ctx = createPersonalInventoryContext(options);
  installStructureState(ctx);
  installStructureActions(ctx);
  installContainerForm(ctx);
  installSectionNavigation(ctx);
  installPersonalInventoryRendering(ctx);
  bindPersonalInventoryEvents(ctx);
  return { renderSections: ctx.renderSections };
}
