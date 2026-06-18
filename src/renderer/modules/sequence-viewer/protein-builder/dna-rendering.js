import { escapeHtml } from '../../tool-box/common.js';
import { buildDnaConstruct } from './dna-construct.js';

export function installProteinBuilderDnaRendering(ctx) {
  const { elements, state } = ctx;

  ctx.renderDnaConstruct = function renderDnaConstruct() {
    if (state.dnaConstruct?.contextKey && state.dnaConstruct.contextKey !== ctx.getDnaBuildContextKey()) {
      state.dnaConstruct = null;
    }
    if (elements.proteinBuilderDnaMeta) {
      elements.proteinBuilderDnaMeta.textContent = state.dnaConstruct?.sequence?.length
        ? `${state.dnaConstruct.length} nt | ${state.dnaConstruct.parts.length} block${state.dnaConstruct.parts.length === 1 ? '' : 's'}`
        : 'DNA build not run yet.';
    }
    if (!elements.proteinBuilderDnaSequence) {
      return;
    }

    if (!state.dnaConstruct) {
      elements.proteinBuilderDnaSequence.innerHTML = '<p class="small-note">Click Build DNA Sequence to generate a coding sequence for the current chain.</p>';
      return;
    }

    if (!state.dnaConstruct.ok || !state.dnaConstruct.sequence) {
      const messages = [
        ...(Array.isArray(state.dnaConstruct.errors) ? state.dnaConstruct.errors : []),
        ...(Array.isArray(state.dnaConstruct.warnings) ? state.dnaConstruct.warnings : [])
      ].filter(Boolean);
      elements.proteinBuilderDnaSequence.innerHTML = messages.length
        ? messages.map((message) => `<p class="small-note">${escapeHtml(message)}</p>`).join('')
        : '<p class="small-note">Unable to generate a DNA sequence.</p>';
      return;
    }

    const supplemental = [
      ...(Array.isArray(state.dnaConstruct.notes) ? state.dnaConstruct.notes : []),
      ...(Array.isArray(state.dnaConstruct.warnings) ? state.dnaConstruct.warnings : [])
    ].filter(Boolean);
    elements.proteinBuilderDnaSequence.innerHTML = `
      <span class="sequence-viewer-protein-builder-sequence-text">${escapeHtml(state.dnaConstruct.sequence)}</span>
      ${supplemental.length
        ? `<div class="sequence-viewer-protein-builder-dna-notes">${supplemental.map((message) => `<p class="small-note">${escapeHtml(message)}</p>`).join('')}</div>`
        : ''}
    `;
  };

  ctx.buildCurrentDnaSequence = function buildCurrentDnaSequence() {
    const payload = {
      constructName: elements.proteinBuilderNameInput?.value,
      poiName: elements.proteinBuilderPoiNameInput?.value,
      poiSequence: elements.proteinBuilderPoiSequenceInput?.value,
      rows: ctx.currentRows()
    };
    const dnaConstruct = buildDnaConstruct(payload, {
      record: ctx.getSelectedRecord(),
      selectedFeature: ctx.getSelectedFeature()
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

    const noteText = state.dnaConstruct.notes.length ? ` ${state.dnaConstruct.notes.join(' ')}` : '';
    ctx.setBuilderStatus(`Built ${state.dnaConstruct.length} nt DNA sequence from the current protein chain.${noteText}`);
    return state.dnaConstruct;
  };
}
