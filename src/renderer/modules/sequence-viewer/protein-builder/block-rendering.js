import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("dna");
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

  ctx.renderCommonBlocks = function renderCommonBlocks() {
    if (!elements.proteinBuilderCommonBlocks) {
      return;
    }
    i18nUi.setHtml(elements.proteinBuilderCommonBlocks, COMMON_BLOCK_GROUPS.map((group) => renderCommonGroup(group)).join(''));
  };

  ctx.renderFeatureSearchResults = function renderFeatureSearchResults() {
    if (!elements.proteinBuilderFeatureSearchResults) {
      return;
    }

    ctx.renderFeatureSourcePanel();
    const query = cleanText(state.featureSearchQuery, 600);
    const results = Array.isArray(state.featureSearchResults) ? state.featureSearchResults : [];
    // Below the 2-character minimum no search has run, so the panel stays quiet
    // instead of claiming nothing matched.
    if (query.length < 2) {
      i18nUi.setHtml(elements.proteinBuilderFeatureSearchResults, '');
      return;
    }
    if (!results.length) {
      i18nUi.setHtml(elements.proteinBuilderFeatureSearchResults, `<p class="small-note">${i18nUi.html("No stored features matched \"")}${escapeHtml(query)}".</p>`);
      return;
    }

    i18nUi.setHtml(elements.proteinBuilderFeatureSearchResults, results.map((feature) => {
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
              <strong>${i18nUi.render((feature?.name || i18nUi.message("feature")))}</strong>
              <p class="small-note sequence-viewer-protein-picker-meta">
                <span class="sequence-viewer-protein-picker-type">${i18nUi.render((feature?.type || i18nUi.message("feature")))}</span>
                <span>${escapeHtml(meta.lengthText)}</span>
                <span>${escapeHtml(meta.hostText)}</span>
              </p>
            </div>
          </div>
          <p class="sequence-viewer-protein-builder-feature-sequence">${escapeHtml(previewSequence(meta.sequence || feature?.sequence || ''))}</p>
          ${meta.warnings.length
            ? `<p class="small-note">${escapeHtml(meta.warnings.join(' | '))}</p>`
            : ''}
        </article>
      `;
    }).join(''));
  };

  // The picked feature's source vectors, and the plasmid the chosen one sits in.
  ctx.renderFeatureSourcePanel = function renderFeatureSourcePanel() {
    const feature = ctx.getSelectedSearchFeature();
    if (elements.proteinBuilderFeatureSummary) {
      i18nUi.setText(elements.proteinBuilderFeatureSummary, (feature?.name || (feature ? i18nUi.message("Selected protein") : i18nUi.message("Select protein"))));
    }
    if (elements.proteinBuilderFeatureSource) {
      elements.proteinBuilderFeatureSource.hidden = !feature;
    }
    if (!feature) {
      ctx.syncFeatureSourceAddControl();
      return;
    }
    const hosts = ctx.getSearchFeatureHosts(feature);
    if (elements.proteinBuilderFeatureHosts) {
      i18nUi.setHtml(elements.proteinBuilderFeatureHosts, hosts.length
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
              <strong class="sequence-viewer-protein-picker-host-name">${i18nUi.render((cleanText(entry?.hostVectorName, 160) || i18nUi.message("stored vector")))}</strong>
              <span class="small-note">${length.toLocaleString()} bp | ${i18nUi.render((cleanText(entry?.topology, 40) || i18nUi.message("circular")))} | ${copies} ${i18nUi.html("copy")}${i18nUi.render((copies === 1 ? '' : i18nUi.message(" sites")))}</span>
            </button>
          `;
        }).join('')
        : `<p class="small-note">${i18nUi.html("No source vector is recorded for this feature.")}</p>`);
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
      i18nUi.setHtml(elements.proteinBuilderFeaturePreview, buildSequenceMapSvg(
        record,
        { features: Array.isArray(record.features) ? record.features : [] }
      ));
      return;
    }
    i18nUi.setHtml(elements.proteinBuilderFeaturePreview, `<p class="small-note">${i18nUi.render((message || (host ? i18nUi.message("Loading plasmid preview...") : i18nUi.message("Pick a source vector to preview it."))))}</p>`);
  };
}
