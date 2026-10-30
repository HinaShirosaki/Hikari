import { bindFileDropTarget } from '../../../lib/file-drop.js';
import { FILE_ACCEPT, LIBRARY_STATUS_SAVED } from './config.js';
import { bindDnaMessage, dnaFailure, dnaUi, setDnaText } from '../localization.js';

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
      actions.setStatus(dnaUi('status.loadingFile'));
      state.fileText = await actions.readFileAsText(file);
      state.fileName = String(file.name || '');
      if (elements.fileNameLabel) {
        if (state.fileName) bindDnaMessage(elements.fileNameLabel, state.fileName);
        else setDnaText(elements.fileNameLabel, 'file.none');
      }
      actions.setStatus(dnaUi('status.loadedFile', { file: state.fileName || 'input' }));
    } catch (error) {
      state.fileText = '';
      state.fileName = '';
      if (elements.fileNameLabel) {
        setDnaText(elements.fileNameLabel, 'file.none');
      }
      actions.setStatus(dnaFailure(error, 'status.loadFileFailed'), true);
    }
  });

  bindFileDropTarget({
    target: elements.detailWorkspace || elements.filePanel,
    accept: FILE_ACCEPT,
    onFiles: ([file]) => actions.openDroppedSequenceFile(file),
    onRejected: () => actions.setStatus(dnaUi('notice.dropUnsupported'), true),
    onError: (error) => actions.setStatus(dnaFailure(error, 'notice.dropFailed'), true)
  });

  elements.form?.addEventListener('submit', (event) => {
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
  controllers.vectorBuilder?.bindEvents?.();
  controllers.proteinBuilder?.bindEvents?.();
  controllers.primerOrder?.bindEvents?.();
  controllers.primerLibrary?.bindEvents?.();

  elements.vectorBuilderOpenBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    controllers.vectorBuilder?.open?.();
  });

  // Home works off a library selection rather than a loaded record, so open the
  // previewed entry first and then hand it to Vector Builder.
  elements.homeVectorBuilderBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void (async () => {
      const selectedEntryId = String(state.selectedLibraryEntryId || '').trim();
      if (selectedEntryId) {
        await controllers.home?.openLibraryEntryInDetail?.(selectedEntryId);
      }
      controllers.vectorBuilder?.open?.();
    })();
  });
  controllers.home.setLibraryFilter(LIBRARY_STATUS_SAVED);
  controllers.home.setLocalWorkspaceVisibility('home');
}

function closeDialogWithStatus(ctx, message) {
  ctx.dialogs.closeBackboneRecognitionDialog();
  ctx.actions.setStatus(message);
}
