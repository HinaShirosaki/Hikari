import {
  buildEditedProtocolSnapshot,
  formatProtocolStepsForEditor
} from './protocol-text.js';
import { normalizeNotebookState } from '../entry/entry-helpers.js';

export function createProtocolSnapshotEditor({
  protocolArea,
  editorEl,
  stepsHost,
  editBtn,
  applyBtn,
  cancelBtn,
  exportBtn,
  printBtn,
  markExecutedBtn,
  takeIntoPlanBtn,
  draftNameInput,
  draftStepsInput,
  createId
} = {}) {
  let viewerProtocolDraft = null;
  let isEditing = false;

  function getDraft() {
    return viewerProtocolDraft;
  }

  function setDraft(protocol) {
    viewerProtocolDraft = protocol;
  }

  function isCurrentlyEditing() {
    return isEditing;
  }

  function setEditing(value) {
    isEditing = Boolean(value);
  }

  function clearDraft({ preserveDraft = false } = {}) {
    isEditing = false;
    if (!preserveDraft) {
      viewerProtocolDraft = null;
    }
    if (draftNameInput) {
      draftNameInput.value = '';
    }
    if (draftStepsInput) {
      draftStepsInput.value = '';
    }
  }

  function syncControls(protocol = null, entry = null) {
    const hasProtocol = Boolean(protocol) && !protocolArea?.hidden;

    if (editorEl) {
      editorEl.hidden = !hasProtocol || !isEditing;
    }
    if (stepsHost) {
      stepsHost.hidden = Boolean(hasProtocol && isEditing);
    }
    if (editBtn) {
      editBtn.hidden = !hasProtocol || isEditing;
    }
    if (applyBtn) {
      applyBtn.hidden = !hasProtocol || !isEditing;
    }
    if (cancelBtn) {
      cancelBtn.hidden = !hasProtocol || !isEditing;
    }
    if (exportBtn) {
      exportBtn.hidden = !entry || isEditing;
    }
    if (printBtn) {
      printBtn.hidden = !entry || isEditing;
    }
    if (takeIntoPlanBtn) {
      takeIntoPlanBtn.hidden = !entry || normalizeNotebookState(entry.notebookState) !== 'suggested' || isEditing;
    }
    if (markExecutedBtn) {
      markExecutedBtn.hidden = !entry
        || normalizeNotebookState(entry?.notebookState) !== 'planned'
        || isEditing;
    }
  }

  function beginEdit(protocol) {
    if (!protocol) {
      return false;
    }
    viewerProtocolDraft = protocol;
    if (draftNameInput) {
      draftNameInput.value = protocol.name;
    }
    if (draftStepsInput) {
      draftStepsInput.value = formatProtocolStepsForEditor(protocol);
    }
    isEditing = true;
    return true;
  }

  function cancelEdit() {
    isEditing = false;
  }

  function buildSnapshot(baseProtocol) {
    return buildEditedProtocolSnapshot({
      baseProtocol,
      draftName: draftNameInput?.value || '',
      draftStepsText: draftStepsInput?.value || '',
      createId
    });
  }

  return {
    getDraft,
    setDraft,
    isEditing: isCurrentlyEditing,
    setEditing,
    clearDraft,
    syncControls,
    beginEdit,
    cancelEdit,
    buildSnapshot
  };
}
