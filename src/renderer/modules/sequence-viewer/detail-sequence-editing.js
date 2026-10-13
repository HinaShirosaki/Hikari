import { escapeHtml } from '../../lib/html.js';
import { clamp, cleanText, normalizeSequenceText } from './shared.js';
import {
  buildPeptideInsertDna,
  getCodingOffsetAtBoundary,
  getInsertionCodingFeatures,
  PEPTIDE_INSERT_GROUPS
} from './sequence-edit-peptides.js';

function normalizeEditableSequence(raw) {
  return normalizeSequenceText(raw).replace(/\*/g, '');
}

function isInteractiveKeyboardTarget(target) {
  if (!target) {
    return false;
  }

  const tagName = String(target?.tagName || target?.nodeName || '').toLowerCase();
  if (['input', 'textarea', 'select', 'button'].includes(tagName)) {
    return true;
  }
  if (target?.isContentEditable) {
    return true;
  }
  if (typeof target.closest === 'function') {
    try {
      return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
    } catch {
      return false;
    }
  }
  return false;
}

function getKeyboardSequenceText(event) {
  if (event?.ctrlKey || event?.metaKey || event?.altKey) {
    return '';
  }
  const key = String(event?.key || '');
  if (key.length !== 1) {
    return '';
  }
  return normalizeEditableSequence(key);
}

function setTextareaSelectionToEnd(textarea) {
  if (!textarea) {
    return;
  }
  const length = String(textarea.value || '').length;
  try {
    textarea.focus?.();
    textarea.setSelectionRange?.(length, length);
  } catch {
    textarea.focus?.();
  }
}

function isVisibleElement(element) {
  return Boolean(element && element.hidden !== true);
}

export function createSequenceViewerSequenceEditingController(config = {}) {
  const rootDocument = config?.rootDocument || globalThis?.document || null;
  const elements = config?.elements || {};
  const state = config?.state || {};
  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const getSelectedFeature = config?.getSelectedFeature || (() => null);
  const getVisibleFeatures = config?.getVisibleFeatures || (() => []);
  const getSequenceSelectionRange = config?.getSequenceSelectionRange || (() => null);
  const clearSequenceSelection = config?.clearSequenceSelection || (() => {});
  const hideFeatureContextMenu = config?.hideFeatureContextMenu || (() => {});
  const hideFeatureEditor = config?.hideFeatureEditor || (() => {});
  const renderSequence = config?.renderSequence || (() => {});
  const renderSelectedFeatureDetail = config?.renderSelectedFeatureDetail || (() => {});
  const setStatus = config?.setStatus || (() => {});
  const onApplySequenceEdit = config?.onApplySequenceEdit || (async () => {});

  let editState = null;

  function renderPeptideControls() {
    const isInsert = editState?.mode === 'insert';
    if (elements.sequenceEditTagWrap) elements.sequenceEditTagWrap.hidden = !isInsert;
    if (elements.sequenceEditTagSelect) {
      elements.sequenceEditTagSelect.innerHTML = '<option value="">Custom DNA</option>' + PEPTIDE_INSERT_GROUPS
        .map((group) => `<optgroup label="${escapeHtml(group.label)}">${group.items.map((part) =>
          `<option value="${group.id}:${escapeHtml(part.id)}">${escapeHtml(part.label)}</option>`
        ).join('')}</optgroup>`).join('');
      elements.sequenceEditTagSelect.value = '';
    }
    const features = editState?.codingFeatures || [];
    if (elements.sequenceEditTagOrfSelect) {
      elements.sequenceEditTagOrfSelect.innerHTML = '<option value="">No ORF reference</option>' + features
        .map((feature, index) => `<option value="${index}">${escapeHtml(cleanText(feature.name, 120) || 'ORF')} (${Number(feature.strand) === -1 ? '−' : '+'})</option>`).join('');
      // A selected coding feature wins. Without one, avoid silently choosing
      // between overlapping reading frames.
      elements.sequenceEditTagOrfSelect.value = editState?.preferredCodingIndex >= 0
        ? String(editState.preferredCodingIndex)
        : (features.length === 1 ? '0' : '');
    }
    if (elements.sequenceEditTagOrientation) elements.sequenceEditTagOrientation.value = 'along';
    if (elements.sequenceEditTagOptions) elements.sequenceEditTagOptions.hidden = true;
    if (elements.sequenceEditTagPreview) elements.sequenceEditTagPreview.textContent = '';
  }

  function updatePeptideSequence() {
    if (editState?.mode !== 'insert') return;
    const partKey = elements.sequenceEditTagSelect?.value || '';
    if (elements.sequenceEditTagOptions) elements.sequenceEditTagOptions.hidden = !partKey;
    if (!partKey) return;
    const referenceValue = elements.sequenceEditTagOrfSelect?.value || '';
    const feature = referenceValue !== '' ? editState.codingFeatures[Number(referenceValue)] : null;
    const orientation = elements.sequenceEditTagOrientation?.value === 'reverse' ? 'reverse' : 'along';
    const generated = buildPeptideInsertDna(partKey, feature?.strand, orientation);
    if (!generated) return;
    if (elements.sequenceEditTagOrientation) {
      const labels = feature
        ? ['Along ORF', 'Reverse of ORF']
        : ['Forward strand (+)', 'Reverse strand (−)'];
      elements.sequenceEditTagOrientation.innerHTML = `<option value="along">${labels[0]}</option><option value="reverse">${labels[1]}</option>`;
      elements.sequenceEditTagOrientation.value = orientation;
    }
    if (elements.sequenceEditTextarea) elements.sequenceEditTextarea.value = generated.sequence;
    if (elements.sequenceEditTagPreview) {
      let frameNote = 'Choose an ORF reference to check the reading frame.';
      if (feature) {
        const offset = getCodingOffsetAtBoundary(getSelectedRecord(), feature, editState.range.start);
        const codonStart = Number(feature?.qualifiers?.codon_start || 1) - 1;
        frameNote = Number.isFinite(offset) && offset >= codonStart && (offset - codonStart) % 3 === 0
          ? 'Insertion is at a codon boundary.'
          : 'Insertion is inside a codon. Choose a codon boundary to express the peptide in frame.';
        if (orientation === 'reverse') frameNote += ' Peptide DNA faces opposite to this ORF.';
      }
      elements.sequenceEditTagPreview.textContent = `${generated.part.sequence} · ${generated.sequence.length} bp · ${generated.strand === -1 ? '−' : '+'} strand. ${frameNote}`;
    }
  }

  elements.sequenceEditTagSelect?.addEventListener('change', updatePeptideSequence);
  elements.sequenceEditTagOrfSelect?.addEventListener('change', updatePeptideSequence);
  elements.sequenceEditTagOrientation?.addEventListener('change', updatePeptideSequence);
  elements.sequenceEditTextarea?.addEventListener('input', () => {
    // Hand edits become custom DNA; changing a library part later must not overwrite
    // text while still presenting it as an unchanged library peptide.
    if (elements.sequenceEditTagSelect) elements.sequenceEditTagSelect.value = '';
    if (elements.sequenceEditTagOptions) elements.sequenceEditTagOptions.hidden = true;
  });

  function getNormalizedRange(record, range = {}) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    const start = clamp(Math.round(Number(range?.start) || 0), 0, sequenceLength);
    const end = clamp(Math.round(Number(range?.end) || start), start, sequenceLength);
    return { start, end };
  }

  function setInputVisibility(mode) {
    const isDelete = mode === 'delete';
    if (elements.sequenceEditInputWrap) {
      elements.sequenceEditInputWrap.hidden = isDelete;
    }
    if (elements.sequenceEditTextarea) {
      elements.sequenceEditTextarea.hidden = isDelete;
      elements.sequenceEditTextarea.disabled = isDelete;
    }
    if (elements.sequenceEditDeleteMessage) {
      elements.sequenceEditDeleteMessage.hidden = !isDelete;
    }
  }

  function renderSequenceEditDialog() {
    if (!elements.sequenceEditOverlay) {
      return;
    }

    const record = getSelectedRecord();
    const isOpen = Boolean(editState && record?.sequence?.length);
    elements.sequenceEditOverlay.hidden = !isOpen;
    if (!isOpen) {
      return;
    }

    const mode = editState.mode === 'delete'
      ? 'delete'
      : (editState.mode === 'replace' ? 'replace' : 'insert');
    const range = getNormalizedRange(record, editState.range);
    const selectedLength = Math.max(0, range.end - range.start);
    setInputVisibility(mode);
    renderPeptideControls();

    if (elements.sequenceEditTitle) {
      elements.sequenceEditTitle.textContent = mode === 'delete'
        ? 'Delete Bases'
        : (mode === 'replace' ? 'Replace Bases' : 'Insert Bases');
    }
    if (elements.sequenceEditNote) {
      elements.sequenceEditNote.innerHTML = '';
    }
    if (elements.sequenceEditDeleteMessage) {
      elements.sequenceEditDeleteMessage.innerHTML = `<p>Delete ${selectedLength.toLocaleString()} bp?</p>`;
    }
    if (elements.sequenceEditTextarea) {
      elements.sequenceEditTextarea.value = mode === 'delete'
        ? ''
        : normalizeEditableSequence(editState.initialSequence || '');
    }
    if (elements.sequenceEditConfirmBtn) {
      elements.sequenceEditConfirmBtn.textContent = mode === 'delete'
        ? 'Delete Bases'
        : (mode === 'replace' ? 'Replace Bases' : 'Insert Bases');
    }

    if (mode !== 'delete') {
      const focusTextarea = () => setTextareaSelectionToEnd(elements.sequenceEditTextarea);
      if (typeof rootDocument?.defaultView?.setTimeout === 'function') {
        rootDocument.defaultView.setTimeout(focusTextarea, 0);
      } else {
        globalThis?.setTimeout?.(focusTextarea, 0);
      }
    } else {
      elements.sequenceEditConfirmBtn?.focus?.();
    }
  }

  function hideSequenceEditDialog() {
    editState = null;
    if (elements.sequenceEditOverlay) {
      elements.sequenceEditOverlay.hidden = true;
    }
    if (elements.sequenceEditTextarea) {
      elements.sequenceEditTextarea.value = '';
      elements.sequenceEditTextarea.disabled = false;
      elements.sequenceEditTextarea.hidden = false;
    }
    if (elements.sequenceEditInputWrap) {
      elements.sequenceEditInputWrap.hidden = false;
    }
    if (elements.sequenceEditDeleteMessage) {
      elements.sequenceEditDeleteMessage.hidden = true;
      elements.sequenceEditDeleteMessage.innerHTML = '';
    }
    renderPeptideControls();
  }

  function hasOpenSequenceEditDialog() {
    return Boolean(editState);
  }

  function hasBlockingOverlayOpen() {
    return [
      elements.featureEditorOverlay,
      elements.backboneDialogOverlay
    ].some((element) => isVisibleElement(element));
  }

  function openSequenceEditDialog(mode, context = {}) {
    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      return false;
    }

    const resolvedMode = mode === 'delete'
      ? 'delete'
      : (mode === 'replace' ? 'replace' : 'insert');
    const range = getNormalizedRange(record, context.range);
    if (resolvedMode !== 'insert' && range.end <= range.start) {
      return false;
    }

    hideFeatureContextMenu();
    hideFeatureEditor();
    const selectedFeature = context.feature || getSelectedFeature(record);
    const codingFeatures = resolvedMode === 'insert'
      ? getInsertionCodingFeatures(record, range.start, selectedFeature, getVisibleFeatures(record))
      : [];
    editState = {
      mode: resolvedMode,
      range: resolvedMode === 'insert'
        ? { start: range.start, end: range.start }
        : range,
      initialSequence: normalizeEditableSequence(context.initialSequence || ''),
      codingFeatures,
      preferredCodingIndex: codingFeatures.indexOf(selectedFeature)
    };
    renderSequenceEditDialog();
    return true;
  }

  function openSequenceEditFromKeyboardEvent(event) {
    if (
      hasOpenSequenceEditDialog()
      || hasBlockingOverlayOpen()
      || isInteractiveKeyboardTarget(event?.target)
    ) {
      return false;
    }

    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      return false;
    }

    const selectionRange = getSequenceSelectionRange(record);
    const key = String(event?.key || '');
    if ((key === 'Delete' || key === 'Backspace') && selectionRange) {
      event?.preventDefault?.();
      return openSequenceEditDialog('delete', { range: selectionRange });
    }

    const typedSequence = getKeyboardSequenceText(event);
    if (!typedSequence) {
      return false;
    }

    if (selectionRange) {
      event?.preventDefault?.();
      return openSequenceEditDialog('replace', {
        range: selectionRange,
        initialSequence: typedSequence
      });
    }

    const sequenceLength = Math.max(0, Number(record.sequence.length) || 0);
    const cursorBase = Number(state.sequenceCursorBase);
    if (!Number.isFinite(cursorBase)) {
      return false;
    }

    const cursorIndex = clamp(Math.round(cursorBase), 0, sequenceLength);
    event?.preventDefault?.();
    return openSequenceEditDialog('insert', {
      range: { start: cursorIndex, end: cursorIndex },
      initialSequence: typedSequence
    });
  }

  async function applySequenceEditDialog() {
    if (!editState) {
      return;
    }

    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      hideSequenceEditDialog();
      return;
    }

    const mode = editState.mode === 'delete'
      ? 'delete'
      : (editState.mode === 'replace' ? 'replace' : 'insert');
    const range = getNormalizedRange(record, editState.range);
    const replacement = mode === 'delete'
      ? ''
      : normalizeEditableSequence(elements.sequenceEditTextarea?.value || '');

    if (mode !== 'delete' && !replacement.length) {
      if (elements.sequenceEditNote) {
        elements.sequenceEditNote.innerHTML = '<span style="color:var(--theme-danger);">Enter at least one base before confirming.</span>';
      }
      setStatus('Enter at least one base before confirming.', true);
      return;
    }

    try {
      await onApplySequenceEdit({
        mode,
        range,
        sequence: replacement
      });
      hideSequenceEditDialog();
      clearSequenceSelection({ preserveCursor: true });
      renderSequence(getSelectedRecord(), { preserveScroll: true });
      renderSelectedFeatureDetail(getSelectedRecord());
    } catch (error) {
      setStatus(error?.message || 'Failed to edit sequence.', true);
    }
  }

  return {
    applySequenceEditDialog,
    hasOpenSequenceEditDialog,
    hideSequenceEditDialog,
    openSequenceEditDialog,
    openSequenceEditFromKeyboardEvent
  };
}
