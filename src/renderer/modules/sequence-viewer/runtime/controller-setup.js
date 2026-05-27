import { createSequenceViewerAlignmentController } from '../alignment-controller.js';
import { createSequenceViewerAnnotationController } from '../annotation.js';
import { createSequenceViewerCloningDesignController } from '../cloning-design.js';
import { createSequenceViewerDetailController } from '../detail-controller.js';
import { createSequenceViewerHomeController } from '../home-controller.js';
import { createSequenceViewerProteinBuilderController } from '../protein-builder.js';
import {
  FILE_ACCEPT,
  LIBRARY_STATUS_SAVED,
  LIBRARY_STATUS_TEMPORARY
} from './config.js';

export function setupSequenceViewerControllers(ctx) {
  const { actions, controllers, elements, onNavigateDetail, onNavigateHome, options, rootDocument, state } = ctx;
  controllers.home = createSequenceViewerHomeController({
    rootDocument,
    elements,
    state,
    fileAccept: FILE_ACCEPT,
    libraryStatusSaved: LIBRARY_STATUS_SAVED,
    libraryStatusTemporary: LIBRARY_STATUS_TEMPORARY,
    getBridge: actions.getBridge,
    getStoragePath: actions.getStoragePath,
    hasStoragePath: actions.hasStoragePath,
    getSelectedRecord: actions.getSelectedRecord,
    setMode: actions.setMode,
    setInputComposerVisible: actions.setInputComposerVisible,
    setRecords: actions.setRecords,
    setStatus: actions.setStatus,
    readFileAsText: actions.readFileAsText,
    onParsedRecordsOpened: actions.maybePersistImportedGenbankRecord,
    onLibraryEntryLoaded: ({ alignments }) => {
      actions.setAlignmentSessions(alignments);
      controllers.alignment?.handleReferenceRecordChanged?.();
    },
    hideFeatureContextMenu: () => controllers.detail?.hideFeatureContextMenu(),
    hideFeatureEditor: () => controllers.detail?.hideFeatureEditor(),
    onNavigateHome,
    onNavigateDetail,
    onClearAll: actions.clearAll
  });

  controllers.detail = createSequenceViewerDetailController({
    rootDocument,
    elements,
    state,
    getSelectedRecord: actions.getSelectedRecord,
    updateMessages: actions.updateMessages,
    setStatus: actions.setStatus,
    hasStoragePath: actions.hasStoragePath,
    persistFeatureMutation: actions.persistFeatureMutation,
    onRequestAnnotate: () => controllers.annotation?.annotateCurrentRecord?.(),
    onRequestRecognizeBackbone: actions.recognizeCurrentBackboneInsert,
    onRequestClear: actions.clearAll,
    onRequestSave: actions.saveCurrentRecordAsSaved,
    onApplySequenceEdit: actions.applySequenceEdit,
    onRequestAlignment: () => controllers.alignment?.openSequencingAlignmentWorkspace?.(),
    onRequestCloningDesign: () => controllers.cloningDesign?.open?.(),
    hasCloningDesignSource: actions.hasCurrentCloningDesignSource,
    onSelectAlignmentSession: (sessionId) => controllers.alignment?.selectSavedAlignmentSession?.(sessionId, { enableView: true }),
    onConfirmProteinBuilderConstruct: actions.confirmProteinBuilderConstruct,
    onReturnToProteinBuilder: actions.returnToProteinBuilder,
    onReferenceRecordChanged: () => {
      actions.resetAlignmentState({ preserveSessions: true });
      controllers.alignment?.handleReferenceRecordChanged?.();
    }
  });

  controllers.annotation = createSequenceViewerAnnotationController({
    state,
    getSelectedRecord: actions.getSelectedRecord,
    getStoragePath: actions.getStoragePath,
    getBridge: actions.getBridge,
    detailController: controllers.detail,
    persistFeatureMutation: actions.persistFeatureMutation,
    setStatus: actions.setStatus
  });

  controllers.alignment = createSequenceViewerAlignmentController({
    elements,
    viewerState: state,
    setStatus: actions.setStatus,
    setLocalWorkspaceVisibility: controllers.home.setLocalWorkspaceVisibility,
    onNavigateDetail,
    onAlignmentStateChange: () => controllers.detail?.renderActiveRecord?.(),
    getSelectedReferenceRecord: actions.getSelectedRecord,
    persistAlignmentSession: actions.persistAlignmentSession,
    readFileAsText: actions.readFileAsText,
    readFileAsArrayBuffer: actions.readFileAsArrayBuffer
  });

  controllers.cloningDesign = createSequenceViewerCloningDesignController({
    elements,
    state,
    getSelectedRecord: actions.getSelectedRecord,
    getCloningDesignSource: () => state.sequenceEditDesignSource,
    setStatus: actions.setStatus,
    onNavigateCloningDesign: actions.showCloningDesignWorkspace,
    onReturnToDetail: actions.returnToSequenceDetailFromCloningDesign
  });

  controllers.proteinBuilder = createSequenceViewerProteinBuilderController({
    elements,
    state: options?.state,
    persist: options?.persist,
    createId: options?.createId,
    onNotebookEntriesChanged: options?.onNotebookEntriesChanged,
    getBridge: actions.getBridge,
    getStoragePath: actions.getStoragePath,
    getSelectedRecord: actions.getSelectedRecord,
    getSelectedFeature: () => getSelectedVisibleFeature(ctx),
    hasStoragePath: actions.hasStoragePath,
    setStatus: actions.setStatus,
    onNavigateHome: () => {
      actions.setProteinBuilderConfirmation(null, { render: false });
      controllers.home.navigateToHome();
    },
    onNavigateBuilder: actions.showProteinBuilderWorkspace,
    loadExternalRecord: actions.loadFromExternal
  });
}

function getSelectedVisibleFeature(ctx) {
  const record = ctx.actions.getSelectedRecord();
  if (!record || !Number.isFinite(ctx.state.selectedFeatureIndex) || ctx.state.selectedFeatureIndex < 0) {
    return null;
  }
  const visibleFeatures = ctx.controllers.detail?.getVisibleFeaturesForRecord?.(record) || [];
  return visibleFeatures[ctx.state.selectedFeatureIndex] || null;
}
