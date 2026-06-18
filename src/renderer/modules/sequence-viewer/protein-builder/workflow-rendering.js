import { escapeHtml } from '../../tool-box/common.js';
import { sanitizeProteinAssemblySequence } from '../../tool-box/protein-assembly.js';
import { cleanText } from '../shared.js';
import { getBlockTypeLabel } from './constants.js';
import { buildConstruct } from './protein-construct.js';
import { escapeAttribute } from './row-factory.js';

export function installProteinBuilderWorkflowRendering(ctx) {
  const { elements, state } = ctx;

  ctx.renderWorkflow = function renderWorkflow() {
    if (!elements.proteinBuilderWorkflow) {
      return;
    }

    const poiName = cleanText(elements.proteinBuilderPoiNameInput?.value, 140) || 'Protein of Interest';
    const poiSequence = sanitizeProteinAssemblySequence(elements.proteinBuilderPoiSequenceInput?.value || '', true);

    if (!state.rows.length) {
      elements.proteinBuilderWorkflow.innerHTML = '<p class="small-note">Add a block to start the chain.</p>';
      return;
    }

    elements.proteinBuilderWorkflow.innerHTML = state.rows.map((row, index) => {
      const label = row.type === 'poi' ? poiName : row.label;
      const sequence = row.type === 'poi' ? poiSequence : sanitizeProteinAssemblySequence(row.sequence || '', true);
      const note = row.type === 'poi'
        ? `Uses the POI sequence from the left column. ${sequence.length ? `${sequence.length} aa.` : 'Sequence required.'}`
        : (row.note || 'No annotation.');
      const blockTitle = [getBlockTypeLabel(row.type), `${sequence.length} aa`, note].filter(Boolean).join(' | ');

      const customFields = row.kind === 'custom'
        ? `
          <div class="sequence-viewer-protein-builder-custom-fields">
            <label>
              Label
              <input
                type="text"
                value="${escapeAttribute(row.label)}"
                data-protein-builder-custom-label="${escapeAttribute(row.id)}"
              />
            </label>
            <label>
              Sequence
              <input
                type="text"
                value="${escapeAttribute(row.sequence)}"
                data-protein-builder-custom-sequence="${escapeAttribute(row.id)}"
                placeholder="Amino-acid sequence"
              />
            </label>
          </div>
        `
        : '';

      const connector = index > 0
        ? '<div class="sequence-viewer-protein-builder-link" aria-hidden="true"><span></span></div>'
        : '';
      const canMoveLeft = index > 0;
      const canMoveRight = index < state.rows.length - 1;

      return `
        ${connector}
        <article class="sequence-viewer-protein-builder-block sequence-viewer-protein-builder-block-${escapeAttribute(row.type)}" data-protein-builder-row-id="${escapeAttribute(row.id)}">
          <div
            class="sequence-viewer-protein-builder-block-shape"
            title="${escapeAttribute(blockTitle)}"
          >
            <span class="sequence-viewer-protein-builder-block-label">${escapeHtml(label || `Block ${index + 1}`)}</span>
          </div>
          <div class="form-actions sequence-viewer-protein-builder-block-actions">
            ${canMoveLeft ? `
              <button
                type="button"
                class="ghost-btn sequence-viewer-protein-builder-icon-btn"
                data-protein-builder-row-up="${escapeAttribute(row.id)}"
                aria-label="Move block left"
                title="Move block left"
              >
                <span aria-hidden="true">&larr;</span>
                <span class="sr-only">Move block left</span>
              </button>
            ` : ''}
            ${canMoveRight ? `
              <button
                type="button"
                class="ghost-btn sequence-viewer-protein-builder-icon-btn"
                data-protein-builder-row-down="${escapeAttribute(row.id)}"
                aria-label="Move block right"
                title="Move block right"
              >
                <span aria-hidden="true">&rarr;</span>
                <span class="sr-only">Move block right</span>
              </button>
            ` : ''}
            <button
              type="button"
              class="ghost-btn sequence-viewer-protein-builder-icon-btn sequence-viewer-protein-builder-icon-btn-remove"
              data-protein-builder-row-remove="${escapeAttribute(row.id)}"
              aria-label="Remove block"
              title="Remove block"
            >
              <span aria-hidden="true">&times;</span>
              <span class="sr-only">Remove block</span>
            </button>
          </div>
          ${customFields}
        </article>
      `;
    }).join('');
  };

  ctx.renderSummary = function renderSummary() {
    const construct = buildConstruct({
      constructName: elements.proteinBuilderNameInput?.value,
      poiName: elements.proteinBuilderPoiNameInput?.value,
      poiSequence: elements.proteinBuilderPoiSequenceInput?.value,
      rows: ctx.currentRows()
    });

    if (elements.proteinBuilderMeta) {
      elements.proteinBuilderMeta.textContent = `${construct.length} aa | ${construct.parts.length} blocks`;
    }

    if (elements.proteinBuilderSequence) {
      elements.proteinBuilderSequence.innerHTML = construct.sequence
        ? `<span class="sequence-viewer-protein-builder-sequence-text">${escapeHtml(construct.sequence)}</span>`
        : '-';
    }
  };

  ctx.render = function render() {
    ctx.renderCommonBlocks();
    ctx.renderFeatureSearchResults();
    ctx.renderWorkflow();
    ctx.renderSummary();
    ctx.renderDnaConstruct();
    ctx.renderAssemblyDialog();
    ctx.syncFeatureSearchControls();
    if (!state.featureSearchQuery) {
      ctx.setFeatureSearchStatus(
        ctx.hasStoragePath()
          ? 'Search stored features and convert them into protein blocks.'
          : 'Set Storage Folder Path in Settings to search stored features.',
        !ctx.hasStoragePath()
      );
    }
    ctx.setBuilderStatus(state.statusMessage, state.statusError);
  };
}
