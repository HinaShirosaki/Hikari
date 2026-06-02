export function installChemicalDetailRendering(ctx) {
  const { safeText, state } = ctx;
  const { chemicalDetailPanel, chemicalDetailTitle, chemicalDetailContent, blockchainList } = ctx.elements;

function renderChemicalDetail() {
  const selected = state.labInventory.chemicals.find((item) => item.id === ctx.selectedChemicalId);
  if (!selected) {
    chemicalDetailPanel.hidden = true;
    chemicalDetailContent.innerHTML = '';
    return;
  }

  chemicalDetailPanel.hidden = false;
  chemicalDetailTitle.textContent = selected.name || 'Chemical Details';
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
    { label: 'CAS', value: selected.casNumber || '-' },
    { label: 'Code', value: locationCodeText },
    { label: 'Location', value: locationText },
    { label: 'Updated', value: selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '-' },
    { label: 'Vendor', value: selected.vendor || '-' },
    { label: 'Catalog', value: selected.catalogNumber || '-' },
    { label: 'Unit Size', value: selected.unitSize || '-' },
    { label: 'Price', value: selected.price || '-' },
    { label: 'Stock', value: selected.amountInStock || '-' },
    { label: 'Expiration', value: selected.expirationDate || '-' },
    { label: 'URL', value: selected.url || '-', wide: true },
    { label: 'Linked Samples', value: linkedSamples.join(', ') || '-', wide: true }
  ];
  const detailMarkup = details.map((item) => `
    <div class="chemical-detail-item${item.wide ? ' chemical-detail-item-wide' : ''}">
      <span class="chemical-detail-label">${safeText(item.label)}</span>
      <span class="chemical-detail-value">${safeText(item.value)}</span>
    </div>
  `).join('');

  chemicalDetailContent.innerHTML = `<div class="chemical-detail-grid">${detailMarkup}</div>`;
}

function renderBlockchain() {
  const blocks = state.labInventory.blocks;
  if (!blocks.length) {
    blockchainList.innerHTML = '<p class="small-note">No blockchain records yet.</p>';
    return;
  }

  blockchainList.innerHTML = blocks.slice().reverse().map((block) => `
    <article class="card">
      <p><strong>#${block.index}</strong> ${safeText(block.action)} - ${new Date(block.timestamp).toLocaleString()}</p>
      <p><strong>Hash:</strong> ${safeText(block.hash)}</p>
      <p><strong>Prev:</strong> ${safeText(block.prevHash)}</p>
    </article>
  `).join('');
}

  Object.assign(ctx, {
    renderChemicalDetail,
    renderBlockchain
  });
}
