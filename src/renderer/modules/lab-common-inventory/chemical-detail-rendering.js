import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("chemicals");
import { dateSpan } from '../../lib/i18n/markup.js';
import { chemicalMessage, setChemicalText } from './localization.js';

const TIMESTAMP_OPTIONS = Object.freeze({
  year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric'
});

export function installChemicalDetailRendering(ctx) {
  const { safeText, state } = ctx;
  const { chemicalDetailPanel, chemicalDetailTitle, chemicalDetailContent, blockchainList } = ctx.elements;

function renderChemicalDetail() {
  const selected = state.labInventory.chemicals.find((item) => item.id === ctx.selectedChemicalId);
  if (!selected) {
    chemicalDetailPanel.hidden = true;
    i18nUi.setHtml(chemicalDetailContent, '');
    return;
  }

  chemicalDetailPanel.hidden = false;
  if (selected.name) {
    chemicalDetailTitle.removeAttribute?.('data-i18n');
    chemicalDetailTitle.removeAttribute?.('data-i18n-params');
    i18nUi.setText(chemicalDetailTitle, selected.name);
  } else setChemicalText(chemicalDetailTitle, 'detail.title');
  const linkedSamples = (state.samples || [])
    .filter((sample) => Array.isArray(sample.chemicalLinks) && sample.chemicalLinks.includes(selected.id))
    .map((sample) => sample.code || sample.name || sample.id);
  const locationText = selected.locationCode
    ? `${selected.location} (${selected.locationCode})`
    : (selected.locationNumber
      ? `${selected.location} #${selected.locationNumber}`
      : (selected.location || '-'));
  const locationCodeText = selected.locationCode
    ? String(selected.locationCode)
    : '-';
  const details = [
    { key: 'detail.cas', value: selected.casNumber || '-' },
    { key: 'list.code', value: locationCodeText },
    { key: 'field.location', value: locationText },
    { key: 'detail.updated', value: selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '-', date: selected.updatedAt },
    { key: 'field.vendor', value: selected.vendor || '-' },
    { key: 'detail.catalog', value: selected.catalogNumber || '-' },
    { key: 'field.unitSize', value: selected.unitSize || '-' },
    { key: 'field.price', value: selected.price || '-' },
    { key: 'detail.stock', value: selected.amountInStock || '-' },
    { key: 'detail.expiration', value: selected.expirationDate || '-' },
    { key: 'field.url', value: selected.url || '-', wide: true },
    { key: 'detail.linkedSamples', value: linkedSamples.join(', ') || '-', wide: true }
  ];
  const detailMarkup = details.map((item) => `
    <div class="chemical-detail-item${item.wide ? ' chemical-detail-item-wide' : ''}">
      <span class="chemical-detail-label">${chemicalMessage(item.key)}</span>
      <span class="chemical-detail-value">${item.date ? dateSpan(item.date, item.value, TIMESTAMP_OPTIONS) : safeText(item.value)}</span>
    </div>
  `).join('');

  i18nUi.setHtml(chemicalDetailContent, `<div class="chemical-detail-grid">${detailMarkup}</div>`);
}

function renderBlockchain() {
  const blocks = state.labInventory.blocks;
  if (!blocks.length) {
    i18nUi.setHtml(blockchainList, `<p class="small-note">${chemicalMessage('audit.empty')}</p>`);
    return;
  }

  i18nUi.setHtml(blockchainList, blocks.slice().reverse().map((block) => `
    <article class="card">
      <p><strong>#${block.index}</strong> ${safeText(block.action)} - ${dateSpan(block.timestamp, new Date(block.timestamp).toLocaleString(), TIMESTAMP_OPTIONS)}</p>
      <p><strong>${chemicalMessage('audit.hash')}</strong> ${safeText(block.hash)}</p>
      <p><strong>${chemicalMessage('audit.previous')}</strong> ${safeText(block.prevHash)}</p>
    </article>
  `).join(''));
}

  Object.assign(ctx, {
    renderChemicalDetail,
    renderBlockchain
  });
}
