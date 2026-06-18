export function installChemicalDialog(ctx) {
  const { chemicalDialogOverlay, chemicalDialogTitle, chemicalForm, chemicalId, chemicalName } = ctx.elements;
  const renderLocationOptions = (...args) => ctx.renderLocationOptions(...args);

function updateChemicalDialogTitle() {
  if (!chemicalDialogTitle) {
    return;
  }
  chemicalDialogTitle.textContent = chemicalId.value ? 'Edit Chemical' : 'Add Chemical';
}

function openChemicalDialog() {
  if (!chemicalDialogOverlay) {
    return;
  }
  updateChemicalDialogTitle();
  chemicalDialogOverlay.hidden = false;
  requestAnimationFrame(() => {
    chemicalName.focus();
  });
}

function clearChemicalForm() {
  chemicalId.value = '';
  chemicalForm.reset();
  renderLocationOptions();
  updateChemicalDialogTitle();
}

function startNewChemical() {
  clearChemicalForm();
  openChemicalDialog();
}

function resetChemicalForm() {
  clearChemicalForm();
  if (chemicalDialogOverlay) {
    chemicalDialogOverlay.hidden = true;
  }
}

function onChemicalDialogOverlayClick(event) {
  if (event.target === chemicalDialogOverlay) {
    resetChemicalForm();
  }
}

function onChemicalDialogKeydown(event) {
  if (event.key === 'Escape' && chemicalDialogOverlay && !chemicalDialogOverlay.hidden) {
    event.preventDefault();
    resetChemicalForm();
  }
}

  Object.assign(ctx, {
    updateChemicalDialogTitle,
    openChemicalDialog,
    clearChemicalForm,
    startNewChemical,
    resetChemicalForm,
    onChemicalDialogOverlayClick,
    onChemicalDialogKeydown
  });
}
