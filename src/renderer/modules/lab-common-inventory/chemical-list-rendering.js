export function installChemicalListRendering(ctx) {
  const { safeText, state } = ctx;
  const { chemicalLocation, chemicalFilterLocation, chemicalSort, chemicalSearch, chemicalResultsSummary, chemicalList } = ctx.elements;
  const parseLocationCode = (...args) => ctx.parseLocationCode(...args);
  const renderChemicalDetail = (...args) => ctx.renderChemicalDetail(...args);

function renderLocationOptions() {
  const locations = state.settings.inventoryLocations || [];
  const selected = chemicalLocation.value;
  const selectedFilter = chemicalFilterLocation.value;
  const options = ['<option value="">Select location</option>'];
  const filterOptions = ['<option value="">All locations</option>'];
  locations.forEach((location) => {
    const isSelected = selected === location ? ' selected' : '';
    options.push(`<option value="${safeText(location)}"${isSelected}>${safeText(location)}</option>`);
    const isFilterSelected = selectedFilter === location ? ' selected' : '';
    filterOptions.push(`<option value="${safeText(location)}"${isFilterSelected}>${safeText(location)}</option>`);
  });
  chemicalLocation.innerHTML = options.join('');
  chemicalFilterLocation.innerHTML = filterOptions.join('');
  if (selected && locations.includes(selected)) {
    chemicalLocation.value = selected;
  }
  if (selectedFilter && locations.includes(selectedFilter)) {
    chemicalFilterLocation.value = selectedFilter;
  }
}

function sortChemicals(list) {
  const sortBy = chemicalSort.value || 'updated_desc';
  const next = [...list];
  const locationCodeCompare = (left, right) => {
    const leftParsed = parseLocationCode(left.locationCode);
    const rightParsed = parseLocationCode(right.locationCode);
    const leftLetter = (leftParsed?.letter || '').toUpperCase();
    const rightLetter = (rightParsed?.letter || '').toUpperCase();
    if (leftLetter !== rightLetter) {
      return leftLetter.localeCompare(rightLetter);
    }
    const leftNumber = Number(leftParsed?.number || left.locationNumber || 0);
    const rightNumber = Number(rightParsed?.number || right.locationNumber || 0);
    if (leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
    return String(left.location || '').localeCompare(String(right.location || ''));
  };
  next.sort((a, b) => {
    switch (sortBy) {
      case 'updated_asc':
        return new Date(a.updatedAt) - new Date(b.updatedAt);
      case 'updated_desc':
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      case 'name_asc':
        return a.name.localeCompare(b.name);
      case 'name_desc':
        return b.name.localeCompare(a.name);
      case 'location_asc':
        return locationCodeCompare(a, b);
      case 'location_desc':
        return locationCodeCompare(b, a);
      case 'expiration_asc':
        return (a.expirationDate || '9999-12-31').localeCompare(b.expirationDate || '9999-12-31');
      case 'expiration_desc':
        return (b.expirationDate || '').localeCompare(a.expirationDate || '');
      default:
        return 0;
    }
  });
  return next;
}

function getVisibleChemicals() {
  const term = chemicalSearch.value.trim().toLowerCase();
  const locationFilter = chemicalFilterLocation.value;
  const filtered = state.labInventory.chemicals.filter((item) => {
    const matchesLocation = !locationFilter || item.location === locationFilter;
    if (!matchesLocation) {
      return false;
    }
    if (!term) {
      return true;
    }
    const haystack = [
      item.name,
      item.casNumber,
      item.vendor,
      item.catalogNumber,
      item.location,
      item.locationCode,
      item.unitSize
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(term);
  });
  return sortChemicals(filtered);
}

function renderChemicalList() {
  const allChemicals = state.labInventory.chemicals;
  if (!allChemicals.length) {
    ctx.selectedChemicalId = '';
    if (chemicalResultsSummary) {
      chemicalResultsSummary.textContent = 'No chemicals recorded yet.';
    }
    chemicalList.innerHTML = '<p class="small-note">No chemicals recorded.</p>';
    renderChemicalDetail();
    return;
  }

  const chemicals = getVisibleChemicals();
  if (chemicalResultsSummary) {
    chemicalResultsSummary.textContent = `Showing ${chemicals.length} of ${allChemicals.length} chemicals.`;
  }
  if (!chemicals.length) {
    ctx.selectedChemicalId = '';
    chemicalList.innerHTML = '<p class="small-note">No chemicals match current search/filter.</p>';
    renderChemicalDetail();
    return;
  }

  if (!ctx.selectedChemicalId || !chemicals.some((item) => item.id === ctx.selectedChemicalId)) {
    ctx.selectedChemicalId = chemicals[0]?.id || '';
  }

  const rows = chemicals.map((item) => `
    <article class="list-row${ctx.selectedChemicalId === item.id ? ' list-row-selected' : ''}">
      <button class="list-main-btn text-list-btn" data-chemical-open="${item.id}">
        ${safeText(item.name)}
      </button>
      <span>${safeText(item.locationCode || '-')}</span>
      <span>${safeText(item.casNumber)}</span>
    </article>
  `).join('');

  chemicalList.innerHTML = `
    <article class="list-row list-row-header">
      <strong>Name</strong>
      <strong>Code</strong>
      <strong>CAS Number</strong>
    </article>
    ${rows}
  `;

  renderChemicalDetail();
}

function onChemicalListClick(event) {
  const button = event.target.closest('[data-chemical-open]');
  if (!button) {
    return;
  }
  ctx.selectedChemicalId = button.dataset.chemicalOpen;
  renderChemicalList();
}

  Object.assign(ctx, {
    renderLocationOptions,
    sortChemicals,
    getVisibleChemicals,
    renderChemicalList,
    onChemicalListClick
  });
}
