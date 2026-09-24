import { showTransientNotice } from '../../lib/notify.js';

function trimText(value, maxLength = 5000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function sanitizeAttachmentName(fileName = '', fallback = 'attachment') {
  return trimText(String(fileName || '').replace(/\s+/g, ' ').trim(), 180) || fallback;
}

function formatAttachmentSize(size) {
  const numeric = Number(size);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '';
  }
  if (numeric >= 1024 * 1024) {
    return `${(numeric / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (numeric >= 1024) {
    return `${Math.round(numeric / 1024)} KB`;
  }
  return `${numeric} B`;
}

function buildProtocolGenerationSourceText(draft, { normalizeMaterials, stepToEditableLine }) {
  const materials = normalizeMaterials(draft?.materials);
  const steps = Array.isArray(draft?.steps)
    ? draft.steps
      .map((step) => String(stepToEditableLine(step) || '').trim())
      .filter(Boolean)
    : [];
  const troubleshooting = String(draft?.troubleshooting || '').trim();

  return [
    'Name:',
    String(draft?.name || '').trim() || '(none provided)',
    '',
    'Purpose:',
    String(draft?.purpose || '').trim() || '(none provided)',
    '',
    'Materials:',
    materials.length ? materials.map((item) => `- ${item}`).join('\n') : '(none provided)',
    '',
    'Steps:',
    steps.length ? steps.map((step, index) => `${index + 1}. ${step}`).join('\n') : '(none provided)',
    '',
    'Troubleshooting:',
    troubleshooting || '(none provided)'
  ].join('\n');
}

function buildProtocolAgentMessage({
  prompt,
  editorDraft,
  hasEditorContext,
  normalizeMaterials,
  stepToEditableLine
}) {
  return [
    'Create a lab protocol in Hikari from the user request, current draft context, and attached evidence.',
    'Research online and search papers when useful before authoring the protocol.',
    '',
    'A competent lab member who has not read the sources should be able to run the result at the bench without a follow-up question.',
    '',
    'Protocol requirements:',
    '- Create a complete, executable, import-ready protocol, not a questionnaire.',
    '- Give every step one operation with its own numbers: volume, concentration, time, temperature, centrifugation as x g rather than rpm, pH, plate or tube format, and replicate count. No "as appropriate" or "if needed" without the value or criterion that resolves it.',
    '- Order steps as the run happens, mark day boundaries and safe hold points inline, name each control next to the sample it controls, and give every readout or checkpoint its expected observation or acceptance criterion.',
    '- List every reagent a step uses in materials with the attribute that step depends on (working or stock concentration, buffer composition, grade, clone, host), and list nothing the steps never use.',
    '- Fill routine parameters such as replicate count, dilution factor, wash count and wash buffer, incubation time and temperature, and working volumes with a scientifically conventional starting value, and identify it in troubleshooting as a recommended starting condition rather than a source-reported fact.',
    '- Reserve placeholders for sample or clone identity, reagent identity, stock concentration or solvent, and instrument-specific settings that cannot be reliably inferred. Aim for 0-3 placeholders and never more than 5.',
    '- Write placeholders as [name] and use square brackets for nothing else; write concentrations as "Ca2+ concentration", not "[Ca2+]".',
    '- Preserve useful details from the current draft when provided.',
    '- Use attached evidence when available; keep source-reported values as reported; do not invent exact measurements, times, temperatures, reagent identities, catalog numbers, or instrument models it does not support, beyond the labeled starting defaults above. Where sources disagree, run one value and record the alternative in troubleshooting.',
    '- Use concise scientific language and operational step wording.',
    '- Materials must be short item strings. Steps must be ordered instruction strings. Troubleshooting is one plain-text block written as labeled lines: Expected outcome, Quality checks, Starting defaults, Failure modes, Safety, Source limitations; omit any label with nothing real to report.',
    '',
    'User request:',
    trimText(prompt, 3000) || '(none provided)',
    '',
    'Current draft context:',
    hasEditorContext
      ? trimText(buildProtocolGenerationSourceText(editorDraft, { normalizeMaterials, stepToEditableLine }), 6000)
      : '(none provided)'
  ].join('\n');
}

function buildProtocolAgentLlmPayload(llm = {}) {
  const configuredProvider = trimText(llm?.provider, 80).toLowerCase();
  return {
    provider: 'codex',
    model: configuredProvider === 'codex' ? trimText(llm?.model, 120) : '',
    reasoningEffort: trimText(llm?.reasoningEffort, 40).toLowerCase(),
    apiEndpoint: '',
    apiKey: ''
  };
}

export function createProtocolGenerationController({
  state,
  ui,
  localState,
  safeText,
  api,
  FileReaderClass,
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
  let composerAttachments = [];

  function hasDraftContent(draft) {
    return Boolean(
      String(draft?.name || '').trim()
      || String(draft?.purpose || '').trim()
      || String(draft?.troubleshooting || '').trim()
      || normalizeMaterials(draft?.materials).length
      || (Array.isArray(draft?.steps) ? draft.steps.length : 0)
    );
  }

  function renderComposerAttachments() {
    if (!ui.protocolGenerateAttachmentList) {
      return;
    }

    const items = composerAttachments.filter((attachment) => trimText(attachment?.name, 180));
    if (!items.length) {
      ui.protocolGenerateAttachmentList.innerHTML = '';
      ui.protocolGenerateAttachmentList.hidden = true;
      return;
    }

    ui.protocolGenerateAttachmentList.hidden = false;
    ui.protocolGenerateAttachmentList.innerHTML = items.map((attachment) => {
      const label = trimText(attachment?.kind, 20) === 'image' ? 'Image' : 'File';
      const size = formatAttachmentSize(attachment?.size);
      return `
        <span class="agent-attachment-pill${label === 'Image' ? ' is-image' : ''}">
          <span>${safeText(label)}</span>
          <span>${safeText(trimText(attachment?.name, 180))}</span>
          ${size ? `<span>${safeText(size)}</span>` : ''}
          <button type="button" data-protocol-generate-remove-attachment="${safeText(trimText(attachment?.id, 120))}" aria-label="${safeText(`Remove ${trimText(attachment?.name, 180)}`)}"><svg class="agent-chat-icon agent-attachment-remove-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </span>
      `;
    }).join('');
  }

  function setProtocolGenerateInputStatus(message = '', options = {}) {
    if (options.state === 'error' && message) {
      showTransientNotice(message, { type: 'error' });
    }
    if (!ui.protocolGenerateInputStatus) {
      return;
    }

    const normalized = String(message || '').trim();
    const stateLabel = String(options.state || '').trim();
    ui.protocolGenerateInputStatus.textContent = normalized;
    ui.protocolGenerateInputStatus.hidden = !normalized;

    if (stateLabel) {
      ui.protocolGenerateInputStatus.dataset.state = stateLabel;
    } else {
      delete ui.protocolGenerateInputStatus.dataset.state;
    }
  }

  function setProtocolGenerateStatus(message = '', options = {}) {
    if (options.state === 'error' && message) {
      showTransientNotice(message, { type: 'error' });
    }
    if (!ui.protocolGenerateStatus) {
      return;
    }

    const normalized = String(message || '').trim();
    const stateLabel = String(options.state || '').trim();
    ui.protocolGenerateStatus.textContent = normalized;
    ui.protocolGenerateStatus.hidden = !normalized;

    if (stateLabel) {
      ui.protocolGenerateStatus.dataset.state = stateLabel;
    } else {
      delete ui.protocolGenerateStatus.dataset.state;
    }
  }

  function setProtocolGeneratePendingState(nextPending) {
    localState.isProtocolGenerationPending = nextPending === true;

    if (ui.protocolGenerateBtn) {
      ui.protocolGenerateBtn.disabled = localState.isProtocolGenerationPending;
    }
    if (ui.protocolGenerateSendBtn) {
      ui.protocolGenerateSendBtn.disabled = localState.isProtocolGenerationPending;
      ui.protocolGenerateSendBtn.textContent = localState.isProtocolGenerationPending ? 'Generating...' : 'Generate Protocol';
    }
    if (ui.protocolGenerateApplyBtn) {
      ui.protocolGenerateApplyBtn.disabled = localState.isProtocolGenerationPending || !localState.generatedProtocolDraft;
    }
  }

  function resetComposerState() {
    composerAttachments = [];
    if (ui.protocolGeneratePromptInput) {
      ui.protocolGeneratePromptInput.value = '';
    }
    if (ui.protocolGenerateAttachmentInput) {
      ui.protocolGenerateAttachmentInput.value = '';
    }
    renderComposerAttachments();
    setProtocolGenerateInputStatus('');
  }

  function resetProtocolGenerateResultState() {
    localState.generatedProtocolDraft = null;
    setProtocolGeneratePendingState(false);
    setProtocolGenerateStatus('');
    if (ui.protocolGenerateResultPreview) {
      ui.protocolGenerateResultPreview.innerHTML = '';
    }
  }

  function closeProtocolGenerateInputOverlay({ resetComposer = false } = {}) {
    if (ui.protocolGenerateInputOverlay) {
      ui.protocolGenerateInputOverlay.hidden = true;
    }
    if (resetComposer) {
      resetComposerState();
    } else {
      setProtocolGenerateInputStatus('');
    }
  }

  function closeProtocolGenerateResultOverlay({ preserveComposer = true } = {}) {
    localState.protocolGenerationRequestToken += 1;
    if (ui.protocolGenerateResultOverlay) {
      ui.protocolGenerateResultOverlay.hidden = true;
    }
    resetProtocolGenerateResultState();
    if (!preserveComposer) {
      resetComposerState();
    }
  }

  function closeAllProtocolGenerationOverlays({ resetComposer = true } = {}) {
    closeProtocolGenerateInputOverlay({ resetComposer });
    closeProtocolGenerateResultOverlay({ preserveComposer: !resetComposer });
  }

  function syncProtocolGenerateButtonVisibility() {
    if (!ui.protocolGenerateBtn) {
      return;
    }
    ui.protocolGenerateBtn.hidden = localState.isCreateEditorMode !== true;
  }

  function openProtocolGenerateInputOverlay() {
    if (!ui.protocolGenerateInputOverlay || localState.isCreateEditorMode !== true) {
      return;
    }
    ui.protocolGenerateInputOverlay.hidden = false;
    renderComposerAttachments();
    ui.protocolGeneratePromptInput?.focus();
  }

  function fileToDataUrl(file) {
    if (typeof FileReaderClass !== 'function') {
      return Promise.reject(new Error('Attachments are unavailable in this build.'));
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReaderClass();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file?.name || 'attachment'}.`));
      reader.readAsDataURL(file);
    });
  }

  async function normalizeAttachmentFile(file) {
    const dataUrl = await fileToDataUrl(file);
    const mimeType = trimText(file?.type, 160) || trimText(String(dataUrl).match(/^data:([^;,]+)/i)?.[1], 160);
    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      name: sanitizeAttachmentName(file?.name, mimeType.startsWith('image/') ? 'image' : 'attachment'),
      mimeType,
      size: Number(file?.size) || 0,
      dataUrl,
      kind: mimeType.startsWith('image/') ? 'image' : 'file'
    };
  }

  async function handleAttachmentSelection(files = []) {
    const incomingFiles = Array.from(files || []).filter(Boolean);
    if (!incomingFiles.length) {
      return;
    }

    try {
      const nextAttachments = await Promise.all(incomingFiles.map((file) => normalizeAttachmentFile(file)));
      composerAttachments = [...composerAttachments, ...nextAttachments].slice(-8);
      renderComposerAttachments();
      setProtocolGenerateInputStatus(
        `${composerAttachments.length} attachment${composerAttachments.length === 1 ? '' : 's'} ready.`
      );
    } catch (error) {
      setProtocolGenerateInputStatus(
        String(error?.message || error || 'Failed to load attachments.'),
        { state: 'error' }
      );
    }
  }

  function removeComposerAttachment(attachmentId = '') {
    const normalizedId = trimText(attachmentId, 120);
    if (!normalizedId) {
      return;
    }
    composerAttachments = composerAttachments.filter((attachment) => trimText(attachment?.id, 120) !== normalizedId);
    renderComposerAttachments();
  }

  async function onGenerateProtocol() {
    if (localState.isProtocolGenerationPending) {
      return;
    }

    const prompt = trimText(ui.protocolGeneratePromptInput?.value, 3000);
    const editorDraft = buildDraftFromEditorInputs();
    const attachments = composerAttachments.map((attachment) => ({ ...attachment }));
    const hasEditorContext = hasDraftContent(editorDraft);

    if (!prompt && !attachments.length && !hasEditorContext) {
      setProtocolGenerateInputStatus(
        'Add a prompt, current draft content, or an attachment before generating a protocol.',
        { state: 'error' }
      );
      return;
    }

    if (!api?.agentGenerateProtocol) {
      setProtocolGenerateInputStatus('Protocol generation is unavailable in this build.', { state: 'error' });
      return;
    }

    localState.generatedProtocolDraft = null;
    const requestToken = ++localState.protocolGenerationRequestToken;
    closeProtocolGenerateInputOverlay({ resetComposer: false });
    if (ui.protocolGenerateResultOverlay) {
      ui.protocolGenerateResultOverlay.hidden = false;
    }
    renderProtocolPolishLoadingState(ui.protocolGenerateResultPreview, {
      ariaLabel: 'Generating protocol',
      message: 'The agent is researching and building a structured protocol from your prompt, current draft, and attached files.'
    });
    setProtocolGenerateStatus('Agent is researching online and in the literature when useful.');
    setProtocolGeneratePendingState(true);

    try {
      const result = await api.agentGenerateProtocol({
        message: buildProtocolAgentMessage({
          prompt,
          editorDraft,
          hasEditorContext,
          normalizeMaterials,
          stepToEditableLine
        }),
        attachments,
        stateSnapshot: {
          settings: {
            storagePath: trimText(state.settings?.storagePath, 1200),
            preferredJournals: state.settings?.preferredJournals,
            preferredJournal: state.settings?.preferredJournal
          }
        },
        llm: buildProtocolAgentLlmPayload(state.settings?.llm)
      });

      if (requestToken !== localState.protocolGenerationRequestToken || ui.protocolGenerateResultOverlay?.hidden) {
        return;
      }

      if (!result?.ok || !result.protocol) {
        throw new Error(result?.error || 'Failed to generate protocol.');
      }

      const generatedDraft = sanitizeIncomingProtocol(result.protocol);
      if (!generatedDraft || !Array.isArray(generatedDraft.steps) || !generatedDraft.steps.length) {
        throw new Error('The generated response could not be converted into a protocol.');
      }

      localState.generatedProtocolDraft = generatedDraft;
      renderProtocolPreviewInto(ui.protocolGenerateResultPreview, localState.generatedProtocolDraft, { includeNameSection: true, reviewDocument: true });
      setProtocolGenerateStatus('');
    } catch (error) {
      if (requestToken !== localState.protocolGenerationRequestToken || ui.protocolGenerateResultOverlay?.hidden) {
        return;
      }
      const message = String(error?.message || error || 'Failed to generate protocol.');
      renderProtocolPolishEmptyState(ui.protocolGenerateResultPreview, message, { state: 'error' });
      setProtocolGenerateStatus(message, { state: 'error' });
    } finally {
      if (requestToken === localState.protocolGenerationRequestToken) {
        setProtocolGeneratePendingState(false);
      }
    }
  }

  function applyGeneratedProtocolToEditor() {
    if (!localState.generatedProtocolDraft) {
      return;
    }

    localState.currentProtocolDraft = cloneDraftFromProtocol({
      ...localState.generatedProtocolDraft,
      id: localState.currentProtocolDraft.id,
      createdAt: localState.currentProtocolDraft.createdAt || localState.generatedProtocolDraft.createdAt,
      updatedAt: localState.currentProtocolDraft.updatedAt || localState.generatedProtocolDraft.updatedAt
    });

    populateEditorFormFromDraft(localState.currentProtocolDraft);
    closeProtocolGenerateResultOverlay({ preserveComposer: false });
    ui.protocolNameInput?.focus();
  }

  if (ui.protocolGenerateInputOverlay) {
    ui.protocolGenerateInputOverlay.hidden = true;
  }
  if (ui.protocolGenerateResultOverlay) {
    ui.protocolGenerateResultOverlay.hidden = true;
  }
  renderComposerAttachments();
  resetProtocolGenerateResultState();

  return {
    handleAttachmentSelection,
    closeProtocolGenerateInputOverlay,
    closeProtocolGenerateResultOverlay,
    closeAllProtocolGenerationOverlays,
    syncProtocolGenerateButtonVisibility,
    openProtocolGenerateInputOverlay,
    onGenerateProtocol,
    applyGeneratedProtocolToEditor,
    removeComposerAttachment,
    renderComposerAttachments,
    setProtocolGeneratePendingState
  };
}
