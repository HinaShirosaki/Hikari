export function installChemicalForm(ctx) {
  const { persist, state } = ctx;
  const {
    chemicalId,
    chemicalName,
    chemicalCas,
    chemicalLocation,
    chemicalVendor,
    chemicalCatalogNumber,
    chemicalUnitSize,
    chemicalPrice,
    chemicalStock,
    chemicalUrl,
    chemicalExpiration
  } = ctx.elements;
  const ensureLabInventoryShape = () => ctx.ensureLabInventoryShape();
  const assignLocationCode = (...args) => ctx.assignLocationCode(...args);
  const parseLocationCode = (...args) => ctx.parseLocationCode(...args);
  const appendBlock = (...args) => ctx.appendBlock(...args);
  const broadcastInventoryUpdate = (...args) => ctx.broadcastInventoryUpdate(...args);
  const syncChemicalSqliteBundle = (...args) => ctx.syncChemicalSqliteBundle(...args);
  const resetChemicalForm = (...args) => ctx.resetChemicalForm(...args);
  const renderAll = (...args) => ctx.renderAll(...args);
  const updateChemicalDialogTitle = (...args) => ctx.updateChemicalDialogTitle(...args);
  const openChemicalDialog = (...args) => ctx.openChemicalDialog(...args);
  const renderChemicalDetail = (...args) => ctx.renderChemicalDetail(...args);

function onChemicalSubmit(event) {
  event.preventDefault();
  ensureLabInventoryShape();

  const location = chemicalLocation.value.trim();
  const name = chemicalName.value.trim();
  const casNumber = chemicalCas.value.trim();
  if (!name || !casNumber || !location) {
    return;
  }

  const existingId = chemicalId.value;
  const existing = state.labInventory.chemicals.find((item) => item.id === existingId);
  const locationCode = assignLocationCode(location, existing?.locationCode || '');
  const parsedLocationCode = parseLocationCode(locationCode);
  const locationNumber = Number(parsedLocationCode?.number || existing?.locationNumber || 0);
  state.labInventory.lastLocationNumber = Math.max(Number(state.labInventory.lastLocationNumber) || 0, locationNumber);

  const record = {
    id: existingId || createId(),
    name,
    casNumber,
    location,
    locationCode,
    locationNumber,
    vendor: chemicalVendor.value.trim(),
    catalogNumber: chemicalCatalogNumber.value.trim(),
    unitSize: chemicalUnitSize.value.trim(),
    price: chemicalPrice.value.trim(),
    amountInStock: chemicalStock.value.trim(),
    url: chemicalUrl.value.trim(),
    expirationDate: chemicalExpiration.value,
    updatedAt: new Date().toISOString()
  };

  const index = state.labInventory.chemicals.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    state.labInventory.chemicals[index] = record;
  } else {
    state.labInventory.chemicals.push(record);
  }
  ctx.selectedChemicalId = record.id;

  appendBlock('UPSERT_CHEMICAL', {
    chemicalId: record.id,
    name: record.name,
    casNumber: record.casNumber,
    location: `${record.location}-${record.locationCode || record.locationNumber}`
  });

  broadcastInventoryUpdate(record);
  persist();
  void syncChemicalSqliteBundle(true);
  resetChemicalForm();
  renderAll();
}

function editChemical(id) {
  const item = state.labInventory.chemicals.find((chemical) => chemical.id === id);
  if (!item) {
    return;
  }

  chemicalId.value = item.id;
  chemicalName.value = item.name;
  chemicalCas.value = item.casNumber;
  chemicalLocation.value = item.location;
  chemicalVendor.value = item.vendor || '';
  chemicalCatalogNumber.value = item.catalogNumber || '';
  chemicalUnitSize.value = item.unitSize || '';
  chemicalPrice.value = item.price || '';
  chemicalStock.value = item.amountInStock || '';
  chemicalUrl.value = item.url || '';
  chemicalExpiration.value = item.expirationDate || '';
  ctx.selectedChemicalId = id;
  updateChemicalDialogTitle();
  openChemicalDialog();
  renderChemicalDetail();
}

function deleteChemical(id) {
  ensureLabInventoryShape();
  state.labInventory.chemicals = state.labInventory.chemicals.filter((item) => item.id !== id);
  state.samples = (state.samples || []).map((sample) => {
    const links = Array.isArray(sample.chemicalLinks) ? sample.chemicalLinks : [];
    if (!links.includes(id)) {
      return sample;
    }
    return {
      ...sample,
      chemicalLinks: links.filter((item) => item !== id),
      updatedAt: new Date().toISOString()
    };
  });
  if (ctx.selectedChemicalId === id) {
    ctx.selectedChemicalId = '';
  }
  appendBlock('DELETE_CHEMICAL', { chemicalId: id });
  persist();
  void syncChemicalSqliteBundle(true);
  renderAll();
}

  Object.assign(ctx, {
    onChemicalSubmit,
    editChemical,
    deleteChemical
  });
}
