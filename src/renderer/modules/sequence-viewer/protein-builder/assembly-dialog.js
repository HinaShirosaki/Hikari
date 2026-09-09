import { escapeHtml } from '../../../lib/html.js';
import { cleanText } from '../shared.js';
import { buildStoredBackboneDisplayName, formatStoredBackboneDate } from './assembly-payload.js';
import { escapeAttribute } from './row-factory.js';

export function installProteinBuilderAssemblyDialog(ctx) {
  const { elements, state } = ctx;

  ctx.renderAssemblyDialog = function renderAssemblyDialog() {
    if (elements.proteinBuilderAssemblyOverlay) {
      elements.proteinBuilderAssemblyOverlay.hidden = !state.assemblyDialogOpen;
    }

    const selectedBackbone = ctx.getSelectedStoredBackbone();
    const canAdvanceToReview = Boolean(selectedBackbone && state.dnaConstruct?.ok && state.dnaConstruct?.sequence);
    const constructName = ctx.resolveConstructName();
    if (elements.proteinBuilderAssemblyList) {
      if (state.isLoadingAssemblyBackbones) {
        elements.proteinBuilderAssemblyList.innerHTML = '<p class="small-note">Loading stored backbones...</p>';
      } else if (!ctx.hasStoragePath()) {
        elements.proteinBuilderAssemblyList.innerHTML = '<p class="small-note">Set Storage Folder Path in Settings to browse stored backbones.</p>';
      } else if (!state.storedBackbones.length) {
        elements.proteinBuilderAssemblyList.innerHTML = '<p class="small-note">No stored backbones yet. Use Recognize Backbone/Insert on a vector to create one.</p>';
      } else {
        elements.proteinBuilderAssemblyList.innerHTML = state.storedBackbones.map((backbone) => {
          const isActive = cleanText(backbone?.id, 400) === cleanText(state.selectedBackboneId, 400);
          const variantLabel = backbone?.variantMode === 'restriction' ? 'Restriction' : 'Gibson / HR';
          const updatedLabel = formatStoredBackboneDate(backbone?.updatedAt);
          const metaParts = [
            `${Math.max(0, Number(backbone?.backboneLength) || 0).toLocaleString()} bp backbone`,
            Math.max(0, Number(backbone?.insertLength) || 0)
              ? `${Math.max(0, Number(backbone?.insertLength) || 0).toLocaleString()} bp prior insert`
              : '',
            cleanText(backbone?.sourceKind, 120) === 'library_entry'
              ? `${Math.max(0, Number(backbone?.featureCount) || 0).toLocaleString()} feature${Math.max(0, Number(backbone?.featureCount) || 0) === 1 ? '' : 's'}`
              : '',
            variantLabel,
            updatedLabel ? `Updated ${updatedLabel}` : ''
          ].filter(Boolean);
          const noteParts = [
            cleanText(backbone?.sourceKind, 120) === 'library_entry'
              ? 'Saved Sequence Library entry'
              : 'Recognized Protein Builder backbone',
            cleanText(backbone?.sourceRecordName, 160) ? `Source: ${cleanText(backbone?.sourceRecordName, 160)}` : '',
            cleanText(backbone?.promoterName, 160) ? `Promoter: ${cleanText(backbone?.promoterName, 160)}` : ''
          ].filter(Boolean);
          return `
            <button
              type="button"
              class="sequence-viewer-backbone-dialog-candidate${isActive ? ' sequence-viewer-backbone-dialog-candidate-active' : ''}"
              data-protein-builder-backbone-id="${escapeAttribute(backbone?.id || '')}"
            >
              <span class="sequence-viewer-backbone-dialog-candidate-name">${escapeHtml(buildStoredBackboneDisplayName(backbone))}</span>
              <span class="sequence-viewer-backbone-dialog-candidate-meta">${escapeHtml(metaParts.join(' | '))}</span>
              <span class="sequence-viewer-backbone-dialog-candidate-note">${escapeHtml(noteParts.join(' | ') || 'Stored Protein Builder backbone.')}</span>
            </button>
          `;
        }).join('');
      }
    }

    if (elements.proteinBuilderAssemblySummary) {
      if (!state.dnaConstruct?.ok || !state.dnaConstruct?.sequence) {
        elements.proteinBuilderAssemblySummary.innerHTML = '<p class="small-note">Build the current DNA sequence before assembling a plasmid.</p>';
      } else if (!selectedBackbone) {
        elements.proteinBuilderAssemblySummary.innerHTML = '<p class="small-note">Choose a stored backbone to preview the assembled plasmid length.</p>';
      } else {
        const totalLength = Math.max(0, Number(selectedBackbone?.backboneLength) || 0) + Math.max(0, Number(state.dnaConstruct.length) || 0);
        elements.proteinBuilderAssemblySummary.innerHTML = [
          `<p><strong>Construct:</strong> ${escapeHtml(constructName)}</p>`,
          `<p><strong>Stored Backbone:</strong> ${escapeHtml(buildStoredBackboneDisplayName(selectedBackbone))}</p>`,
          `<p><strong>Backbone DNA:</strong> ${Math.max(0, Number(selectedBackbone?.backboneLength) || 0).toLocaleString()} bp</p>`,
          `<p><strong>Current Insert DNA:</strong> ${Math.max(0, Number(state.dnaConstruct.length) || 0).toLocaleString()} bp</p>`,
          `<p><strong>Estimated Circular Plasmid:</strong> ${totalLength.toLocaleString()} bp</p>`,
          cleanText(selectedBackbone?.sourceRecordName, 160)
            ? `<p><strong>Stored From:</strong> ${escapeHtml(cleanText(selectedBackbone.sourceRecordName, 160))}</p>`
            : '',
          cleanText(selectedBackbone?.promoterName, 160)
            ? `<p><strong>Promoter:</strong> ${escapeHtml(cleanText(selectedBackbone.promoterName, 160))}</p>`
            : ''
        ].filter(Boolean).join('');
      }
    }

    if (elements.proteinBuilderAssemblyApplyBtn) {
      elements.proteinBuilderAssemblyApplyBtn.hidden = !canAdvanceToReview;
      elements.proteinBuilderAssemblyApplyBtn.disabled = state.isLoadingAssemblyBackbones
        || state.isPreparingAssembly
        || !canAdvanceToReview;
    }
  };
}
