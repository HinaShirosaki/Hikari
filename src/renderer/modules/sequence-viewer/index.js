import { getSequenceViewerElements } from './dom.js';
import { createInitialSequenceViewerState } from './runtime/config.js';
import { createSequenceViewerCoreActions } from './runtime/core-actions.js';
import { createAlignmentStateActions } from './runtime/alignment-state.js';
import { createProteinBuilderConfirmationActions } from './runtime/protein-builder-confirmation.js';
import { createBackboneDialogRenderer } from './runtime/backbone-dialog-renderer.js';
import { createBackboneRecognitionWorkflow } from './runtime/backbone-recognition-workflow.js';
import { createLibraryPersistenceActions } from './runtime/library-persistence.js';
import { createSequenceEditActions } from './runtime/sequence-edit-workflow.js';
import { createRecordWorkflowActions } from './runtime/record-workflow.js';
import { createNavigationActions } from './runtime/navigation-workflow.js';
import { setupSequenceViewerControllers } from './runtime/controller-setup.js';
import { bindSequenceViewerRuntimeEvents } from './runtime/event-bindings.js';
import { registerSequenceViewerAgentBridge, runSequenceAgentAction } from './agent/bridge.js';

export function initSequenceViewer(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;
  const elements = getSequenceViewerElements(rootDocument);
  const state = createInitialSequenceViewerState();
  const controllers = {
    home: null,
    detail: null,
    annotation: null,
    alignment: null,
    cloningDesign: null,
    proteinBuilder: null
  };
  const actions = {};
  const dialogs = {};
  const ctx = {
    actions,
    controllers,
    dialogs,
    elements,
    homeViewId: String(options?.homeViewId || '').trim(),
    detailViewId: String(options?.detailViewId || '').trim(),
    onNavigateHome: typeof options?.onNavigateHome === 'function' ? options.onNavigateHome : null,
    onNavigateDetail: typeof options?.onNavigateDetail === 'function' ? options.onNavigateDetail : null,
    options,
    rootDocument,
    state
  };

  Object.assign(actions, createSequenceViewerCoreActions({ options, elements, state }));
  Object.assign(actions, createAlignmentStateActions(ctx));
  Object.assign(actions, createProteinBuilderConfirmationActions(ctx));
  Object.assign(dialogs, createBackboneDialogRenderer(ctx));
  Object.assign(actions, createLibraryPersistenceActions(ctx));
  Object.assign(actions, createNavigationActions(ctx));
  Object.assign(actions, createRecordWorkflowActions(ctx));
  Object.assign(actions, createSequenceEditActions(ctx));
  Object.assign(actions, createBackboneRecognitionWorkflow(ctx));

  setupSequenceViewerControllers(ctx);
  bindSequenceViewerRuntimeEvents(ctx);
  registerSequenceViewerAgentBridgeForCtx(ctx);
  initializeSequenceViewerRuntime(ctx);

  return {
    render: actions.render,
    loadFromExternal: actions.loadFromExternal,
    openSequencingAlignmentWorkspace: () => controllers.alignment?.openSequencingAlignmentWorkspace?.(),
    closeSequencingAlignmentWorkspace: () => controllers.alignment?.closeSequencingAlignmentWorkspace?.(),
    loadSequencingAlignmentReference: async (input) => await controllers.alignment?.loadSequencingAlignmentReference?.(input),
    loadSequencingAlignmentQuery: async (input) => await controllers.alignment?.loadSequencingAlignmentQuery?.(input),
    runSequencingAlignment: async () => await controllers.alignment?.runSequencingAlignment?.()
  };
}

// Convert a 1-based inclusive agent segment to the record's 0-based half-open form.
function toStoredSegment(segment = {}) {
  const start = Math.max(0, Math.round(Number(segment?.start) || 0) - 1);
  const end = Math.max(start, Math.round(Number(segment?.end) || 0));
  return { start, end };
}

function findFeatureIndexByRef(features, ref = {}) {
  return features.findIndex((feature, index) => (
    (ref?.id && feature?.id === ref.id)
    || (Number.isFinite(Number(ref?.index)) && Number(ref.index) === index)
    || (ref?.name && feature?.name === ref.name)
  ));
}

// Bind the agent bridge to live sequence-viewer state and subscribe to
// main-process round-trip requests. Reads/computes run through the bridge; edit
// and annotation proposals are applied only from the approval overlay via the
// applyEdit / applyAnnotation callbacks registered here.
function registerSequenceViewerAgentBridgeForCtx(ctx) {
  const { actions, controllers, options, state } = ctx;
  const createId = typeof options?.createId === 'function'
    ? options.createId
    : (() => `agent_feature_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`);

  async function applyEdit(index, editRequest = {}) {
    state.selectedRecordIndex = index; // re-select the verified target before applying
    const mode = editRequest.mode === 'delete' ? 'delete' : (editRequest.mode === 'replace' ? 'replace' : 'insert');
    const start = Math.round(Number(editRequest.start) || 0);
    const end = mode === 'insert' ? start : Math.round(Number(editRequest.end) || start);
    try {
      await actions.applySequenceEdit({
        mode,
        range: { start: Math.max(0, start - 1), end: Math.max(0, mode === 'insert' ? start - 1 : end) },
        sequence: mode === 'delete' ? '' : String(editRequest.sequence || '')
      });
      return { ok: true, applied: true, summary: `Applied ${mode} at ${start}.` };
    } catch (error) {
      return { error: { code: 'APPLY_FAILED', message: String(error?.message || error) } };
    }
  }

  async function applyAnnotation(index, proposal = {}) {
    state.selectedRecordIndex = index;
    const records = Array.isArray(state.records) ? [...state.records] : [];
    const record = records[index];
    if (!record) {
      return { error: { code: 'TARGET_NOT_FOUND', message: 'The annotation target record is no longer loaded.' } };
    }
    const features = Array.isArray(record.features) ? [...record.features] : [];
    const feature = proposal.feature || {};
    const mode = proposal.mode;
    let label = '';
    if (mode === 'add') {
      features.push({
        id: createId(),
        name: feature.name || 'feature',
        type: feature.type || 'misc_feature',
        strand: Number(feature.strand) || 0,
        description: feature.description || '',
        source: 'agent',
        locationText: '',
        segments: (Array.isArray(feature.segments) ? feature.segments : []).map(toStoredSegment)
      });
      label = `Added feature ${feature.name || 'feature'}.`;
    } else {
      const targetIndex = findFeatureIndexByRef(features, proposal.featureRef || {});
      if (targetIndex < 0) {
        return { error: { code: 'AMBIGUOUS_FEATURE', message: 'The referenced feature is no longer resolvable.' } };
      }
      if (mode === 'delete') {
        const [removed] = features.splice(targetIndex, 1);
        label = `Deleted feature ${removed?.name || 'feature'}.`;
      } else {
        features[targetIndex] = {
          ...features[targetIndex],
          name: feature.name || features[targetIndex].name,
          type: feature.type || features[targetIndex].type,
          strand: Number(feature.strand) || 0,
          description: feature.description || '',
          segments: (Array.isArray(feature.segments) ? feature.segments : []).map(toStoredSegment)
        };
        label = `Updated feature ${feature.name || features[targetIndex].name}.`;
      }
    }
    const nextRecord = { ...record, features };
    records[index] = nextRecord;
    state.records = records;
    state.selectedFeatureIndex = -1;
    controllers.detail?.renderActiveRecord?.();
    try {
      await actions.persistFeatureMutation(nextRecord, label);
      return { ok: true, applied: true, summary: label };
    } catch (error) {
      return { error: { code: 'APPLY_FAILED', message: String(error?.message || error) } };
    }
  }

  registerSequenceViewerAgentBridge({
    getRecords: () => state.records,
    getSelectedIndex: () => state.selectedRecordIndex,
    getActiveEntryId: () => state.activeEntryId,
    getCloningDesignSource: () => state.sequenceEditDesignSource,
    applyEdit,
    applyAnnotation
  });

  const bridge = actions.getBridge?.();
  if (bridge && typeof bridge.onSequenceAgentRequest === 'function') {
    bridge.onSequenceAgentRequest((payload = {}) => runSequenceAgentAction(payload.action, payload.args));
  }
}

function initializeSequenceViewerRuntime(ctx) {
  ctx.actions.setMode('paste');
  ctx.actions.setInputComposerVisible(true);
  ctx.actions.setStatus('Paste sequence text, then click Load.');
  ctx.controllers.home.setHomeStatus('');
  ctx.actions.render();
}
