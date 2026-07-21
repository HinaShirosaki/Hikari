import { createSequenceViewerAgentApi } from './agent-api.js';

// Cross-module singleton connecting the main-process sequence_viewer / sequence_edit
// tools (which round-trip into the renderer) and the agent-chat approval overlay to
// the live sequence-viewer runtime. The sequence-viewer module registers its live
// accessors + apply callbacks on init; the overlay imports verifyAndApply.
// ponytail: module singleton, fine for the single viewer instance in one window.

let bridge = null;

export function registerSequenceViewerAgentBridge(accessors) {
  bridge = accessors && typeof accessors === 'object' ? accessors : null;
}

export function getSequenceViewerAgentBridge() {
  return bridge;
}

function buildApi() {
  return createSequenceViewerAgentApi({
    getRecords: bridge.getRecords,
    getSelectedIndex: bridge.getSelectedIndex,
    getActiveEntryId: bridge.getActiveEntryId,
    getCloningDesignSource: bridge.getCloningDesignSource
  });
}

function unavailable() {
  return { error: { code: 'VIEWER_UNAVAILABLE', message: 'The sequence viewer is not open. Ask the user to open it and load a record.' } };
}

// Runs one read/compute/propose action against live viewer state. Returns the
// agent-api result verbatim (data payload, structured { error }, or proposal).
export async function runSequenceAgentAction(action = '', args = {}) {
  if (!bridge) {
    return unavailable();
  }
  const api = buildApi();
  switch (String(action || '')) {
    case 'list_records': return api.listRecords();
    case 'get_record': return api.getRecord(args);
    case 'get_sequence': return api.getSequence(args);
    case 'get_features': return api.getFeatures(args);
    case 'analyze': return api.analyze(args);
    case 'design_cloning': return api.designCloning(args);
    case 'get_cloning_design': return api.getCloningDesign();
    case 'propose_edit': return api.proposeEdit(args);
    case 'propose_annotation': return api.proposeAnnotation(args);
    default:
      return { error: { code: 'UNKNOWN_ACTION', message: `Unknown sequence action "${action}".` } };
  }
}

// Approval-time apply. Re-verifies the proposal target against live state (never
// trusts the current selection), then delegates to the registered apply callback.
export async function verifyAndApplySequenceProposal(proposal = {}) {
  if (!bridge) {
    return unavailable();
  }
  const api = buildApi();
  const verified = api.verifyTarget(proposal?.target || {});
  if (verified.error) {
    return verified;
  }
  if (proposal?.kind === 'edit') {
    return bridge.applyEdit(verified.index, proposal.edit || {});
  }
  if (proposal?.kind === 'annotation') {
    return bridge.applyAnnotation(verified.index, proposal);
  }
  return { error: { code: 'UNKNOWN_PROPOSAL', message: 'The proposal is neither an edit nor an annotation.' } };
}
