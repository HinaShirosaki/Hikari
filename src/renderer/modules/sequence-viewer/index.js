import { installSequenceMcpActions } from './runtime/mcp-actions.js';
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
    proteinBuilder: null,
    vectorBuilder: null
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
  initializeSequenceViewerRuntime(ctx);
  const mcpActions = installSequenceMcpActions(ctx);

  return {
    openAgentResult: mcpActions.openAction,
    render: actions.render,
    loadFromExternal: actions.loadFromExternal,
    openSequencingAlignmentWorkspace: () => controllers.alignment?.openSequencingAlignmentWorkspace?.(),
    closeSequencingAlignmentWorkspace: () => controllers.alignment?.closeSequencingAlignmentWorkspace?.(),
    loadSequencingAlignmentReference: async (input) => await controllers.alignment?.loadSequencingAlignmentReference?.(input),
    loadSequencingAlignmentQuery: async (input) => await controllers.alignment?.loadSequencingAlignmentQuery?.(input),
    runSequencingAlignment: async () => await controllers.alignment?.runSequencingAlignment?.()
  };
}

function initializeSequenceViewerRuntime(ctx) {
  ctx.actions.setMode('paste');
  ctx.actions.setInputComposerVisible(true);
  ctx.actions.setStatus('');
  ctx.controllers.home.setHomeStatus('');
  ctx.actions.render();
}
