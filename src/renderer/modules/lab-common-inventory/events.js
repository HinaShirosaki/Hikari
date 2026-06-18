export function bindLabCommonInventoryEvents(ctx) {
  const {
    chemicalOpenAddBtn,
    chemicalImportBtn,
    chemicalImportFile,
    chemicalDialogCloseBtn,
    chemicalDialogOverlay,
    chemicalForm,
    chemicalCancelBtn,
    chemicalSearch,
    chemicalFilterLocation,
    chemicalSort,
    chemicalList,
    chemicalDetailEditBtn,
    chemicalDetailDeleteBtn
  } = ctx.elements;

  chemicalOpenAddBtn.addEventListener('click', ctx.startNewChemical);
  chemicalImportBtn?.addEventListener('click', () => {
    chemicalImportFile?.click();
  });
  chemicalImportFile?.addEventListener('change', ctx.onChemicalImportFileChange);
  chemicalDialogCloseBtn.addEventListener('click', ctx.resetChemicalForm);
  chemicalDialogOverlay.addEventListener('click', ctx.onChemicalDialogOverlayClick);
  document.addEventListener('keydown', ctx.onChemicalDialogKeydown);
  chemicalForm.addEventListener('submit', ctx.onChemicalSubmit);
  chemicalCancelBtn.addEventListener('click', ctx.resetChemicalForm);
  chemicalSearch.addEventListener('input', ctx.renderChemicalList);
  chemicalFilterLocation.addEventListener('change', ctx.renderChemicalList);
  chemicalSort.addEventListener('change', ctx.renderChemicalList);
  chemicalList.addEventListener('click', ctx.onChemicalListClick);
  chemicalDetailEditBtn.addEventListener('click', () => {
    if (ctx.selectedChemicalId) {
      ctx.editChemical(ctx.selectedChemicalId);
    }
  });
  chemicalDetailDeleteBtn.addEventListener('click', () => {
    if (ctx.selectedChemicalId) {
      ctx.deleteChemical(ctx.selectedChemicalId);
    }
  });
}
