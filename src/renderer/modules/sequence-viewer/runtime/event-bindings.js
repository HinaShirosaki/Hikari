import { bindFileDropTarget } from '../../../lib/file-drop.js';
import { FILE_ACCEPT, LIBRARY_STATUS_SAVED } from './config.js';

export function bindSequenceViewerRuntimeEvents(ctx) {
  const { actions, controllers, dialogs, elements, state } = ctx;

  elements.modePasteBtn?.addEventListener('click', () => actions.setMode('paste'));
  elements.modeFileBtn?.addEventListener('click', () => actions.setMode('file'));
  elements.fileChooseBtn?.addEventListener('click', () => elements.fileInput?.click());
  elements.fileInput?.addEventListener('change', async () => {
    const file = elements.fileInput.files?.[0];
    if (!file) {
      return;
    }
    try {
      actions.setStatus('Loading file...');
      state.fileText = await actions.readFileAsText(file);
      state.fileName = String(file.name || '');
      if (elements.fileNameLabel) {
        elements.fileNameLabel.textContent = state.fileName || 'No file selected';
      }
      actions.setStatus(`Loaded file: ${state.fileName || 'input'}`);
    } catch (error) {
      state.fileText = '';
      state.fileName = '';
      if (elements.fileNameLabel) {
        elements.fileNameLabel.textContent = 'No file selected';
      }
      actions.setStatus(error.message || 'Failed to load file.', true);
    }
  });

  bindFileDropTarget({
    target: elements.detailWorkspace || elements.filePanel,
    accept: FILE_ACCEPT,
    onFiles: ([file]) => actions.openDroppedSequenceFile(file),
    onRejected: () => actions.setStatus('Drop a supported GBK, FASTA, FASTQ, or sequence text file.', true),
    onError: (error) => actions.setStatus(String(error?.message || error || 'Failed to open dropped sequence file.'), true)
  });

  elements.loadBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void actions.loadCurrentInput();
  });
  elements.backboneDialogCandidates?.addEventListener('click', (event) => {
    const candidateId = actions.getDatasetValueFromTarget(event.target, 'candidateId');
    if (candidateId) {
      dialogs.updateBackboneRecognitionDialogSelection({ candidateId });
    }
  });
  elements.backboneDialogModeGibsonBtn?.addEventListener('click', () => dialogs.updateBackboneRecognitionDialogSelection({ variantMode: 'gibson' }));
  elements.backboneDialogModeRestrictionBtn?.addEventListener('click', () => dialogs.updateBackboneRecognitionDialogSelection({ variantMode: 'restriction' }));
  elements.backboneDialogApplyBtn?.addEventListener('click', () => void actions.applyBackboneRecognitionSelection());
  elements.backboneDialogCloseBtn?.addEventListener('click', () => closeDialogWithStatus(ctx, 'Backbone recognition review closed.'));
  elements.backboneDialogCancelBtn?.addEventListener('click', () => closeDialogWithStatus(ctx, 'Backbone recognition review canceled.'));
  elements.backboneDialogOverlay?.addEventListener('click', (event) => {
    if (event.target === elements.backboneDialogOverlay) {
      closeDialogWithStatus(ctx, 'Backbone recognition review closed.');
    }
  });

  controllers.home.bindEvents();
  controllers.detail.bindEvents();
  controllers.alignment?.bindEvents?.();
  controllers.cloningDesign?.bindEvents?.();
  controllers.proteinBuilder?.bindEvents?.();
  controllers.home.setLibraryFilter(LIBRARY_STATUS_SAVED);
  controllers.home.setLocalWorkspaceVisibility('home');
}

function closeDialogWithStatus(ctx, message) {
  ctx.dialogs.closeBackboneRecognitionDialog();
  ctx.actions.setStatus(message);
}
