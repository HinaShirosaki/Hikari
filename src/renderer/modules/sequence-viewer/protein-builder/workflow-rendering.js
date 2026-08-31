import { escapeHtml } from '../../../lib/html.js';
import { sanitizeProteinAssemblySequence } from './assembly-model.js';
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

    const activeDnaSource = ctx.getCurrentDnaSource() || {};
    const sourceName = cleanText(activeDnaSource.label, 140) || 'Current DNA';
    const sourceSequence = sanitizeProteinAssemblySequence(activeDnaSource.proteinSequence || '', true);
    const sourceNote = cleanText(activeDnaSource.note, 240) || 'No usable coding sequence was found in the active DNA record.';

    if (!state.rows.length) {
      elements.proteinBuilderWorkflow.innerHTML = '<p class="small-note">Add a block to start the chain.</p>';
      return;
    }

    const parts = state.rows.map((row) => ({
      row,
      label: row.type === 'poi' ? sourceName : row.label,
      sequence: row.type === 'poi' ? sourceSequence : sanitizeProteinAssemblySequence(row.sequence || '', true)
    }));
    const constructLength = parts.reduce((total, part) => total + part.sequence.length, 0);

    const blocks = parts.map(({ row, label, sequence }, index) => {
      // A block that is a few percent of the construct gets a narrower floor and
      // drops its type line, so the ribbon can keep tags looking like tags next
      // to a domain instead of padding everything out to the same slab.
      const isSliver = constructLength > 0 && (sequence.length / constructLength) < 0.06;
      const note = row.type === 'poi'
        ? `${sourceNote} ${sequence.length ? `${sequence.length} aa.` : 'No coding sequence found.'}`
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

      const moveButton = (direction) => `
        <button
          type="button"
          class="sequence-viewer-protein-builder-icon-btn"
          data-protein-builder-row-${direction === 'left' ? 'up' : 'down'}="${escapeAttribute(row.id)}"
          aria-label="Move ${escapeAttribute(label || 'block')} ${direction}"
          title="Move ${direction}"
        >
          <span aria-hidden="true">${direction === 'left' ? '&larr;' : '&rarr;'}</span>
        </button>
      `;

      return `
        <li
          class="sequence-viewer-protein-builder-block sequence-viewer-protein-builder-block-${escapeAttribute(row.type)}${isSliver ? ' sequence-viewer-protein-builder-block-compact' : ''}"
          data-protein-builder-row-id="${escapeAttribute(row.id)}"
          style="--builder-block-aa: ${Math.max(1, sequence.length)}"
        >
          <div class="sequence-viewer-protein-builder-block-shape" title="${escapeAttribute(blockTitle)}">
            <span class="sequence-viewer-protein-builder-block-type">${escapeHtml(getBlockTypeLabel(row.type))}</span>
            <span class="sequence-viewer-protein-builder-block-label">${escapeHtml(label || `Block ${index + 1}`)}</span>
            <span class="sequence-viewer-protein-builder-block-size">${escapeHtml(`${sequence.length} aa`)}</span>
          </div>
          <div class="sequence-viewer-protein-builder-block-actions">
            ${index > 0 ? moveButton('left') : ''}
            ${index < state.rows.length - 1 ? moveButton('right') : ''}
            <button
              type="button"
              class="sequence-viewer-protein-builder-icon-btn sequence-viewer-protein-builder-icon-btn-remove"
              data-protein-builder-row-remove="${escapeAttribute(row.id)}"
              aria-label="Remove ${escapeAttribute(label || 'block')}"
              title="Remove block"
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          ${customFields}
        </li>
      `;
    }).join('');

    // The chain reads N to C, and the termini say so: without them a row of
    // arrows is just a row of arrows.
    elements.proteinBuilderWorkflow.innerHTML = `
      <div class="sequence-viewer-protein-builder-chain-rail">
        <span class="sequence-viewer-protein-builder-terminus">N</span>
        <ol class="sequence-viewer-protein-builder-chain">${blocks}</ol>
        <span class="sequence-viewer-protein-builder-terminus">C</span>
      </div>
    `;
  };

  ctx.renderSummary = function renderSummary() {
    const construct = buildConstruct(ctx.getProteinBuilderPayload());

    if (elements.proteinBuilderMeta) {
      // Annotate the length directly when 2A blocks make it an ORF total rather
      // than the size of a single product.
      const productNote = construct.productCount > 1
        ? ` | ${construct.productCount} products (2A skip)`
        : '';
      elements.proteinBuilderMeta.textContent =
        `${construct.length} aa | ${construct.parts.length} blocks${productNote}`;
    }

    if (elements.proteinBuilderSequence) {
      // Typing into the field must not have the cursor yanked back to the end on
      // every keystroke, so a focused field keeps whatever is in it.
      if (elements.proteinBuilderSequence !== elements.proteinBuilderSequence.ownerDocument?.activeElement) {
        elements.proteinBuilderSequence.value = construct.sequence || '';
      }
    }
    if (elements.proteinBuilderSequenceEdited) {
      elements.proteinBuilderSequenceEdited.hidden = !construct.isEdited;
    }
    if (elements.proteinBuilderSequenceResetBtn) {
      elements.proteinBuilderSequenceResetBtn.hidden = !construct.isEdited;
    }
  };

  ctx.render = function render() {
    ctx.syncSuggestedConstructName();
    ctx.renderCommonBlocks();
    ctx.renderFeatureSearchResults();
    ctx.renderWorkflow();
    ctx.renderSummary();
    ctx.renderDnaConstruct();
    ctx.renderAssemblyDialog();
    ctx.syncVectorInsertControls();
    ctx.syncFeatureSearchControls();
    if (!state.featureSearchQuery) {
      ctx.applyFeatureSearchStatus(
        ctx.hasStoragePath() ? '' : 'Set Storage Folder Path in Settings to search stored features.',
        !ctx.hasStoragePath()
      );
    }
    ctx.applyBuilderStatus();
  };
}
