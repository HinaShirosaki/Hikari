import { bindSingleSampleEvents } from './single-sample-events.js';
import { bindStructureButtons } from './structure-bindings.js';
import { bindWellSampleEvents } from './well-sample-events.js';

export function installPersonalInventoryRendering(ctx) {
  const { helpers, safeText, state, uiState } = ctx;
  const { inventorySections } = ctx.elements;

function renderSections() {
  ctx.renderAddContainerLocationOptions();
  ctx.renderAddContainerTypeFields();
  const activeSection = uiState.selectedContainer?.section || helpers.getPreferredSection();
  const activeContainers = state.inventory?.[activeSection] || [];
  if ((!uiState.selectedContainer || uiState.selectedContainer.section !== activeSection || !helpers.getContainer(activeSection, uiState.selectedContainer.containerId))
    && activeContainers.length
    && uiState.shouldAutoOpenContainer) {
    uiState.selectedContainer = { section: activeSection, containerId: activeContainers[0].id };
  }
  uiState.selectedSectionName = activeSection;
  ctx.renderSectionNavigation(activeSection);
  ctx.renderSummaryCard(activeSection);

  const activeContainer = uiState.selectedContainer?.section === activeSection
    ? helpers.getContainer(activeSection, uiState.selectedContainer.containerId)
    : null;
  const hiddenContainerOpeners = activeContainers.length
    ? `<div class="sr-only" aria-hidden="true">${activeContainers.map((container) => `<button type="button" data-container-open="${safeText(container.id)}" data-section="${safeText(activeSection)}">${safeText(container.name)}</button>`).join('')}</div>`
    : '';

  inventorySections.innerHTML = activeContainer
    ? `<section class="inventory-section inventory-section-active">${hiddenContainerOpeners}${ctx.renderContainerDetail(activeSection, activeContainer)}</section>`
    : `<section class="inventory-section inventory-section-active">${hiddenContainerOpeners}<p class="small-note inventory-empty-state">Select a container from the left panel to open its box view.</p></section>`;

  inventorySections.querySelectorAll('[data-container-open]').forEach((button) => {
    button.addEventListener('click', () => {
      ctx.openContainer(button.dataset.section, button.dataset.containerOpen);
    });
  });
    bindWellSampleEvents(ctx);
    bindSingleSampleEvents(ctx);
    bindStructureButtons(ctx);
  }

  ctx.renderSections = renderSections;
}
