export function installSectionNavigation(ctx) {
  const { helpers, safeText, state, uiState } = ctx;
  const { inventoryLocationNav, inventorySummaryCard } = ctx.elements;

function openContainer(section, containerId) {
  const container = helpers.getContainer(section, containerId);
  if (!container) {
    return;
  }
  uiState.selectedSectionName = section;
  uiState.selectedContainer = { section, containerId };
  uiState.editingWellIndex = -1;
  uiState.editingSampleId = '';
  uiState.wellEditorStatus = '';
  uiState.shouldAutoOpenContainer = false;
  ctx.renderSections();
}

function renderSectionNavigation(activeSection) {
  if (!inventoryLocationNav) {
    return;
  }

  inventoryLocationNav.innerHTML = helpers.getSectionNames().map((section) => {
    const display = helpers.getSectionDisplay(section);
    const containerCount = helpers.getSectionContainerCount(section);
    const sampleCount = helpers.getSectionSampleCount(section);
    const containers = state.inventory?.[section] || [];
    const containerMarkup = section === activeSection
      ? `
        <div class="inventory-container-nav">
          ${containers.length ? containers.map((container) => {
            const isActive = uiState.selectedContainer && uiState.selectedContainer.section === section && uiState.selectedContainer.containerId === container.id;
            return `
              <div class="inventory-container-item">
                <button type="button" class="inventory-container-btn${isActive ? ' active' : ''}" data-container-open="${safeText(container.id)}" data-section="${safeText(section)}">
                  <span class="inventory-container-name">${safeText(container.name)}</span>
                </button>
              </div>
            `;
          }).join('') : '<p class="small-note inventory-container-nav-empty">No containers in this section yet.</p>'}
        </div>
      `
      : '';
    return `
      <div class="inventory-location-group">
        <button type="button" class="inventory-location-btn${section === activeSection ? ' active' : ''}" data-inventory-section="${safeText(section)}">
          <span class="inventory-location-icon">${safeText(display.short)}</span>
          <span class="inventory-location-copy">
            <span class="inventory-location-title">${safeText(display.title)}</span>
            <span class="inventory-location-meta">${safeText(`${containerCount} container${containerCount === 1 ? '' : 's'}`)}</span>
          </span>
          <span class="inventory-location-count">${safeText(String(sampleCount))}</span>
        </button>
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
      const firstContainer = (state.inventory?.[section] || [])[0];
      if (firstContainer) {
        ctx.openContainer(section, firstContainer.id);
        return;
      }
      uiState.selectedContainer = null;
      ctx.renderSections();
    });
  });

  inventoryLocationNav.querySelectorAll('[data-container-open]').forEach((button) => {
    button.addEventListener('click', () => {
      ctx.openContainer(button.dataset.section, button.dataset.containerOpen);
    });
  });
}

function renderSummaryCard(activeSection) {
  if (!inventorySummaryCard) {
    return;
  }
  const summary = helpers.getInventorySummaryCounts();
  const activeDisplay = helpers.getSectionDisplay(activeSection);
  const plasmidLabel = helpers.getSampleTypeLabel('plasmid');
  const cellLineLabel = helpers.getSampleTypeLabel('cell_line');
  const proteinLabel = helpers.getSampleTypeLabel('protein');
  inventorySummaryCard.innerHTML = `
    <div class="inventory-summary-head">
      <h3>Inventory Summary</h3>
      <p class="small-note">${safeText(activeDisplay.title)} has ${safeText(String(helpers.getSectionContainerCount(activeSection)))} container(s) and ${safeText(String(helpers.getSectionSampleCount(activeSection)))} linked sample(s).</p>
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
    renderSectionNavigation,
    renderSummaryCard
  });
}
