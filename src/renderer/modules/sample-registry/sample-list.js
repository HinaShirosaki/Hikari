import { formatCellPassage } from './cell-passage.js';
import {
  formatCompoundStructureSummary,
  isChemicalStructureSampleType,
  normalizeCompoundStructureData
} from './compound-model.js';
import { renderCompoundPreviewMarkup } from './compound-preview.js';
import { formatChemicalLinks, formatInventoryLink } from './inventory-links.js';
import { formatLocation } from './location-fields.js';
import { ensureSampleState, escapeHtml, formatSampleTypeLabel } from './sample-utils.js';

export function onListClick(ctx, event) {
  const openBtn = event.target.closest('[data-sample-open]');
  if (!openBtn) {
    return;
  }
  ctx.selectedSampleId = openBtn.dataset.sampleOpen || '';
  renderList(ctx);
}

export function matchesSearch(ctx, sample, term) {
  if (!term) {
    return true;
  }
  const haystack = [
    sample.code,
    sample.name,
    sample.type,
    formatSampleTypeLabel(sample.type, ctx.state.settings),
    sample.lot,
    sample.concentration,
    sample.cellPassage?.lastPassageDate,
    sample.cellPassage?.intervalDays,
    formatLocation(sample.location),
    formatInventoryLink(ctx, sample.inventoryLink),
    sample.notes,
    sample.compoundStructure?.smiles
  ].join(' ').toLowerCase();
  return haystack.includes(term);
}

export function renderList(ctx) {
  const {
    sampleRegistryList,
    sampleResultsSummary,
    sampleSearchInput
  } = ctx.dom;
  ensureSampleState(ctx);
  const term = String(sampleSearchInput?.value || '').trim().toLowerCase();
  const rows = ctx.state.samples
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .filter((item) => matchesSearch(ctx, item, term));

  if (sampleResultsSummary) {
    sampleResultsSummary.textContent = `Showing ${rows.length} of ${ctx.state.samples.length} samples.`;
  }

  if (!rows.length) {
    ctx.selectedSampleId = '';
    sampleRegistryList.innerHTML = '<p class="small-note">No samples found.</p>';
    renderSampleDetail(ctx);
    return;
  }

  if (!ctx.selectedSampleId || !rows.some((item) => item.id === ctx.selectedSampleId)) {
    ctx.selectedSampleId = rows[0]?.id || '';
  }

  const bodyRows = rows.map((sample) => `
    <article class="list-row${ctx.selectedSampleId === sample.id ? ' list-row-selected' : ''}">
      <button class="list-main-btn text-list-btn" data-sample-open="${escapeHtml(sample.id)}">
        ${ctx.safeText(sample.code || sample.id)} - ${ctx.safeText(sample.name)}
      </button>
      <span>${ctx.safeText(formatSampleTypeLabel(sample.type || '-', ctx.state.settings))}</span>
      <span>${ctx.safeText(formatLocation(sample.location))}</span>
    </article>
  `).join('');

  sampleRegistryList.innerHTML = `
    <article class="list-row list-row-header">
      <strong>Sample</strong>
      <strong>Type</strong>
      <strong>Location</strong>
    </article>
    ${bodyRows}
  `;

  renderSampleDetail(ctx);
}

export function renderSampleDetail(ctx) {
  const { sampleDetailContent, sampleDetailPanel, sampleDetailTitle } = ctx.dom;
  const selected = (ctx.state.samples || []).find((item) => item.id === ctx.selectedSampleId);
  if (!selected) {
    if (sampleDetailPanel) {
      sampleDetailPanel.hidden = true;
    }
    if (sampleDetailContent) {
      sampleDetailContent.innerHTML = '';
    }
    return;
  }

  if (sampleDetailPanel) {
    sampleDetailPanel.hidden = false;
  }
  if (sampleDetailTitle) {
    sampleDetailTitle.textContent = selected.code
      ? `${selected.code} - ${selected.name || 'Sample Details'}`
      : (selected.name || 'Sample Details');
  }

  const structure = normalizeCompoundStructureData(selected.compoundStructure);
  const detailItems = [
    { label: 'Type', value: formatSampleTypeLabel(selected.type || '-', ctx.state.settings) },
    { label: 'Lot / Batch', value: selected.lot || '-' },
    { label: 'Concentration', value: selected.concentration || '-' },
    { label: 'Location', value: formatLocation(selected.location) },
    { label: 'Inventory Link', value: formatInventoryLink(ctx, selected.inventoryLink) },
    { label: 'Related Chemicals', value: formatChemicalLinks(ctx, selected.chemicalLinks), wide: true }
  ];
  if (selected.type === 'cell_line') {
    detailItems.push({ label: 'Passage', value: formatCellPassage(selected.cellPassage), wide: true });
  }
  if (isChemicalStructureSampleType(selected.type)) {
    detailItems.push({ label: 'Structure', value: formatCompoundStructureSummary(structure), wide: true });
  }
  detailItems.push(
    { label: 'Updated', value: selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '-' },
    { label: 'Notes', value: selected.notes || '-', wide: true }
  );
  const detailMarkup = detailItems.map((item) => `
    <div class="sample-detail-item${item.wide ? ' sample-detail-item-wide' : ''}">
      <span class="sample-detail-label">${ctx.safeText(item.label)}</span>
      <span class="sample-detail-value">${ctx.safeText(item.value)}</span>
    </div>
  `).join('');

  const structureMarkup = isChemicalStructureSampleType(selected.type)
    ? renderCompoundPreviewMarkup(structure, selected.name || selected.code || 'Chemical', ctx.safeText)
    : '';

  sampleDetailContent.innerHTML = `
    ${structureMarkup}
    <div class="sample-detail-grid">${detailMarkup}</div>
  `;
}
