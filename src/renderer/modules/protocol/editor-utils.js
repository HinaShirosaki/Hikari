export function createProtocolEditorHelpers({
  ui,
  localState,
  draftHelpers
}) {
  function buildDraftFromEditorInputs() {
    const nowIso = new Date().toISOString();
    return {
      id: localState.currentProtocolDraft.id || null,
      name: String(ui.protocolNameInput?.value || '').trim(),
      purpose: String(ui.protocolPurposeInput?.value || '').trim(),
      materials: draftHelpers.parseBulletLines(ui.protocolMaterialsInput?.value || ''),
      steps: draftHelpers.buildStepEntriesFromText(
        ui.protocolStepsInput?.value || '',
        localState.currentProtocolDraft.steps
      ).map((entry) => draftHelpers.cloneStep(entry.step)),
      troubleshooting: String(ui.protocolTroubleshootingInput?.value || '').trim(),
      createdAt: draftHelpers.normalizeIsoTimestamp(localState.currentProtocolDraft.createdAt, nowIso),
      updatedAt: draftHelpers.normalizeIsoTimestamp(localState.currentProtocolDraft.updatedAt, localState.currentProtocolDraft.createdAt || nowIso)
    };
  }

  function ensureLeadingBullet(textarea) {
    if (!textarea) {
      return;
    }
    if (String(textarea.value || '').trim()) {
      return;
    }
    textarea.value = '• ';
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function normalizeBulletTextarea(textarea) {
    if (!textarea) {
      return;
    }
    const normalized = draftHelpers.parseBulletLines(textarea.value);
    textarea.value = normalized.length ? draftHelpers.formatBulletLines(normalized) : '';
  }

  function insertTextAtCursor(input, text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    input.value = `${before}${text}${after}`;
    const nextPos = start + text.length;
    input.setSelectionRange(nextPos, nextPos);
    input.focus();
  }

  function onBulletTextareaKeydown(event) {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    insertTextAtCursor(event.currentTarget, '\n• ');
  }

  function insertTokenAtCursor(input, token) {
    insertTextAtCursor(input, token);
  }

  return {
    buildDraftFromEditorInputs,
    ensureLeadingBullet,
    normalizeBulletTextarea,
    insertTextAtCursor,
    onBulletTextareaKeydown,
    insertTokenAtCursor
  };
}
