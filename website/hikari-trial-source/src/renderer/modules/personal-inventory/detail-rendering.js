import { createContainerDetailRenderer } from './detail-container-rendering.js';
import { createSingleContainerEditorRenderer } from './detail-single-editor.js';
import { createStructureRenderer } from './detail-structure-rendering.js';
import { createWellEditorRenderer } from './detail-well-editor.js';

export function createPersonalInventoryDetailRenderer({
  safeText,
  uiState,
  helpers,
  getPendingStructureDraft = () => null
}) {
  const structureRenderer = createStructureRenderer({
    safeText,
    getPendingStructureDraft
  });
  const wellEditorRenderer = createWellEditorRenderer({
    safeText,
    uiState,
    helpers,
    renderStructureAction: structureRenderer.renderStructureAction
  });
  const singleEditorRenderer = createSingleContainerEditorRenderer({
    safeText,
    uiState,
    helpers,
    renderStructureAction: structureRenderer.renderStructureAction
  });

  return createContainerDetailRenderer({
    safeText,
    uiState,
    helpers,
    renderWellEditor: wellEditorRenderer.renderWellEditor,
    renderSingleContainerEditor: singleEditorRenderer.renderSingleContainerEditor
  });
}
