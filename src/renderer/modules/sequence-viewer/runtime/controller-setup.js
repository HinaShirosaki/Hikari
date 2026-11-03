import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("dna");
import { createSequenceViewerAlignmentController } from '../alignment-controller.js';
import { createSequenceViewerAnnotationController } from '../annotation.js';
import { createSequenceViewerCloningDesignController } from '../cloning-design.js';
import { createPrimerOrderController } from '../primer-order-dialog.js';
import { createPrimerLibraryController } from '../primer-library.js';
import { createSequenceSamplePositionController } from '../sample-position.js';
import { createDnaFragmentDialog } from '../fragment-dialog.js';
import { createPcrPrimerPicker } from '../pcr-primer-picker.js';
import { createDnaDigestionController } from '../digestion-dialog.js';
import { createDnaAssemblyController } from '../assembly-picker.js';
import { getCommercialRestrictionFeaturesForRecord } from '../restriction-analysis.js';
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
  controllers.assembly = createDnaAssemblyController({
    rootDocument, getBridge: actions.getBridge, getStoragePath: actions.getStoragePath,
    getActiveInput: () => ({ entryId: state.activeEntryId, record: actions.getSelectedRecord() }),
    getEntryName: entryId => state.libraryEntries?.find(entry => entry.id === entryId)?.name || 'DNA',
    saveAssembly: actions.saveAssembledDna,
    beforeOpen: () => {
      controllers.digestion?.cancel();
      controllers.pcrPicker?.cancel();
      controllers.detail?.hideFeatureContextMenu();
      controllers.vectorBuilder?.hideOverlays();
      rootDocument?.querySelectorAll?.('[data-sequence-hover-tooltip]').forEach(node => { node.hidden = true; });
    }
  });
  rootDocument?.addEventListener('click', event => {
    if (event.target.closest?.('[data-sequence-assembly-current]')) {
      void controllers.assembly.open({ entryId: state.activeEntryId, record: actions.getSelectedRecord() });
    }
  });
  controllers.samplePosition = createSequenceSamplePositionController({
    rootDocument, appState: options?.state, persist: options?.persist, createId: options?.createId
  });
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
    getProjects: () => (Array.isArray(options?.state?.projects) ? options.state.projects : []),
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
    onRecognizeBackbone: actions.recognizeCurrentBackboneInsert,
    onAssembleDna: entryId => controllers.assembly.open({ entryId,
      record: entryId === state.activeEntryId ? actions.getSelectedRecord() : null }),
    onLibraryRendered: () => controllers.assembly.refreshHighlights(),
    onRecordSamplePosition: (entry) => controllers.samplePosition.openSequence(entry),
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

  controllers.primerOrder = createPrimerOrderController({
    rootDocument,
    elements,
    getBridge: actions.getBridge,
    setStatus: actions.setStatus
  });

  controllers.primerLibrary = createPrimerLibraryController({
    rootDocument, elements, appState: options?.state, persist: options?.persist,
    createId: options?.createId, getSelectedRecord: actions.getSelectedRecord,
    onRecordSamplePosition: (primer) => controllers.samplePosition.openPrimer(primer),
    onRequestPrimerOrder: (primers) => controllers.primerOrder?.open?.(primers)
  });

  controllers.fragments = createDnaFragmentDialog({
    rootDocument, getSelectedRecord: actions.getSelectedRecord,
    getEntryId: () => state.activeEntryId,
    saveFragment: actions.saveDerivedDnaFragment,
    onRequestPcrPartner: primer => controllers.pcrPicker.start(primer)
  });

  controllers.pcrPicker = createPcrPrimerPicker({
    rootDocument, elements, getSelectedRecord: actions.getSelectedRecord, getEntryId: () => state.activeEntryId,
    getFeatureFromEvent: event => {
      const index = Number(event.target?.closest?.('[data-feature-index]')?.dataset.featureIndex);
      return Number.isInteger(index) ? controllers.detail?.getVisibleFeaturesForRecord(actions.getSelectedRecord())[index] : null;
    },
    onBeginPicking: primer => {
      controllers.assembly?.close();
      controllers.digestion?.cancel();
      controllers.vectorBuilder?.hideOverlays();
      controllers.detail?.hideFeatureContextMenu();
      controllers.detail?.clearSequenceSelection();
      rootDocument?.querySelectorAll?.('[data-sequence-hover-tooltip]').forEach(node => { node.hidden = true; });
      state.showPrimers = true;
      state.alignmentViewEnabled = false;
      state.selectedFeatureIndex = controllers.detail?.getVisibleFeaturesForRecord(actions.getSelectedRecord()).indexOf(primer) ?? -1;
      controllers.home?.setLocalWorkspaceVisibility('detail');
      onNavigateDetail?.();
      controllers.detail?.renderActiveRecord({ preserveScroll: true });
    },
    onPairSelected: (primer, partner) => controllers.fragments.open({ primer, partner })
  });

  controllers.digestion = createDnaDigestionController({
    rootDocument, getSelectedRecord: actions.getSelectedRecord, getEntryId: () => state.activeEntryId,
    getSites: () => getCommercialRestrictionFeaturesForRecord(actions.getSelectedRecord(), { vendorFilter: state.restrictionVendorFilter }),
    getFeatureFromEvent: event => {
      const surface = event.target?.closest?.('[data-feature-index]');
      const index = Number(surface?.dataset.featureIndex);
      if (!surface || !Number.isInteger(index)) return null;
      if (elements.vectorBuilderMap?.contains(surface) || elements.vectorBuilderSequence?.contains(surface)) {
        return controllers.vectorBuilder?.getFeatureByIndex(actions.getSelectedRecord(), index);
      }
      if (elements.sequenceHost?.contains(surface) || elements.featureRailHost?.contains(surface)) {
        return controllers.detail?.getVisibleFeaturesForRecord(actions.getSelectedRecord())[index];
      }
      return null;
    },
    hideMenus: () => {
      controllers.assembly?.close();
      controllers.detail?.hideFeatureContextMenu();
      if (elements.vectorBuilderContextMenu) elements.vectorBuilderContextMenu.hidden = true;
      rootDocument?.querySelectorAll?.('[data-sequence-hover-tooltip]').forEach(node => { node.hidden = true; });
    },
    saveFragments: actions.saveDerivedDnaFragments, setStatus: actions.setStatus
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
    onSaveDnaFragment: (range, feature) => controllers.fragments.open({ range, feature }),
    onFeaturesRendered: () => controllers.pcrPicker?.refreshHighlights(),
    onRequestAnnotate: () => controllers.annotation?.annotateCurrentRecord?.(),
    onApplySequenceEdit: actions.applySequenceEdit,
    onApplyAminoAcidEdit: actions.applyAminoAcidEdit,
    onSetSequenceOrigin: actions.setSequenceOrigin,
    onRequestAlignment: () => controllers.alignment?.openSequencingAlignmentWorkspace?.(),
    onRequestCloningDesign: () => controllers.cloningDesign?.open?.(),
    hasCloningDesignSource: actions.hasCurrentCloningDesignSource,
    onRequestPrimerOrder: (primers) => controllers.primerOrder?.open?.(primers),
    onSavePrimersToLibrary: (primers) => controllers.primerLibrary?.save?.(primers, actions.getSelectedRecord()?.name || ''),
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
    onAlignmentStateChange: (options) => controllers.detail?.renderActiveRecord?.({
      preserveScroll: Boolean(options?.preserveScroll)
    }),
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
    ensureProjectRecord: options?.ensureProjectRecord,
    saveProtocolRecord: options?.saveProtocolRecord,
    onNotebookEntriesChanged: options?.onNotebookEntriesChanged,
    getSelectedRecord: actions.getSelectedRecord,
    getCloningDesignSource: () => state.sequenceEditDesignSource,
    getBridge: actions.getBridge,
    getStoragePath: actions.getStoragePath,
    setStatus: actions.setStatus,
    persistFeatureMutation: actions.persistFeatureMutation,
    onRequestPrimerOrder: (primers) => controllers.primerOrder?.open?.(primers),
    onSavePrimersToLibrary: (primers) => controllers.primerLibrary?.save?.(primers, actions.getSelectedRecord()?.name || ''),
    onNavigateCloningDesign: actions.showCloningDesignWorkspace,
    onReturnToDetail: actions.returnToSequenceDetailFromCloningDesign,
    // The confirmed product becomes the record the viewer is editing, so later
    // saves update it instead of allocating yet another entry.
    onDesignConfirmed: async (result) => {
      const entry = result?.productEntry;
      if (!entry?.id) {
        return;
      }
      state.activeEntryId = String(entry.id);
      state.activeEntryStatus = String(entry.status || '').toLowerCase();
      await controllers.home?.refreshLibraryEntries({
        selectedId: entry.id,
        filter: entry.status,
        silent: true
      });
      controllers.detail?.updateRecordSelect?.();
      controllers.detail?.renderActiveRecord?.({ preserveScroll: true });
    }
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
    onSaveDnaFragment: (range, feature) => controllers.fragments.open({ range, feature }),
    onRequestProteinInsert: (target) => {
      actions.showProteinBuilderWorkspace();
      controllers.proteinBuilder?.render?.();
      actions.setStatus((((((target ? i18nUi.text("Compose the construct, then use Insert Into Vector to splice it into the open plasmid.") : i18nUi.text("Compose the construct, then assemble it into a stored backbone.")))))));
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
    getSelectedEntryId: () => state.activeEntryId,
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
