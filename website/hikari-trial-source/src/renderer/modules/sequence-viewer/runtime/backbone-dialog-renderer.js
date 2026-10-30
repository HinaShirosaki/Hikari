import { escapeHtml } from '../../../lib/html.js';
import { buildSequenceMapSvg } from '../vector-builder/sequence-map.js';
import {
  cleanText,
  clamp
} from '../shared.js';
import {
  buildBackboneRecognitionFeatures
} from './backbone-recognition-features.js';
import {
  getRecognitionCandidates,
  getRecognitionDisplayMatch
} from './backbone-recognition-model.js';

export function createBackboneDialogRenderer(ctx) {
  const { elements, state } = ctx;

  function renderBackboneRecognitionDialog() {
    const dialogState = state.backboneRecognitionDialog || {};
    const isOpen = Boolean(dialogState.open) && Boolean(dialogState.match);
    if (elements.backboneDialogOverlay) {
      elements.backboneDialogOverlay.hidden = !isOpen;
    }
    if (!isOpen) {
      return;
    }

    const match = dialogState.match;
    const candidates = getRecognitionCandidates(match);
    const candidateId = String(dialogState.candidateId || candidates[0]?.id || '');
    const variantMode = dialogState.variantMode === 'restriction' ? 'restriction' : 'gibson';
    const displayMatch = getRecognitionDisplayMatch(match, { candidateId, variantMode });

    renderDialogModeButtons(variantMode);
    renderDialogSubtitle(displayMatch);
    renderDialogCandidates(candidates, candidateId);
    if (elements.backboneDialogSummary) {
      elements.backboneDialogSummary.innerHTML = buildBackboneDialogSummaryHtml(displayMatch);
    }
    renderDialogPreview(match, dialogState.recordIndex, candidateId, variantMode);
  }

  function closeBackboneRecognitionDialog() {
    state.backboneRecognitionDialog = { open: false, recordIndex: -1, match: null, candidateId: '', variantMode: 'gibson' };
    if (elements.backboneDialogOverlay) {
      elements.backboneDialogOverlay.hidden = true;
    }
  }

  function openBackboneRecognitionDialog(match, recordIndex) {
    const defaultDisplayMatch = getRecognitionDisplayMatch(match, { variantMode: 'gibson' });
    state.backboneRecognitionDialog = {
      open: true,
      recordIndex,
      match,
      candidateId: String(defaultDisplayMatch?.selectedCandidateId || getRecognitionCandidates(match)[0]?.id || ''),
      variantMode: 'gibson'
    };
    renderBackboneRecognitionDialog();
  }

  function updateBackboneRecognitionDialogSelection(nextSelection = {}) {
    if (!state.backboneRecognitionDialog?.open || !state.backboneRecognitionDialog?.match) {
      return;
    }
    const candidates = getRecognitionCandidates(state.backboneRecognitionDialog.match);
    state.backboneRecognitionDialog = {
      ...state.backboneRecognitionDialog,
      candidateId: String(nextSelection.candidateId || state.backboneRecognitionDialog.candidateId || candidates[0]?.id || ''),
      variantMode: nextSelection.variantMode === 'restriction'
        ? 'restriction'
        : (nextSelection.variantMode === 'gibson' ? 'gibson' : state.backboneRecognitionDialog.variantMode)
    };
    renderBackboneRecognitionDialog();
  }

  function renderDialogModeButtons(variantMode) {
    elements.backboneDialogModeGibsonBtn?.classList.toggle('sequence-viewer-mode-btn-active', variantMode === 'gibson');
    elements.backboneDialogModeRestrictionBtn?.classList.toggle('sequence-viewer-mode-btn-active', variantMode === 'restriction');
  }

  function renderDialogSubtitle(displayMatch) {
    if (!elements.backboneDialogSubtitle) {
      return;
    }
    const hostName = cleanText(displayMatch?.hostVectorName, 140) || 'vector';
    elements.backboneDialogSubtitle.textContent = String(displayMatch?.recognitionSource || '').toLowerCase() === 'library_alignment'
      ? `Recognized ${hostName} as the backbone candidate. Choose a promoter / ORF candidate and insert mode to apply.`
      : 'Recognized a backbone candidate from promoter alignment. Choose a promoter / ORF candidate and insert mode to apply.';
  }

  function renderDialogCandidates(candidates, activeCandidateId) {
    if (!elements.backboneDialogCandidates) {
      return;
    }
    elements.backboneDialogCandidates.innerHTML = candidates.length
      ? candidates.map((candidate) => buildCandidateButtonHtml(candidate, activeCandidateId)).join('')
      : '<p class="small-note">No candidates available.</p>';
  }

  function renderDialogPreview(match, recordIndex, candidateId, variantMode) {
    const record = state.records[clamp(recordIndex, 0, Math.max(0, state.records.length - 1))] || null;
    if (!record?.sequence?.length) {
      renderBackboneDialogPreviewFrame(null);
      return;
    }
    const previewFeatures = buildBackboneRecognitionFeatures(match, record.sequence.length, {
      candidateId,
      variantMode,
      includeContextFeatures: false
    }).filter((feature) => feature?.type === 'backbone' || feature?.type === 'insert');
    renderBackboneDialogPreviewFrame({ ...record, features: previewFeatures });
  }

  return {
    closeBackboneRecognitionDialog,
    openBackboneRecognitionDialog,
    renderBackboneRecognitionDialog,
    updateBackboneRecognitionDialogSelection
  };

  function renderBackboneDialogPreviewFrame(record) {
    if (!elements.backboneDialogPreview) {
      return;
    }
    if (!record?.sequence?.length) {
      elements.backboneDialogPreview.innerHTML = '<p class="small-note">Plasmid preview unavailable.</p>';
      return;
    }
    // Backbone/insert recognition is a plasmid workflow, so the candidate is
    // previewed as a ring even when the source record is stored linear.
    elements.backboneDialogPreview.innerHTML = buildSequenceMapSvg(
      { ...record, topology: 'circular' },
      { features: Array.isArray(record?.features) ? record.features : [] }
    );
  }
}

function buildCandidateButtonHtml(candidate, activeCandidateId) {
  const candidateId = String(candidate?.id || '');
  const promoterName = cleanText(candidate?.promoter?.name || candidate?.label || 'Candidate', 140);
  const promoterGap = Math.max(0, Number(candidate?.promoter?.gapToOrf) || 0);
  const orfLength = Math.max(0, Number(candidate?.orf?.length) || 0);
  const restrictionUp = cleanText(candidate?.variants?.restriction?.upstreamSite?.name, 80);
  const restrictionDown = cleanText(candidate?.variants?.restriction?.downstreamSite?.name, 80);
  const activeClass = candidateId === activeCandidateId ? ' sequence-viewer-backbone-dialog-candidate-active' : '';
  const note = restrictionUp || restrictionDown
    ? `${restrictionUp || '5\' site missing'} -> ${restrictionDown || '3\' site missing'}`
    : 'Restriction sites unavailable; Gibson/HR still available.';
  return `<button type="button" class="sequence-viewer-backbone-dialog-candidate${activeClass}" data-candidate-id="${escapeHtml(candidateId)}"><span class="sequence-viewer-backbone-dialog-candidate-name">${escapeHtml(promoterName)}</span><span class="sequence-viewer-backbone-dialog-candidate-meta">${orfLength > 0 ? `${orfLength.toLocaleString()} bp ORF` : 'No downstream ORF'}; ${promoterGap.toLocaleString()} bp from promoter</span><span class="sequence-viewer-backbone-dialog-candidate-note">${escapeHtml(note)}</span></button>`;
}

function buildBackboneDialogSummaryHtml(displayMatch) {
  if (!displayMatch) {
    return '<p class="small-note">Select a candidate to preview the plasmid map.</p>';
  }
  const modeLabel = displayMatch.activeVariantMode === 'restriction' ? 'Restriction cloning' : 'Gibson / homologous recombination';
  const vectorName = cleanText(displayMatch.hostVectorName, 140) || 'vector';
  const promoterName = cleanText(displayMatch.promoter?.name, 140);
  const orfLength = Math.max(0, Number(displayMatch.orf?.length) || 0);
  const upstreamSite = cleanText(displayMatch.upstreamSite?.name, 80);
  const downstreamSite = cleanText(displayMatch.downstreamSite?.name, 80);
  return [
    `<p><strong>Backbone Candidate:</strong> ${escapeHtml(vectorName)}</p>`,
    `<p><strong>Mode:</strong> ${escapeHtml(modeLabel)}</p>`,
    promoterName ? `<p><strong>Promoter:</strong> ${escapeHtml(promoterName)}</p>` : '<p><strong>Promoter:</strong> No promoter-aligned candidate</p>',
    orfLength > 0 ? `<p><strong>ORF:</strong> ${orfLength.toLocaleString()} bp from ${escapeHtml(String(displayMatch.startCodon || 'ATG'))} to ${escapeHtml(String(displayMatch.stopCodon || 'stop'))}</p>` : '',
    `<p><strong>Insert:</strong> ${Math.max(0, Number(displayMatch.insertLength) || 0).toLocaleString()} bp</p>`,
    `<p><strong>Backbone:</strong> ${Math.max(0, Number(displayMatch.backboneLength) || 0).toLocaleString()} bp</p>`,
    displayMatch.activeVariantMode === 'restriction' ? `<p><strong>Sites:</strong> ${escapeHtml(upstreamSite || '5\' site not found')}${downstreamSite ? ` -> ${escapeHtml(downstreamSite)}` : ''}</p>` : ''
  ].filter(Boolean).join('');
}
