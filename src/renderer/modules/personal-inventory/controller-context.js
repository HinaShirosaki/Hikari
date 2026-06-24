import { createPersonalInventoryStateHelpers } from './state.js';
import { createPersonalInventoryDetailRenderer } from './detail-rendering.js';

export function createPersonalInventoryContext({
  state,
  persist,
  createId,
  safeText,
  onSamplesChanged,
  onInventoryChanged
}) {
  const elements = {
    inventorySections: document.getElementById('inventory-sections'),
    inventoryLocationNav: document.getElementById('inventory-location-nav'),
    containerContextMenu: document.getElementById('inventory-container-context-menu'),
    inventorySummaryCard: document.getElementById('inventory-summary-card'),
    addContainerBtn: document.getElementById('inventory-add-container-btn'),
    addContainerForm: document.getElementById('inventory-add-container-form'),
    addContainerNameInput: document.getElementById('inventory-add-container-name'),
    addContainerLocationSelect: document.getElementById('inventory-add-container-location'),
    addContainerTypeSelect: document.getElementById('inventory-add-container-type'),
    addContainerGridFields: document.getElementById('inventory-add-container-grid-fields'),
    addContainerRowsInput: document.getElementById('inventory-add-container-rows'),
    addContainerColsInput: document.getElementById('inventory-add-container-cols'),
    addContainerCancelBtn: document.getElementById('inventory-add-container-cancel')
  };
  const uiState = {
    selectedContainer: null,
    selectedSectionName: '',
    editingWellIndex: null,
    editingSampleId: '',
    wellEditorStatus: '',
    isAddContainerFormOpen: false,
    shouldAutoOpenContainer: true,
    contextContainer: null
  };
  const pendingStructureDrafts = new Map();
  const helpers = createPersonalInventoryStateHelpers({ state, safeText, uiState });
  const ctx = {
    state,
    persist,
    createId,
    safeText,
    elements,
    uiState,
    pendingStructureDrafts,
    helpers,
    structurePasteContext: null,
    notifySamplesChanged() {
      if (typeof onSamplesChanged === 'function') {
        onSamplesChanged();
      }
    },
    notifyInventoryChanged() {
      if (typeof onInventoryChanged === 'function') {
        onInventoryChanged();
      }
    }
  };
  const { renderContainerDetail } = createPersonalInventoryDetailRenderer({
    safeText,
    uiState,
    helpers,
    getPendingStructureDraft: (mode) => pendingStructureDrafts.get(ctx.getPendingStructureKey(mode))
  });
  ctx.renderContainerDetail = renderContainerDetail;
  return ctx;
}
