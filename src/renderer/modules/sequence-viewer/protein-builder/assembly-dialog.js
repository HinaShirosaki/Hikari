import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("dna");
import { escapeHtml } from '../../../lib/html.js';
import { cleanText } from '../shared.js';
import { buildStoredBackboneDisplayName } from './assembly-payload.js';
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
        i18nUi.setHtml(elements.proteinBuilderAssemblyList, `<p class="small-note">${i18nUi.html("Loading stored backbones...")}</p>`);
      } else if (!ctx.hasStoragePath()) {
        i18nUi.setHtml(elements.proteinBuilderAssemblyList, `<p class="small-note">${i18nUi.html("Set Storage Folder Path in Settings to browse stored backbones.")}</p>`);
      } else if (!state.storedBackbones.length) {
        i18nUi.setHtml(elements.proteinBuilderAssemblyList, `<p class="small-note">${i18nUi.html("No stored backbones yet. Use Recognize Backbone/Insert on a vector to create one.")}</p>`);
      } else {
        i18nUi.setHtml(elements.proteinBuilderAssemblyList, state.storedBackbones.map((backbone) => {
          const isActive = cleanText(backbone?.id, 400) === cleanText(state.selectedBackboneId, 400);
          const name = buildStoredBackboneDisplayName(backbone);
          const source = cleanText(backbone?.sourceRecordName, 160);
          const meta = [
            `${Math.max(0, Number(backbone?.backboneLength) || 0).toLocaleString()} bp`,
            backbone?.variantMode === 'restriction' ? 'Restriction' : 'Gibson / HR',
            cleanText(backbone?.promoterName, 160),
            source && !name.includes(source) ? `from ${source}` : ''
          ].filter(Boolean).join(' \u00b7 ');
          return `
            <button
              type="button"
              class="sequence-viewer-backbone-dialog-candidate${isActive ? ' sequence-viewer-backbone-dialog-candidate-active' : ''}"
              data-protein-builder-backbone-id="${escapeAttribute(backbone?.id || '')}"
            >
              <span class="sequence-viewer-backbone-dialog-candidate-name">${escapeHtml(name)}</span>
              <span class="sequence-viewer-backbone-dialog-candidate-meta">${escapeHtml(meta)}</span>
            </button>
          `;
        }).join(''));
      }
    }

    if (elements.proteinBuilderAssemblySummary) {
      if (!state.dnaConstruct?.ok || !state.dnaConstruct?.sequence) {
        i18nUi.setHtml(elements.proteinBuilderAssemblySummary, `<p class="small-note">${i18nUi.html("Build the current DNA sequence before assembling a plasmid.")}</p>`);
      } else if (!selectedBackbone) {
        i18nUi.setHtml(elements.proteinBuilderAssemblySummary, `<p class="small-note">${i18nUi.html("Choose a stored backbone to preview the assembled plasmid length.")}</p>`);
      } else {
        const totalLength = Math.max(0, Number(selectedBackbone?.backboneLength) || 0) + Math.max(0, Number(state.dnaConstruct.length) || 0);
        i18nUi.setHtml(elements.proteinBuilderAssemblySummary, [
          `<p><strong>${i18nUi.html("Construct:")}</strong> ${escapeHtml(constructName)}</p>`,
          `<p><strong>${i18nUi.html("Stored Backbone:")}</strong> ${escapeHtml(buildStoredBackboneDisplayName(selectedBackbone))}</p>`,
          `<p><strong>${i18nUi.html("Backbone DNA:")}</strong> ${Math.max(0, Number(selectedBackbone?.backboneLength) || 0).toLocaleString()} bp</p>`,
          `<p><strong>${i18nUi.html("Current Insert DNA:")}</strong> ${Math.max(0, Number(state.dnaConstruct.length) || 0).toLocaleString()} bp</p>`,
          `<p><strong>${i18nUi.html("Estimated Circular Plasmid:")}</strong> ${totalLength.toLocaleString()} bp</p>`,
          cleanText(selectedBackbone?.sourceRecordName, 160)
            ? `<p><strong>${i18nUi.html("Stored From:")}</strong> ${escapeHtml(cleanText(selectedBackbone.sourceRecordName, 160))}</p>`
            : '',
          cleanText(selectedBackbone?.promoterName, 160)
            ? `<p><strong>${i18nUi.html("Promoter:")}</strong> ${escapeHtml(cleanText(selectedBackbone.promoterName, 160))}</p>`
            : ''
        ].filter(Boolean).join(''));
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
