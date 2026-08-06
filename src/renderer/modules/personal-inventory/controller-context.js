import { createPersonalInventoryStateHelpers } from './state.js';
import { createPersonalInventoryDetailRenderer } from './detail-rendering.js';
import { createFolderTreeState } from '../../lib/folder-tree.js';

export function createPersonalInventoryContext({
  state,
  persist,
  createId,
  safeText,
  onSamplesChanged,
  onSampleRecorded,
  onInventoryChanged
}) {
  const elements = {
    inventorySections: document.getElementById('inventory-sections'),
    inventoryLocationNav: document.getElementById('inventory-location-nav'),
    containerContextMenu: document.getElementById('inventory-container-context-menu'),
    inventorySummaryCard: document.getElementById('inventory-summary-card'),
    addContainerBtn: document.getElementById('inventory-add-container-btn'),
    addContainerOverlay: document.getElementById('inventory-add-container-overlay'),
    addContainerForm: document.getElementById('inventory-add-container-form'),
    addContainerTitle: document.getElementById('inventory-add-container-title'),
    addContainerNote: document.getElementById('inventory-add-container-note'),
    addItemNameLabel: document.getElementById('inventory-add-item-name-label'),
    addContainerNameInput: document.getElementById('inventory-add-container-name'),
    addContainerLocationSelect: document.getElementById('inventory-add-container-location'),
    addContainerTypeField: document.getElementById('inventory-add-container-type-field'),
    addContainerTypeSelect: document.getElementById('inventory-add-container-type'),
    addContainerGridFields: document.getElementById('inventory-add-container-grid-fields'),
    addContainerRowsInput: document.getElementById('inventory-add-container-rows'),
    addContainerColsInput: document.getElementById('inventory-add-container-cols'),
    addContainerSubmit: document.getElementById('inventory-add-container-submit'),
    addContainerCloseBtn: document.getElementById('inventory-add-container-close'),
    addContainerCancelBtn: document.getElementById('inventory-add-container-cancel')
  };
  const uiState = {
    selectedContainer: null,
    selectedSectionName: '',
    editingWellIndex: null,
    editingSampleId: '',
    wellEditorStatus: '',
    isAddContainerFormOpen: false,
    addItemMode: 'container',
    addItemTarget: null,
    shouldAutoOpenContainer: true,
    contextContainer: null,
    contextFolder: null,
    contextLocation: null,
    cloningSampleId: null
  };
  const pendingStructureDrafts = new Map();
  const folderTree = createFolderTreeState({ defaultExpanded: true });
  const helpers = createPersonalInventoryStateHelpers({ state, safeText, uiState });
  const ctx = {
    state,
    persist,
    createId,
    safeText,
    elements,
    uiState,
    folderTree,
    pendingStructureDrafts,
    helpers,
    structurePasteContext: null,
    notifySamplesChanged() {
      if (typeof onSamplesChanged === 'function') {
        onSamplesChanged();
      }
    },
    notifySampleRecorded(sample) {
      if (typeof onSampleRecorded === 'function') {
        onSampleRecorded(sample);
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
