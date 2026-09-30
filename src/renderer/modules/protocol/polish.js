import { showTransientNotice } from '../../lib/notify.js';

function formatProtocolPolishTextBlock(value, fallback = '[blank]') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function formatProtocolPolishList(items, { numbered = false, emptyLabel = '[none provided]' } = {}) {
  if (!Array.isArray(items) || !items.length) {
    return emptyLabel;
  }

  return items
    .map((item, index) => {
      const normalized = String(item || '').trim() || '[blank]';
      return numbered ? `${index + 1}. ${normalized}` : `- ${normalized}`;
    })
    .join('\n');
}

function buildProtocolPolishSourceText(draft, { normalizeMaterials, stepToEditableLine }) {
  const materials = normalizeMaterials(draft?.materials);
  const steps = Array.isArray(draft?.steps)
    ? draft.steps
      .map((step) => String(stepToEditableLine(step) || '').trim())
      .filter(Boolean)
    : [];

  return [
    'Name:',
    formatProtocolPolishTextBlock(draft?.name),
    '',
    'Purpose:',
    formatProtocolPolishTextBlock(draft?.purpose),
    '',
    'Materials:',
    formatProtocolPolishList(materials),
    '',
    'Steps:',
    formatProtocolPolishList(steps, { numbered: true }),
    '',
    'Troubleshooting:',
    formatProtocolPolishTextBlock(draft?.troubleshooting, '[none provided]')
  ].join('\n');
}

export function createProtocolPolishController({
  state,
  ui,
  localState,
  requestLlmText,
  parseJsonFromText,
  cloneDraftFromProtocol,
  sanitizeIncomingProtocol,
  normalizeMaterials,
  stepToEditableLine,
  renderProtocolPreviewInto,
  renderProtocolPolishEmptyState,
  renderProtocolPolishLoadingState,
  populateEditorFormFromDraft,
  buildDraftFromEditorInputs
}) {
  function setProtocolPolishPendingState(nextPending) {
    localState.isProtocolPolishPending = nextPending === true;
    if (ui.protocolPolishBtn) {
      ui.protocolPolishBtn.disabled = localState.isProtocolPolishPending;
      ui.protocolPolishBtn.textContent = localState.isProtocolPolishPending ? 'Polishing...' : 'Polish Protocol';
    }
    if (ui.protocolPolishApplyBtn) {
      ui.protocolPolishApplyBtn.disabled = localState.isProtocolPolishPending || !localState.polishedProtocolDraft;
    }
  }

  function setProtocolPolishStatus(message = '', options = {}) {
    if (options.state === 'error' && message) {
      showTransientNotice(message, { type: 'error' });
    }
    if (!ui.protocolPolishStatus) {
      return;
    }

    const normalized = String(message || '').trim();
    const stateLabel = String(options.state || '').trim();
    ui.protocolPolishStatus.textContent = normalized;
    ui.protocolPolishStatus.hidden = !normalized;

    if (stateLabel) {
      ui.protocolPolishStatus.dataset.state = stateLabel;
    } else {
      delete ui.protocolPolishStatus.dataset.state;
    }
  }

  function resetProtocolPolishState() {
    localState.polishedProtocolDraft = null;
    localState.protocolPolishSourceDraft = null;
    setProtocolPolishPendingState(false);
    setProtocolPolishStatus('');

    if (ui.protocolPolishOriginalPreview) {
      ui.protocolPolishOriginalPreview.innerHTML = '';
    }
    if (ui.protocolPolishResultPreview) {
      ui.protocolPolishResultPreview.innerHTML = '';
    }
  }

  function closeProtocolPolishOverlay() {
    localState.protocolPolishRequestToken += 1;
    if (ui.protocolPolishOverlay) {
      ui.protocolPolishOverlay.hidden = true;
    }
    resetProtocolPolishState();
  }

  function hasDraftContent(draft) {
    return Boolean(
      String(draft?.name || '').trim()
      || String(draft?.purpose || '').trim()
      || String(draft?.troubleshooting || '').trim()
      || normalizeMaterials(draft?.materials).length
      || (Array.isArray(draft?.steps) ? draft.steps.length : 0)
    );
  }

  function buildProtocolPolishPrompt(draft) {
    return [
      'You are polishing a lab protocol draft for readability.',
      'Rewrite the protocol so it reads like a clean, professional lab SOP.',
      'Actively improve grammar, clarity, specificity of phrasing, consistency, and flow while preserving the exact protocol structure.',
      'Do not merely copy the input with tiny edits. If a field is non-empty, rewrite it into stronger lab-ready wording unless it is already near-optimal.',
      'Keep the same five fields: name, purpose, materials, steps, troubleshooting.',
      'Use concise scientific language, imperative action verbs for steps, and consistent terminology across the whole protocol.',
      'Keep the same scientific meaning, placeholder markers like [volume] and [temperature], and the step order unless a wording-only cleanup requires tiny local rephrasing.',
      'If the name is blank, create a concise protocol name from the existing content.',
      'Do not invent measurements, times, temperatures, reagents, troubleshooting details, or conclusions that are not already present.',
      'Do not add or remove major procedural content. This is a polish pass, not a redesign.',
      'Materials should stay as short clean item strings. Steps should be rewritten as clear operational instructions.',
      'Troubleshooting should read like polished bench guidance, but only using issues and fixes already present in the draft.',
      'The source draft will be provided as plain-text sections instead of JSON so you can rewrite more naturally.',
      'Return JSON only with this exact shape:',
      '{"name":"","purpose":"","materials":[""],"steps":[""],"troubleshooting":""}',
      '',
      'Protocol draft to polish (plain-text sections):',
      buildProtocolPolishSourceText(draft, { normalizeMaterials, stepToEditableLine })
    ].join('\n');
  }

  function resolvePolishedProtocolPayload(parsed) {
    if (Array.isArray(parsed)) {
      return parsed[0] || null;
    }
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (Array.isArray(parsed.protocols) && parsed.protocols.length) {
      return parsed.protocols[0];
    }
    if (parsed.protocol && typeof parsed.protocol === 'object') {
      return parsed.protocol;
    }
    if (parsed.polishedProtocol && typeof parsed.polishedProtocol === 'object') {
      return parsed.polishedProtocol;
    }
    if (parsed.polished_protocol && typeof parsed.polished_protocol === 'object') {
      return parsed.polished_protocol;
    }
    return parsed;
  }

  function normalizePolishedProtocolResponse(rawText, sourceDraft) {
    const parsed = parseJsonFromText(rawText);
    const candidate = resolvePolishedProtocolPayload(parsed);
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const mergedCandidate = {
      id: sourceDraft?.id || null,
      name: String(candidate.name || candidate.title || sourceDraft?.name || 'Protocol Draft').trim(),
      purpose: Object.prototype.hasOwnProperty.call(candidate, 'purpose')
        ? candidate.purpose
        : sourceDraft?.purpose,
      materials: Object.prototype.hasOwnProperty.call(candidate, 'materials')
        ? candidate.materials
        : sourceDraft?.materials,
      steps: Array.isArray(candidate.steps)
        ? candidate.steps
        : (Array.isArray(candidate.procedure) ? candidate.procedure : sourceDraft?.steps),
      troubleshooting: Object.prototype.hasOwnProperty.call(candidate, 'troubleshooting')
        ? candidate.troubleshooting
        : sourceDraft?.troubleshooting,
      createdAt: sourceDraft?.createdAt,
      updatedAt: sourceDraft?.updatedAt
    };

    const normalized = sanitizeIncomingProtocol(mergedCandidate);
    if (!normalized || !Array.isArray(normalized.steps) || !normalized.steps.length) {
      return null;
    }

    return {
      ...normalized,
      id: sourceDraft?.id || normalized.id,
      createdAt: sourceDraft?.createdAt || normalized.createdAt,
      updatedAt: sourceDraft?.updatedAt || normalized.updatedAt
    };
  }

  // Side-by-side "polish": one LLM call rewrites the editor draft; the user
  // compares and applies it. Applying keeps the draft's id and timestamps.
  async function onPolishProtocol() {
    if (localState.isProtocolPolishPending) {
      return;
    }

    const editorDraft = buildDraftFromEditorInputs();
    localState.protocolPolishSourceDraft = cloneDraftFromProtocol(editorDraft);
    localState.polishedProtocolDraft = null;
    setProtocolPolishPendingState(false);

    if (ui.protocolPolishOverlay) {
      ui.protocolPolishOverlay.hidden = false;
    }

    renderProtocolPreviewInto(ui.protocolPolishOriginalPreview, localState.protocolPolishSourceDraft, { includeNameSection: true });

    if (!hasDraftContent(localState.protocolPolishSourceDraft)) {
      const message = 'Add some protocol content first, then try polishing again.';
      renderProtocolPolishEmptyState(ui.protocolPolishResultPreview, message, { state: 'error' });
      setProtocolPolishStatus(message, { state: 'error' });
      return;
    }

    renderProtocolPolishLoadingState(ui.protocolPolishResultPreview);
    setProtocolPolishStatus('Generating a polished version from the current editor draft.');
    setProtocolPolishPendingState(true);

    const requestToken = ++localState.protocolPolishRequestToken;

    try {
      const rawResponse = await requestLlmText({
        llm: state.settings?.llm,
        prompt: buildProtocolPolishPrompt(localState.protocolPolishSourceDraft),
        moduleId: 'protocol',
        task: 'protocol-polish',
        expectJson: true
      });

      if (requestToken !== localState.protocolPolishRequestToken || ui.protocolPolishOverlay?.hidden) {
        return;
      }

      const nextPolishedDraft = normalizePolishedProtocolResponse(rawResponse, localState.protocolPolishSourceDraft);
      if (!nextPolishedDraft) {
        throw new Error('The model response could not be converted into a polished protocol.');
      }

      localState.polishedProtocolDraft = nextPolishedDraft;
      renderProtocolPreviewInto(ui.protocolPolishResultPreview, localState.polishedProtocolDraft, { includeNameSection: true });
      setProtocolPolishStatus('Review the polished version on the right, then apply it if you want to replace the editor draft.');
    } catch (error) {
      if (requestToken !== localState.protocolPolishRequestToken || ui.protocolPolishOverlay?.hidden) {
        return;
      }
      const message = String(error?.message || error || 'Failed to polish this protocol.');
      renderProtocolPolishEmptyState(ui.protocolPolishResultPreview, message, { state: 'error' });
      setProtocolPolishStatus(message, { state: 'error' });
    } finally {
      if (requestToken === localState.protocolPolishRequestToken) {
        setProtocolPolishPendingState(false);
      }
    }
  }

  function applyPolishedProtocolToEditor() {
    if (!localState.polishedProtocolDraft) {
      return;
    }

    localState.currentProtocolDraft = cloneDraftFromProtocol({
      ...localState.polishedProtocolDraft,
      id: localState.currentProtocolDraft.id,
      createdAt: localState.currentProtocolDraft.createdAt || localState.polishedProtocolDraft.createdAt,
      updatedAt: localState.currentProtocolDraft.updatedAt || localState.polishedProtocolDraft.updatedAt
    });

    populateEditorFormFromDraft(localState.currentProtocolDraft);
    closeProtocolPolishOverlay();
    ui.protocolNameInput?.focus();
  }

  return {
    setProtocolPolishPendingState,
    setProtocolPolishStatus,
    resetProtocolPolishState,
    closeProtocolPolishOverlay,
    onPolishProtocol,
    applyPolishedProtocolToEditor
  };
}
