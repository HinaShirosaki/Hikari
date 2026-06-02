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
    inventorySummaryCard: document.getElementById('inventory-summary-card'),
    addContainerBtn: document.getElementById('inventory-add-container-btn'),
    addContainerForm: document.getElementById('inventory-add-container-form'),
    addContainerNameInput: document.getElementById('inventory-add-container-name'),
    addContainerLocationSelect: document.getElementById('inventory-add-container-location'),
    addContainerTypeSelect: document.getElementById('inventory-add-container-type'),
    addContainerGridFields: document.getElementById('inventory-add-container-grid-fields'),
    addContainerRowsInput: document.getElementById('inventory-add-container-rows'),
    addContainerColsInput: document.getElementById('inventory-add-container-cols'),
    addContainerCancelBtn: document.getElementById('inventory-add-container-cancel'),
    sampleCompoundDialogOverlay: document.getElementById('sample-compound-dialog-overlay'),
    sampleCompoundDialogCloseBtn: document.getElementById('sample-compound-dialog-close-btn'),
    sampleCompoundDialogCancelBtn: document.getElementById('sample-compound-dialog-cancel-btn'),
    sampleCompoundDialogApplyBtn: document.getElementById('sample-compound-dialog-apply-btn'),
    sampleCompoundKetcherFrame: document.getElementById('sample-compound-ketcher-frame')
  };
  const uiState = {
    selectedContainer: null,
    selectedSectionName: '',
    editingWellIndex: null,
    editingSampleId: '',
    wellEditorStatus: '',
    isAddContainerFormOpen: false,
    shouldAutoOpenContainer: true
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
    structureEditorContext: null,
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
