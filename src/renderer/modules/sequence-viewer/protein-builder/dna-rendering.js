import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("dna");
import { escapeHtml } from '../../../lib/html.js';
import { buildDnaConstruct } from './dna-construct.js';
import { escapeAttribute } from './row-factory.js';
import { getProteinBuilderPaletteClass } from './block-palette.js';

function renderHighlightedDna(sequence, parts = []) {
  const safeSequence = String(sequence || '');
  const chainSequence = parts.map((part) => String(part?.dnaSequence || '')).join('');
  if (!parts.length || chainSequence !== safeSequence) {
    return `<span class="sequence-viewer-protein-builder-dna-segment sequence-viewer-protein-builder-block-custom">${escapeHtml(safeSequence)}</span>`;
  }
  return parts.map((part, index) => {
    const type = String(part?.type || 'custom').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'custom';
    const paletteClass = getProteinBuilderPaletteClass(part?.paletteSlot || index + 1);
    return `<span class="sequence-viewer-protein-builder-dna-segment sequence-viewer-protein-builder-block-${type} ${paletteClass}" title="${escapeAttribute(part?.label || 'Protein block')}">${escapeHtml(part?.dnaSequence || '')}</span>`;
  }).join('');
}

export function installProteinBuilderDnaRendering(ctx) {
  const { elements, state } = ctx;

  ctx.renderDnaConstruct = function renderDnaConstruct() {
    if (state.dnaConstruct?.contextKey && state.dnaConstruct.contextKey !== ctx.getDnaBuildContextKey()) {
      state.dnaConstruct = null;
    }
    if (elements.proteinBuilderDnaMeta) {
      i18nUi.setText(elements.proteinBuilderDnaMeta, (state.dnaConstruct?.sequence?.length ? i18nUi.message((state.dnaConstruct.parts.length === 1 ? "{p0} nt | {p1} block" : "{p0} nt | {p1} blocks"), { p0: state.dnaConstruct.length, p1: state.dnaConstruct.parts.length }) : i18nUi.message("DNA build not run yet.")));
    }
    if (elements.proteinBuilderCopyDnaBtn) {
      elements.proteinBuilderCopyDnaBtn.disabled = !state.dnaConstruct?.ok || !state.dnaConstruct?.sequence;
    }
    if (!elements.proteinBuilderDnaSequence) {
      return;
    }

    if (!state.dnaConstruct) {
      i18nUi.setHtml(elements.proteinBuilderDnaSequence, `<p class="small-note">${i18nUi.html("Click Build DNA Sequence to generate a coding sequence for the current chain.")}</p>`);
      return;
    }

    if (!state.dnaConstruct.ok || !state.dnaConstruct.sequence) {
      const messages = [
        ...(Array.isArray(state.dnaConstruct.errors) ? state.dnaConstruct.errors : []),
        ...(Array.isArray(state.dnaConstruct.warnings) ? state.dnaConstruct.warnings : [])
      ].filter(Boolean);
      i18nUi.setHtml(elements.proteinBuilderDnaSequence, messages.length
        ? messages.map((message) => `<p class="small-note">${escapeHtml(message)}</p>`).join('')
        : `<p class="small-note">${i18nUi.html("Unable to generate a DNA sequence.")}</p>`);
      return;
    }

    i18nUi.setHtml(elements.proteinBuilderDnaSequence, `<span class="sequence-viewer-protein-builder-sequence-text">${renderHighlightedDna(state.dnaConstruct.sequence, state.dnaConstruct.highlightParts || state.dnaConstruct.parts)}</span>`);
  };

  ctx.buildCurrentDnaSequence = function buildCurrentDnaSequence() {
    const payload = ctx.getProteinBuilderPayload();
    const dnaConstruct = buildDnaConstruct(payload, {
      record: ctx.getSelectedRecord(),
      selectedFeature: ctx.getSelectedFeature(),
      organism: payload.codonUsageProfile
    });
    state.dnaConstruct = {
      ...dnaConstruct,
      contextKey: ctx.getDnaBuildContextKey()
    };
    ctx.renderDnaConstruct();

    if (!state.dnaConstruct.ok) {
      const failure = state.dnaConstruct.errors[0]
        || state.dnaConstruct.warnings[0]
        || 'Unable to build a DNA sequence from the current chain.';
      ctx.setBuilderStatus(failure, true);
      return state.dnaConstruct;
    }

    // The nt | block meta line already reports a successful build; no status echo.
    ctx.setBuilderStatus('');
    return state.dnaConstruct;
  };
}
