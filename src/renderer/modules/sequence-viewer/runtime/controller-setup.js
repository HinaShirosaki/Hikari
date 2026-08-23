import { createSequenceViewerAlignmentController } from '../alignment-controller.js';
import { createSequenceViewerAnnotationController } from '../annotation.js';
import { createSequenceViewerCloningDesignController } from '../cloning-design.js';
import { createSequenceViewerDetailController } from '../detail-controller.js';
import { createSequenceViewerHomeController } from '../home-controller.js';
import { createSequenceViewerProteinBuilderController } from '../protein-builder.js';
import { createSequenceViewerVectorBuilderController } from '../vector-builder/controller.js';
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
    setMode: actions.setMode,
    setInputComposerVisible: actions.setInputComposerVisible,
    setRecords: actions.setRecords,
    setStatus: actions.setStatus,
    readFileAsText: actions.readFileAsText,
    readFileAsArrayBuffer: actions.readFileAsArrayBuffer,
    pluginServices: options?.pluginServices || null,
    onParsedRecordsOpened: actions.maybePersistImportedGenbankRecord,
    onRenameLibraryEntry: actions.renameLibraryEntry,
    onCreateLibraryFolder: (name) => actions.upsertLibraryFolder('', name),
    onRenameLibraryFolder: actions.upsertLibraryFolder,
    onDeleteLibraryFolder: actions.deleteLibraryFolder,
    onMoveLibraryEntry: actions.moveLibraryEntryToFolder,
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
    onRequestSave: actions.saveCurrentRecordToLibrary,
    onRequestAnnotate: () => controllers.annotation?.annotateCurrentRecord?.(),
    onRequestRecognizeBackbone: actions.recognizeCurrentBackboneInsert,
    onApplySequenceEdit: actions.applySequenceEdit,
    onApplyAminoAcidEdit: actions.applyAminoAcidEdit,
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
    appState: options?.state,
    persist: options?.persist,
    createId: options?.createId,
    onNotebookEntriesChanged: options?.onNotebookEntriesChanged,
    getSelectedRecord: actions.getSelectedRecord,
    getCloningDesignSource: () => state.sequenceEditDesignSource,
    setStatus: actions.setStatus,
    persistFeatureMutation: actions.persistFeatureMutation,
    onNavigateCloningDesign: actions.showCloningDesignWorkspace,
    onReturnToDetail: actions.returnToSequenceDetailFromCloningDesign
  });

  controllers.vectorBuilder = createSequenceViewerVectorBuilderController({
    rootDocument,
    elements,
    state,
    getSelectedRecord: actions.getSelectedRecord,
    getBridge: actions.getBridge,
    getStoragePath: actions.getStoragePath,
    setStatus: actions.setStatus,
    persistFeatureMutation: actions.persistFeatureMutation,
    onApplySequenceEdit: actions.applySequenceEdit,
    onNavigateVectorBuilder: actions.showVectorBuilderWorkspace,
    onReturnToDetail: actions.returnToSequenceDetailFromVectorBuilder,
    onRequestCloningDesign: () => controllers.cloningDesign?.open?.(),
    onRequestPrimerDesign: async (context) => {
      await controllers.detail?.openPrimerDesignOverlay?.(context);
      controllers.vectorBuilder?.render?.();
    },
    onRequestProteinInsert: (target) => {
      actions.showProteinBuilderWorkspace();
      controllers.proteinBuilder?.render?.();
      actions.setStatus(target
        ? 'Compose the construct, then use Insert Into Vector to splice it into the open plasmid.'
        : 'Compose the construct, then assemble it into a stored backbone.');
    }
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
    loadExternalRecord: actions.loadFromExternal,
    getVectorInsertTarget: () => controllers.vectorBuilder?.getInsertTarget?.() || null,
    onInsertIntoVector: async (payload) => await controllers.vectorBuilder?.applyProteinConstruct?.(payload),
    onCancelVectorInsert: () => {
      controllers.vectorBuilder?.clearInsertTarget?.();
      controllers.proteinBuilder?.render?.();
    }
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
