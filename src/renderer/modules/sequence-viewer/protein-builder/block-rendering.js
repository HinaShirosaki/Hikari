import { escapeHtml } from '../../../lib/html.js';
import { buildSequenceMapSvg } from '../vector-builder/sequence-map.js';
import { cleanText } from '../shared.js';
import { COMMON_BLOCK_GROUPS } from './constants.js';
import { buildFeatureResultMeta } from './feature-meta.js';
import { escapeAttribute, formatCount, previewSequence } from './row-factory.js';

export function installProteinBuilderBlockRendering(ctx) {
  const { elements, state } = ctx;

  ctx.syncFeatureSourceAddControl = function syncFeatureSourceAddControl() {
    if (!elements.proteinBuilderFeatureAddBtn) {
      return;
    }
    const host = ctx.getSelectedSearchHost?.();
    const record = host
      ? state.featureHostRecords.get(cleanText(host.hostVectorId, 200))
      : null;
    elements.proteinBuilderFeatureAddBtn.disabled = !record?.sequence?.length;
  };

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
      const featureId = cleanText(feature?.id, 200);
      const selected = featureId && featureId === cleanText(state.featureSelectedId, 200);
      return `
        <article
          class="sequence-viewer-protein-builder-feature-item${selected ? ' is-selected' : ''}"
          role="button"
          tabindex="0"
          aria-pressed="${selected ? 'true' : 'false'}"
          data-protein-builder-feature-select-id="${escapeAttribute(featureId)}"
        >
          <div class="sequence-viewer-protein-builder-feature-head">
            <div>
              <strong>${escapeHtml(feature?.name || 'feature')}</strong>
              <p class="small-note">${escapeHtml(feature?.type || 'feature')} | ${escapeHtml(meta.lengthText)} | ${escapeHtml(meta.hostText)}</p>
            </div>
          </div>
          <p class="sequence-viewer-protein-builder-feature-sequence">${escapeHtml(previewSequence(meta.sequence || feature?.sequence || ''))}</p>
          ${meta.warnings.length
            ? `<p class="small-note">${escapeHtml(meta.warnings.join(' | '))}</p>`
            : ''}
        </article>
      `;
    }).join('');
    ctx.renderFeatureSourcePanel();
  };

  // The picked feature's source vectors, and the plasmid the chosen one sits in.
  ctx.renderFeatureSourcePanel = function renderFeatureSourcePanel() {
    const feature = ctx.getSelectedSearchFeature();
    if (elements.proteinBuilderFeatureSource) {
      elements.proteinBuilderFeatureSource.hidden = !feature;
    }
    if (!feature) {
      ctx.syncFeatureSourceAddControl();
      return;
    }
    const hosts = ctx.getSearchFeatureHosts(feature);
    if (elements.proteinBuilderFeatureHosts) {
      elements.proteinBuilderFeatureHosts.innerHTML = hosts.length
        ? hosts.map((entry) => {
          const hostId = cleanText(entry?.hostVectorId, 200);
          const selected = hostId === cleanText(state.featureHostId, 200);
          const length = Math.max(0, Number(entry?.sequenceLength) || 0);
          const copies = (Array.isArray(entry?.locations) ? entry.locations : []).length;
          return `
            <button
              type="button"
              class="sequence-viewer-feature-source-item${selected ? ' is-selected' : ''}"
              aria-pressed="${selected ? 'true' : 'false'}"
              data-protein-builder-feature-host-id="${escapeAttribute(hostId)}"
            >
              <strong>${escapeHtml(cleanText(entry?.hostVectorName, 160) || 'stored vector')}</strong>
              <span class="small-note">${length.toLocaleString()} bp | ${escapeHtml(cleanText(entry?.topology, 40) || 'circular')} | ${copies} copy${copies === 1 ? '' : ' sites'}</span>
            </button>
          `;
        }).join('')
        : '<p class="small-note">No source vector is recorded for this feature.</p>';
    }
    ctx.renderFeatureSourcePreview();
  };

  ctx.renderFeatureSourcePreview = function renderFeatureSourcePreview(message = '') {
    ctx.syncFeatureSourceAddControl();
    if (!elements.proteinBuilderFeaturePreview) {
      return;
    }
    const host = ctx.getSelectedSearchHost();
    const record = host
      ? state.featureHostRecords.get(cleanText(host.hostVectorId, 200))
      : null;
    if (record?.sequence?.length) {
      elements.proteinBuilderFeaturePreview.innerHTML = buildSequenceMapSvg(
        record,
        { features: Array.isArray(record.features) ? record.features : [] }
      );
      return;
    }
    elements.proteinBuilderFeaturePreview.innerHTML = `<p class="small-note">${escapeHtml(message
      || (host ? 'Loading plasmid preview...' : 'Pick a source vector to preview it.'))}</p>`;
  };
}
