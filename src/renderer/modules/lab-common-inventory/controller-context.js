export function createLabCommonInventoryContext({ state, persist, createId, safeText }) {
  const elements = {
    chemicalOpenAddBtn: document.getElementById('chemical-open-add-btn'),
    chemicalImportBtn: document.getElementById('chemical-import-btn'),
    chemicalImportFile: document.getElementById('chemical-import-file'),
    chemicalImportStatus: document.getElementById('chemical-import-status'),
    chemicalDialogOverlay: document.getElementById('chemical-dialog-overlay'),
    chemicalDialogTitle: document.getElementById('chemical-dialog-title'),
    chemicalDialogCloseBtn: document.getElementById('chemical-dialog-close-btn'),
    chemicalForm: document.getElementById('chemical-form'),
    chemicalId: document.getElementById('chemical-id'),
    chemicalName: document.getElementById('chemical-name'),
    chemicalCas: document.getElementById('chemical-cas'),
    chemicalLocation: document.getElementById('chemical-location'),
    chemicalVendor: document.getElementById('chemical-vendor'),
    chemicalCatalogNumber: document.getElementById('chemical-catalog-number'),
    chemicalUnitSize: document.getElementById('chemical-unit-size'),
    chemicalPrice: document.getElementById('chemical-price'),
    chemicalStock: document.getElementById('chemical-stock'),
    chemicalUrl: document.getElementById('chemical-url'),
    chemicalExpiration: document.getElementById('chemical-expiration'),
    chemicalCancelBtn: document.getElementById('chemical-cancel-btn'),
    chemicalList: document.getElementById('chemical-list'),
    chemicalSearch: document.getElementById('chemical-search'),
    chemicalResultsSummary: document.getElementById('chemical-results-summary'),
    chemicalFilterLocation: document.getElementById('chemical-filter-location'),
    chemicalSort: document.getElementById('chemical-sort'),
    chemicalDetailPanel: document.getElementById('chemical-detail-panel'),
    chemicalDetailTitle: document.getElementById('chemical-detail-title'),
    chemicalDetailContent: document.getElementById('chemical-detail-content'),
    chemicalDetailEditBtn: document.getElementById('chemical-detail-edit-btn'),
    chemicalDetailDeleteBtn: document.getElementById('chemical-detail-delete-btn'),
    blockchainList: document.getElementById('inventory-blockchain-list')
  };
  const ctx = { state, persist, createId, safeText, elements, selectedChemicalId: '', lastChemicalSqliteSyncKey: '' };
  ctx.ensureLabInventoryShape = function ensureLabInventoryShape() {
    if (!state.labInventory || typeof state.labInventory !== 'object') {
      state.labInventory = { chemicals: [], blocks: [], lastLocationNumber: 0 };
    }
    if (!Array.isArray(state.labInventory.chemicals)) {
      state.labInventory.chemicals = [];
    }
    if (!Array.isArray(state.labInventory.blocks)) {
      state.labInventory.blocks = [];
    }
    if (!Number.isFinite(Number(state.labInventory.lastLocationNumber))) {
      state.labInventory.lastLocationNumber = 0;
    }
    if (!state.labInventory.locationCodeMap || typeof state.labInventory.locationCodeMap !== 'object') {
      state.labInventory.locationCodeMap = {};
    }
    if (!state.labInventory.locationCodeNextByLocation || typeof state.labInventory.locationCodeNextByLocation !== 'object') {
      state.labInventory.locationCodeNextByLocation = {};
    }
  };
  return ctx;
}
