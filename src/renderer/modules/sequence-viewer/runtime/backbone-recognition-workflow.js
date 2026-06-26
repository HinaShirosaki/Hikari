import {
  cleanText,
  clamp
} from '../shared.js';
import {
  LIBRARY_STATUS_TEMPORARY,
  RECOGNIZED_BACKBONE_ARTIFACT_FOLDER
} from './config.js';
import {
  buildRecognizedBackboneArtifact,
  getRecognitionDisplayMatch,
  removeBackboneRecognitionFeatures
} from './backbone-recognition-model.js';
export function createBackboneRecognitionWorkflow(ctx) {
  const { state, actions, controllers, dialogs } = ctx;
  async function persistRecognizedBackboneArtifact(match, record, selection = {}) {
    const bridge = actions.getBridge();
    const storagePath = actions.getStoragePath();
    if (!storagePath || (!bridge?.sequenceLibraryUpsertBackbone && !bridge?.writeJsonFile)) {
      return null;
    }
    const artifact = buildRecognizedBackboneArtifact({ match, record, selection, state });
    if (!artifact) {
      return null;
    }
    const response = bridge?.sequenceLibraryUpsertBackbone
      ? await bridge.sequenceLibraryUpsertBackbone({ storagePath, backbone: artifact.data })
      : await bridge.writeJsonFile({
          storagePath,
          targetFolder: RECOGNIZED_BACKBONE_ARTIFACT_FOLDER,
          fileName: artifact.fileName,
          data: artifact.data
        });
    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to store recognized backbone.');
    }
    return response;
  }
  async function applyBackboneRecognitionSelection() {
    const dialogState = state.backboneRecognitionDialog || {};
    const match = dialogState.match;
    if (!dialogState.open || !match) {
      return;
    }
    const recordIndex = clamp(dialogState.recordIndex, 0, Math.max(0, state.records.length - 1));
    const nextRecords = [...state.records];
    const current = nextRecords[recordIndex];
    if (!current?.sequence?.length) {
      dialogs.closeBackboneRecognitionDialog();
      actions.setStatus('Selected record no longer exists.', true);
      return;
    }
    const removedRecognitionFeatures = removeExistingRecognitionFeatures(current, nextRecords);
    controllers.detail?.hideFeatureContextMenu();
    controllers.detail?.hideFeatureEditor();
    controllers.detail?.hidePrimerDesignOverlay?.();
    dialogs.closeBackboneRecognitionDialog();
    if (removedRecognitionFeatures) {
      controllers.detail?.clearSequenceSelection();
      controllers.detail?.renderActiveRecord();
    }
    const displayMatch = getRecognitionDisplayMatch(match, {
      candidateId: dialogState.candidateId,
      variantMode: dialogState.variantMode
    });
    const result = await persistBackboneSelectionEffects({
      match,
      current,
      displayMatch,
      dialogState,
      removedRecognitionFeatures
    });
    actions.setStatus(buildSelectionStatus(displayMatch, dialogState.variantMode, removedRecognitionFeatures, result));
  }
  async function recognizeCurrentBackboneInsert() {
    if (state.isRecognizingBackbone) {
      return;
    }
    const record = actions.getSelectedRecord();
    if (!record?.sequence?.length) {
      actions.setStatus('Load a record before backbone recognition.', true);
      return;
    }
    if (!actions.getStoragePath()) {
      actions.setStatus('Set Storage Folder Path in Settings before recognizing vector backbone.', true);
      return;
    }
    const bridge = actions.getBridge();
    if (!bridge?.sequenceLibraryRecognizeBackbone) {
      actions.setStatus('Backbone recognition API unavailable.', true);
      return;
    }
    state.isRecognizingBackbone = true;
    controllers.detail?.syncActionButtonsState();
    actions.setStatus(`Recognizing vector backbone for ${record.name || 'record'}...`);
    try {
      await runBackboneRecognitionRequest({ bridge, record });
    } catch (error) {
      actions.setStatus(error?.message || 'Backbone recognition failed.', true);
    } finally {
      state.isRecognizingBackbone = false;
      controllers.detail?.syncActionButtonsState();
    }
  }
  return {
    applyBackboneRecognitionSelection,
    persistRecognizedBackboneArtifact,
    recognizeCurrentBackboneInsert
  };
  function removeExistingRecognitionFeatures(current, nextRecords) {
    const previousFeatures = Array.isArray(current.features) ? current.features : [];
    const retainedFeatures = removeBackboneRecognitionFeatures(previousFeatures);
    if (retainedFeatures.length === previousFeatures.length) {
      return false;
    }
    current.features = retainedFeatures;
    state.records = nextRecords;
    state.selectedFeatureIndex = -1;
    return true;
  }
  async function runBackboneRecognitionRequest({ bridge, record }) {
    const response = await bridge.sequenceLibraryRecognizeBackbone({
      storagePath: actions.getStoragePath(),
      sequence: record.sequence,
      excludeEntryId: state.activeEntryId
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'Backbone recognition failed.');
    }
    const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
    const current = state.records[selectedIndex];
    if (!current) {
      throw new Error('Selected record no longer exists.');
    }
    if (!response.match) {
      await clearRecognitionFeaturesWhenNoMatch(current, selectedIndex);
      return;
    }
    dialogs.openBackboneRecognitionDialog(response.match, selectedIndex);
    actions.setStatus('Backbone recognized. Review promoter / ORF candidates before applying.');
  }
  async function clearRecognitionFeaturesWhenNoMatch(current, selectedIndex) {
    const nextRecords = [...state.records];
    const hadRecognitionFeatures = removeExistingRecognitionFeatures(current, nextRecords);
    nextRecords[selectedIndex] = current;
    controllers.detail?.clearSequenceSelection();
    controllers.detail?.hideFeatureContextMenu();
    controllers.detail?.hideFeatureEditor();
    controllers.detail?.hidePrimerDesignOverlay?.();
    controllers.detail?.renderActiveRecord();
    if (hadRecognitionFeatures && state.activeEntryId) {
      await actions.persistFeatureMutation(current, 'Cleared auto-detected backbone/insert features.');
    }
    actions.setStatus('No backbone candidate was recognized from promoter alignment.');
  }
  async function persistBackboneSelectionEffects({ match, current, displayMatch, dialogState, removedRecognitionFeatures }) {
    const result = { artifactStored: false, artifactError: '', sequenceCleanupSaved: false, sequenceCleanupError: '' };
    try {
      const artifactResult = await persistRecognizedBackboneArtifact(match, current, {
        candidateId: dialogState.candidateId,
        variantMode: dialogState.variantMode
      });
      result.artifactStored = Boolean(artifactResult?.ok || artifactResult?.filePath);
    } catch (error) {
      result.artifactError = error?.message || 'Failed to store Protein Builder backbone file.';
    }
    if (removedRecognitionFeatures && state.activeEntryId) {
      try {
        const entry = await actions.persistRecordToLibrary(current, {
          id: state.activeEntryId,
          status: state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
          name: current.name || 'sequence'
        });
        await controllers.home?.refreshLibraryEntries({ selectedId: entry.id, filter: entry.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY, silent: true });
        result.sequenceCleanupSaved = true;
      } catch (error) {
        result.sequenceCleanupError = error?.message || 'Failed to update stored sequence.';
      }
    }
    return result;
  }
}
function buildSelectionStatus(displayMatch, variantMode, removedRecognitionFeatures, result) {
  const matchedHostName = cleanText(displayMatch?.hostVectorName, 140) || 'vector';
  const promoterDriven = String(displayMatch?.recognitionSource || '').toLowerCase() === 'promoter_alignment';
  const insertLength = Math.max(0, Number(displayMatch?.insertLength) || 0);
  const summary = insertLength > 0
    ? `${promoterDriven ? 'Recognized a promoter-aligned backbone' : `Recognized ${matchedHostName} backbone`} with a ${insertLength.toLocaleString()} bp ${variantMode === 'restriction' ? 'restriction-bounded' : 'Gibson/HR'} insert.`
    : `${promoterDriven ? 'Recognized a promoter-aligned backbone.' : `Recognized ${matchedHostName} backbone.`}`;
  const artifactMessage = result.artifactStored ? ' Stored a Protein Builder backbone selection.' : (result.artifactError ? ` ${result.artifactError}` : '');
  const sequenceMessage = removedRecognitionFeatures
    ? (result.sequenceCleanupSaved ? ' Removed backbone/insert annotations from the original sequence.' : (result.sequenceCleanupError ? ` Could not remove existing backbone/insert annotations from the original sequence: ${result.sequenceCleanupError}` : ' Removed local backbone/insert annotations from the original sequence.'))
    : ' The original sequence was left unchanged.';
  return `${summary}${artifactMessage}${sequenceMessage}`;
}
