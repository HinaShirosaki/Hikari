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
    String(draft?.name || '').trim() || '[none provided]',
    '',
    'Purpose:',
    String(draft?.purpose || '').trim() || '[none provided]',
    '',
    'Materials:',
    materials.length ? materials.map((item) => `- ${item}`).join('\n') : '[none provided]',
    '',
    'Steps:',
    steps.length ? steps.map((step, index) => `${index + 1}. ${step}`).join('\n') : '[none provided]',
    '',
    'Troubleshooting:',
    troubleshooting || '[none provided]'
  ].join('\n');
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
          <button type="button" data-protocol-generate-remove-attachment="${safeText(trimText(attachment?.id, 120))}" aria-label="${safeText(`Remove ${trimText(attachment?.name, 180)}`)}">&times;</button>
        </span>
      `;
    }).join('');
  }

  function setProtocolGenerateInputStatus(message = '', options = {}) {
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
      message: 'Generating a structured protocol from your prompt, current draft, and attached files.'
    });
    setProtocolGenerateStatus('Generating protocol from the provided evidence.');
    setProtocolGeneratePendingState(true);

    try {
      const result = await api.agentGenerateProtocol({
        message: prompt,
        attachments,
        editorDraft: {
          title: editorDraft.name,
          purpose: editorDraft.purpose,
          materials: normalizeMaterials(editorDraft.materials),
          steps: Array.isArray(editorDraft.steps)
            ? editorDraft.steps.map((step) => String(stepToEditableLine(step) || '').trim()).filter(Boolean)
            : [],
          troubleshooting: editorDraft.troubleshooting,
          methodText: hasEditorContext
            ? buildProtocolGenerationSourceText(editorDraft, { normalizeMaterials, stepToEditableLine })
            : ''
        },
        llm: {
          provider: String(state.settings?.llm?.provider || '').trim(),
          model: String(state.settings?.llm?.model || '').trim(),
          reasoningEffort: String(state.settings?.llm?.reasoningEffort || '').trim().toLowerCase(),
          apiEndpoint: String(state.settings?.llm?.provider || '').trim() === 'codex'
            ? ''
            : String(state.settings?.llm?.apiEndpoint || '').trim(),
          apiKey: String(state.settings?.llm?.provider || '').trim() === 'codex'
            ? ''
            : String(state.settings?.llm?.apiKey || '').trim()
        }
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
      renderProtocolPreviewInto(ui.protocolGenerateResultPreview, localState.generatedProtocolDraft, { includeNameSection: true });
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
