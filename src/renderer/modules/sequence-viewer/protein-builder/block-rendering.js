import { escapeHtml } from '../../../lib/html.js';
import { cleanText } from '../shared.js';
import { COMMON_BLOCK_GROUPS } from './constants.js';
import { buildFeatureResultMeta } from './feature-meta.js';
import { escapeAttribute, formatCount, previewSequence } from './row-factory.js';

export function installProteinBuilderBlockRendering(ctx) {
  const { elements, state } = ctx;

  function renderCommonGroup(group) {
    const itemsMarkup = group.items.map((item) => `
      <button
        type="button"
        class="sequence-viewer-protein-builder-common-item"
        data-protein-builder-add-library-type="${escapeAttribute(group.id)}"
        data-protein-builder-add-library-id="${escapeAttribute(item.id)}"
      >
        <span class="sequence-viewer-protein-builder-common-item-name">${escapeHtml(item.label)}</span>
        <span class="sequence-viewer-protein-builder-common-item-meta">${escapeHtml(`${item.sequence.length} aa`)}</span>
      </button>
    `).join('');

    if (group.id === 'tag' || group.id === 'linker') {
      return `
        <details class="sequence-viewer-protein-builder-common-fold">
          <summary>
            <span>${escapeHtml(group.label)}</span>
            <span class="sequence-viewer-protein-builder-common-fold-meta">${escapeHtml(formatCount(group.items.length, 'block'))}</span>
          </summary>
          <div class="sequence-viewer-protein-builder-common-list">
            ${itemsMarkup}
          </div>
        </details>
      `;
    }

    return `
      <section class="sequence-viewer-protein-builder-common-group">
        <h5>${escapeHtml(group.label)}</h5>
        <div class="sequence-viewer-protein-builder-common-list">
          ${itemsMarkup}
        </div>
      </section>
    `;
  }

  ctx.renderCommonBlocks = function renderCommonBlocks() {
    if (!elements.proteinBuilderCommonBlocks) {
      return;
    }
    elements.proteinBuilderCommonBlocks.innerHTML = COMMON_BLOCK_GROUPS.map((group) => renderCommonGroup(group)).join('');
  };

  ctx.renderFeatureSearchResults = function renderFeatureSearchResults() {
    if (!elements.proteinBuilderFeatureSearchResults) {
      return;
    }

    const query = cleanText(state.featureSearchQuery, 600);
    const results = Array.isArray(state.featureSearchResults) ? state.featureSearchResults : [];
    if (!query) {
      elements.proteinBuilderFeatureSearchResults.innerHTML = '<p class="small-note">Search by feature name or stored sequence.</p>';
      return;
    }
    if (!results.length) {
      elements.proteinBuilderFeatureSearchResults.innerHTML = `<p class="small-note">No stored features matched "${escapeHtml(query)}".</p>`;
      return;
    }

    elements.proteinBuilderFeatureSearchResults.innerHTML = results.map((feature) => {
      const meta = buildFeatureResultMeta(feature);
      return `
        <article class="sequence-viewer-protein-builder-feature-item">
          <div class="sequence-viewer-protein-builder-feature-head">
            <div>
              <strong>${escapeHtml(feature?.name || 'feature')}</strong>
              <p class="small-note">${escapeHtml(feature?.type || 'feature')} | ${escapeHtml(meta.lengthText)} | ${escapeHtml(meta.hostText)}</p>
            </div>
            <button
              type="button"
              class="ghost-btn"
              data-protein-builder-feature-add-id="${escapeAttribute(feature?.id || '')}"
            >
              Add Block
            </button>
          </div>
          <p class="sequence-viewer-protein-builder-feature-sequence">${escapeHtml(previewSequence(meta.sequence || feature?.sequence || ''))}</p>
          ${meta.warnings.length
            ? `<p class="small-note">${escapeHtml(meta.warnings.join(' | '))}</p>`
            : ''}
        </article>
      `;
    }).join('');
  };
}
