export function initLabCommonInventory({ state, persist, createId, safeText }) {
  const chemicalOpenAddBtn = document.getElementById('chemical-open-add-btn');
  const chemicalDialogOverlay = document.getElementById('chemical-dialog-overlay');
  const chemicalDialogTitle = document.getElementById('chemical-dialog-title');
  const chemicalDialogCloseBtn = document.getElementById('chemical-dialog-close-btn');
  const chemicalForm = document.getElementById('chemical-form');
  const chemicalId = document.getElementById('chemical-id');
  const chemicalName = document.getElementById('chemical-name');
  const chemicalCas = document.getElementById('chemical-cas');
  const chemicalLocation = document.getElementById('chemical-location');
  const chemicalVendor = document.getElementById('chemical-vendor');
  const chemicalCatalogNumber = document.getElementById('chemical-catalog-number');
  const chemicalUnitSize = document.getElementById('chemical-unit-size');
  const chemicalPrice = document.getElementById('chemical-price');
  const chemicalStock = document.getElementById('chemical-stock');
  const chemicalUrl = document.getElementById('chemical-url');
  const chemicalExpiration = document.getElementById('chemical-expiration');
  const chemicalCancelBtn = document.getElementById('chemical-cancel-btn');
  const chemicalList = document.getElementById('chemical-list');
  const chemicalSearch = document.getElementById('chemical-search');
  const chemicalResultsSummary = document.getElementById('chemical-results-summary');
  const chemicalFilterLocation = document.getElementById('chemical-filter-location');
  const chemicalSort = document.getElementById('chemical-sort');
  const chemicalDetailPanel = document.getElementById('chemical-detail-panel');
  const chemicalDetailTitle = document.getElementById('chemical-detail-title');
  const chemicalDetailContent = document.getElementById('chemical-detail-content');
  const chemicalDetailEditBtn = document.getElementById('chemical-detail-edit-btn');
  const chemicalDetailDeleteBtn = document.getElementById('chemical-detail-delete-btn');

  const inboxEmail = document.getElementById('inventory-inbox-email');
  const importBtn = document.getElementById('inventory-import-btn');
  const pendingCount = document.getElementById('inventory-pending-count');
  const blockchainList = document.getElementById('inventory-blockchain-list');

  chemicalOpenAddBtn.addEventListener('click', startNewChemical);
  chemicalDialogCloseBtn.addEventListener('click', resetChemicalForm);
  chemicalDialogOverlay.addEventListener('click', onChemicalDialogOverlayClick);
  document.addEventListener('keydown', onChemicalDialogKeydown);
  chemicalForm.addEventListener('submit', onChemicalSubmit);
  chemicalCancelBtn.addEventListener('click', resetChemicalForm);
  importBtn.addEventListener('click', importInventoryUpdates);
  inboxEmail.addEventListener('change', renderPendingCount);
  chemicalSearch.addEventListener('input', renderChemicalList);
  chemicalFilterLocation.addEventListener('change', renderChemicalList);
  chemicalSort.addEventListener('change', renderChemicalList);
  chemicalList.addEventListener('click', onChemicalListClick);
  chemicalDetailEditBtn.addEventListener('click', () => {
    if (!selectedChemicalId) {
      return;
    }
    editChemical(selectedChemicalId);
  });
  chemicalDetailDeleteBtn.addEventListener('click', () => {
    if (!selectedChemicalId) {
      return;
    }
    deleteChemical(selectedChemicalId);
  });

  let selectedChemicalId = '';
  let lastChemicalSqliteSyncKey = '';
  ensureLabInventoryShape();

  function ensureLabInventoryShape() {
    if (!state.labInventory || typeof state.labInventory !== 'object') {
      state.labInventory = {
        chemicals: [],
        blocks: [],
        lastLocationNumber: 0
      };
    }
    if (!Array.isArray(state.labInventory.chemicals)) {
      state.labInventory.chemicals = [];
    }
    if (!Array.isArray(state.labInventory.blocks)) {
      state.labInventory.blocks = [];
    }
    if (!Number.isFinite(Number(state.labInventory.lastLocationNumber))) {
      state.labInventory.lastLocationNumber = 0;
    }
    if (!state.labInventory.locationCodeMap || typeof state.labInventory.locationCodeMap !== 'object') {
      state.labInventory.locationCodeMap = {};
    }
    if (!state.labInventory.locationCodeNextByLocation || typeof state.labInventory.locationCodeNextByLocation !== 'object') {
      state.labInventory.locationCodeNextByLocation = {};
    }
  }

  function normalizeLocationKey(value) {
    return String(value || '').trim().toLowerCase();
  }

  function updateChemicalDialogTitle() {
    if (!chemicalDialogTitle) {
      return;
    }
    chemicalDialogTitle.textContent = chemicalId.value ? 'Edit Chemical' : 'Add Chemical';
  }

  function openChemicalDialog() {
    if (!chemicalDialogOverlay) {
      return;
    }
    updateChemicalDialogTitle();
    chemicalDialogOverlay.hidden = false;
    requestAnimationFrame(() => {
      chemicalName.focus();
    });
  }

  function clearChemicalForm() {
    chemicalId.value = '';
    chemicalForm.reset();
    renderLocationOptions();
    updateChemicalDialogTitle();
  }

  function startNewChemical() {
    clearChemicalForm();
    openChemicalDialog();
  }

  function resetChemicalForm() {
    clearChemicalForm();
    if (chemicalDialogOverlay) {
      chemicalDialogOverlay.hidden = true;
    }
  }

  function onChemicalDialogOverlayClick(event) {
    if (event.target === chemicalDialogOverlay) {
      resetChemicalForm();
    }
  }

  function onChemicalDialogKeydown(event) {
    if (event.key === 'Escape' && chemicalDialogOverlay && !chemicalDialogOverlay.hidden) {
      event.preventDefault();
      resetChemicalForm();
    }
  }

  function encodeLocationLetter(index) {
    let value = Number(index) || 0;
    let out = '';
    while (value >= 0) {
      out = String.fromCharCode(65 + (value % 26)) + out;
      value = Math.floor(value / 26) - 1;
    }
    return out;
  }

  function ensureLocationLetter(location) {
    ensureLabInventoryShape();
    const key = normalizeLocationKey(location);
    if (!key) {
      return 'X';
    }
    const existing = String(state.labInventory.locationCodeMap[key] || '').trim().toUpperCase();
    if (existing) {
      return existing;
    }

    const usedLetters = new Set(
      Object.values(state.labInventory.locationCodeMap || {})
        .map((value) => String(value || '').trim().toUpperCase())
        .filter(Boolean)
    );

    let index = 0;
    let candidate = encodeLocationLetter(index);
    while (usedLetters.has(candidate)) {
      index += 1;
      candidate = encodeLocationLetter(index);
    }
    state.labInventory.locationCodeMap[key] = candidate;
    return candidate;
  }

  function parseLocationCode(value) {
    const matched = String(value || '').trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!matched) {
      return null;
    }
    return {
      letter: matched[1],
      number: Number(matched[2]) || 0
    };
  }

  function readMaxLocationCodeNumber(location, letter) {
    const key = normalizeLocationKey(location);
    return state.labInventory.chemicals.reduce((max, item) => {
      if (normalizeLocationKey(item?.location) !== key) {
        return max;
      }
      const parsed = parseLocationCode(item?.locationCode);
      if (parsed && parsed.letter === letter) {
        return Math.max(max, parsed.number);
      }
      if (!parsed && Number.isFinite(Number(item?.locationNumber))) {
        return Math.max(max, Number(item.locationNumber));
      }
      return max;
    }, 0);
  }

  function assignLocationCode(location, existingCode = '') {
    ensureLabInventoryShape();
    const key = normalizeLocationKey(location);
    const parsedExisting = parseLocationCode(existingCode);
    const existingMappedLetter = String(state.labInventory.locationCodeMap[key] || '').trim().toUpperCase();
    if (!existingMappedLetter && parsedExisting?.letter) {
      state.labInventory.locationCodeMap[key] = parsedExisting.letter;
    }
    const letter = ensureLocationLetter(location);
    if (parsedExisting && parsedExisting.letter === letter && parsedExisting.number > 0) {
      const nextCurrent = Number(state.labInventory.locationCodeNextByLocation[key]) || 1;
      state.labInventory.locationCodeNextByLocation[key] = Math.max(nextCurrent, parsedExisting.number + 1);
      return `${letter}${parsedExisting.number}`;
    }

    const nextSeed = Number(state.labInventory.locationCodeNextByLocation[key]) || 0;
    const computedMax = readMaxLocationCodeNumber(location, letter);
    const nextNumber = Math.max(nextSeed, computedMax + 1, 1);
    state.labInventory.locationCodeNextByLocation[key] = nextNumber + 1;
    state.labInventory.lastLocationNumber = Math.max(Number(state.labInventory.lastLocationNumber) || 0, nextNumber);
    return `${letter}${nextNumber}`;
  }

  function ensureChemicalCodes() {
    ensureLabInventoryShape();
    const nextMap = {};
    state.labInventory.chemicals.forEach((item) => {
      const locationKey = normalizeLocationKey(item?.location);
      if (!locationKey) {
        return;
      }
      const parsed = parseLocationCode(item?.locationCode);
      if (!parsed) {
        return;
      }
      if (!state.labInventory.locationCodeMap[locationKey]) {
        state.labInventory.locationCodeMap[locationKey] = parsed.letter;
      }
      nextMap[locationKey] = Math.max(Number(nextMap[locationKey]) || 1, parsed.number + 1);
    });
    Object.entries(nextMap).forEach(([key, value]) => {
      const current = Number(state.labInventory.locationCodeNextByLocation[key]) || 1;
      state.labInventory.locationCodeNextByLocation[key] = Math.max(current, Number(value) || 1);
    });

    let changed = false;
    let maxLocationNumber = Number(state.labInventory.lastLocationNumber) || 0;
    state.labInventory.chemicals = state.labInventory.chemicals.map((item) => {
      const chemical = item && typeof item === 'object' ? { ...item } : {};
      const location = String(chemical.location || '').trim();
      if (!location) {
        return chemical;
      }
      const currentCode = String(chemical.locationCode || '').trim().toUpperCase();
      const nextCode = assignLocationCode(location, currentCode);
      const parsed = parseLocationCode(nextCode);
      const nextLocationNumber = Number(parsed?.number || chemical.locationNumber || 0);
      maxLocationNumber = Math.max(maxLocationNumber, nextLocationNumber);
      if (nextCode !== currentCode || Number(chemical.locationNumber) !== Number(parsed?.number || 0)) {
        changed = true;
      }
      return {
        ...chemical,
        locationCode: nextCode,
        locationNumber: nextLocationNumber
      };
    });
    if ((Number(state.labInventory.lastLocationNumber) || 0) !== maxLocationNumber) {
      state.labInventory.lastLocationNumber = maxLocationNumber;
      changed = true;
    }
    return changed;
  }

  function buildChemicalSqliteSyncKey() {
    const storagePath = String(state.settings?.storagePath || '').trim();
    const summary = state.labInventory.chemicals
      .map((item) => `${item.id}|${item.locationCode || ''}|${item.updatedAt || ''}`)
      .join('||');
    const locationCodeMapSummary = Object.entries(state.labInventory.locationCodeMap || {})
      .map(([location, letter]) => `${location}:${letter}`)
      .sort()
      .join('|');
    const nextByLocationSummary = Object.entries(state.labInventory.locationCodeNextByLocation || {})
      .map(([location, number]) => `${location}:${Number(number) || 0}`)
      .sort()
      .join('|');
    return `${storagePath}::${summary}::${state.labInventory.blocks.length}::${Number(state.labInventory.lastLocationNumber) || 0}::${locationCodeMapSummary}::${nextByLocationSummary}`;
  }

  async function syncChemicalSqliteBundle(force = false) {
    const storagePath = String(state.settings?.storagePath || '').trim();
    if (!storagePath || !window.enanaApi?.syncSqliteBundle) {
      return;
    }

    const syncKey = buildChemicalSqliteSyncKey();
    if (!force && syncKey === lastChemicalSqliteSyncKey) {
      return;
    }

    const normalizedRoot = storagePath.replace(/[\\/]+$/, '');
    const targetPath = `${normalizedRoot}/enana-chemicals.index.sqlite`;
    const inventorySnapshot = {
      labInventory: {
        chemicals: Array.isArray(state.labInventory.chemicals) ? state.labInventory.chemicals : [],
        blocks: Array.isArray(state.labInventory.blocks) ? state.labInventory.blocks : [],
        lastLocationNumber: Number(state.labInventory.lastLocationNumber) || 0,
        locationCodeMap: state.labInventory.locationCodeMap || {},
        locationCodeNextByLocation: state.labInventory.locationCodeNextByLocation || {}
      },
      inventory: state.inventory && typeof state.inventory === 'object' ? state.inventory : {},
      settings: {
        storagePath,
        inventoryLocations: Array.isArray(state.settings?.inventoryLocations)
          ? state.settings.inventoryLocations
          : []
      }
    };

    try {
      const result = await window.enanaApi.syncSqliteBundle({
        mode: 'chemical',
        snapshot: inventorySnapshot,
        sqlitePath: targetPath
      });
      if (result?.ok) {
        lastChemicalSqliteSyncKey = syncKey;
      } else {
        console.warn('Failed to sync chemical sqlite bundle:', result?.error || targetPath);
      }
    } catch (error) {
      console.warn('Failed to sync chemical sqlite bundle:', error);
    }
  }

  function isUnreadFor(message, email) {
    if (!email) {
      return false;
    }
    if (!Array.isArray(message.readBy)) {
      return true;
    }
    return !message.readBy.includes(email);
  }

  function simpleHash(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return `h${Math.abs(hash).toString(16)}`;
  }

  function appendBlock(action, payload) {
    const prev = state.labInventory.blocks[state.labInventory.blocks.length - 1];
    const block = {
      index: state.labInventory.blocks.length + 1,
      timestamp: new Date().toISOString(),
      action,
      prevHash: prev?.hash || 'GENESIS',
      payload
    };
    block.hash = simpleHash(JSON.stringify(block));
    state.labInventory.blocks.push(block);
  }

  function broadcastInventoryUpdate(chemical) {
    const recipients = Array.from(new Set(
      state.members
        .map((member) => member.enanaEmail)
        .filter((email) => email && email.trim())
    ));

    const from = state.settings.personalInfo.enanaEmail || 'system@enana.local';
    recipients
      .filter((to) => to !== from)
      .forEach((to) => {
        state.messages.push({
          id: createId(),
          from,
          to,
          subject: '[Inventory Sync] Chemical Updated',
          body: `${chemical.name} (${chemical.casNumber}) updated.`,
          createdAt: new Date().toISOString(),
          readBy: [],
          type: 'inventory_sync',
          payload: {
            chemical
          }
        });
      });
  }

  function onChemicalSubmit(event) {
    event.preventDefault();
    ensureLabInventoryShape();

    const location = chemicalLocation.value.trim();
    const name = chemicalName.value.trim();
    const casNumber = chemicalCas.value.trim();
    if (!name || !casNumber || !location) {
      return;
    }

    const existingId = chemicalId.value;
    const existing = state.labInventory.chemicals.find((item) => item.id === existingId);
    const locationCode = assignLocationCode(location, existing?.locationCode || '');
    const parsedLocationCode = parseLocationCode(locationCode);
    const locationNumber = Number(parsedLocationCode?.number || existing?.locationNumber || 0);
    state.labInventory.lastLocationNumber = Math.max(Number(state.labInventory.lastLocationNumber) || 0, locationNumber);

    const record = {
      id: existingId || createId(),
      name,
      casNumber,
      location,
      locationCode,
      locationNumber,
      vendor: chemicalVendor.value.trim(),
      catalogNumber: chemicalCatalogNumber.value.trim(),
      unitSize: chemicalUnitSize.value.trim(),
      price: chemicalPrice.value.trim(),
      amountInStock: chemicalStock.value.trim(),
      url: chemicalUrl.value.trim(),
      expirationDate: chemicalExpiration.value,
      updatedAt: new Date().toISOString()
    };

    const index = state.labInventory.chemicals.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      state.labInventory.chemicals[index] = record;
    } else {
      state.labInventory.chemicals.push(record);
    }
    selectedChemicalId = record.id;

    appendBlock('UPSERT_CHEMICAL', {
      chemicalId: record.id,
      name: record.name,
      casNumber: record.casNumber,
      location: `${record.location}-${record.locationCode || record.locationNumber}`
    });

    broadcastInventoryUpdate(record);
    persist();
    void syncChemicalSqliteBundle(true);
    resetChemicalForm();
    renderAll();
  }

  function editChemical(id) {
    const item = state.labInventory.chemicals.find((chemical) => chemical.id === id);
    if (!item) {
      return;
    }

    chemicalId.value = item.id;
    chemicalName.value = item.name;
    chemicalCas.value = item.casNumber;
    chemicalLocation.value = item.location;
    chemicalVendor.value = item.vendor || '';
    chemicalCatalogNumber.value = item.catalogNumber || '';
    chemicalUnitSize.value = item.unitSize || '';
    chemicalPrice.value = item.price || '';
    chemicalStock.value = item.amountInStock || '';
    chemicalUrl.value = item.url || '';
    chemicalExpiration.value = item.expirationDate || '';
    selectedChemicalId = id;
    updateChemicalDialogTitle();
    openChemicalDialog();
    renderChemicalDetail();
  }

  function deleteChemical(id) {
    ensureLabInventoryShape();
    state.labInventory.chemicals = state.labInventory.chemicals.filter((item) => item.id !== id);
    state.samples = (state.samples || []).map((sample) => {
      const links = Array.isArray(sample.chemicalLinks) ? sample.chemicalLinks : [];
      if (!links.includes(id)) {
        return sample;
      }
      return {
        ...sample,
        chemicalLinks: links.filter((item) => item !== id),
        updatedAt: new Date().toISOString()
      };
    });
    if (selectedChemicalId === id) {
      selectedChemicalId = '';
    }
    appendBlock('DELETE_CHEMICAL', { chemicalId: id });
    persist();
    void syncChemicalSqliteBundle(true);
    renderAll();
  }

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
      selectedChemicalId = '';
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
      selectedChemicalId = '';
      chemicalList.innerHTML = '<p class="small-note">No chemicals match current search/filter.</p>';
      renderChemicalDetail();
      return;
    }

    if (!selectedChemicalId || !chemicals.some((item) => item.id === selectedChemicalId)) {
      selectedChemicalId = chemicals[0]?.id || '';
    }

    const rows = chemicals.map((item) => `
      <article class="list-row${selectedChemicalId === item.id ? ' list-row-selected' : ''}">
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
    selectedChemicalId = button.dataset.chemicalOpen;
    renderChemicalList();
  }

  function renderChemicalDetail() {
    const selected = state.labInventory.chemicals.find((item) => item.id === selectedChemicalId);
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

  function renderInboxEmails() {
    const emails = Array.from(new Set(
      state.members
        .map((member) => member.enanaEmail)
        .filter((email) => email && email.trim())
    ));
    const selected = inboxEmail.value;
    const options = ['<option value="">Select inbox email</option>'];
    emails.forEach((email) => {
      const isSelected = selected === email ? ' selected' : '';
      options.push(`<option value="${safeText(email)}"${isSelected}>${safeText(email)}</option>`);
    });
    inboxEmail.innerHTML = options.join('');
    if (selected && emails.includes(selected)) {
      inboxEmail.value = selected;
    }
  }

  function renderPendingCount() {
    const target = inboxEmail.value;
    if (!target) {
      pendingCount.textContent = '0';
      return;
    }

    const pending = state.messages.filter((message) => (
      message.type === 'inventory_sync' &&
      message.to === target &&
      isUnreadFor(message, target)
    ));

    pendingCount.textContent = String(pending.length);
  }

  function importInventoryUpdates() {
    ensureLabInventoryShape();
    const target = inboxEmail.value;
    if (!target) {
      return;
    }

    const pending = state.messages.filter((message) => (
      message.type === 'inventory_sync' &&
      message.to === target &&
      isUnreadFor(message, target)
    ));

    pending.forEach((message) => {
      const incoming = message.payload?.chemical;
      if (!incoming || !incoming.id) {
        return;
      }
      const normalizedIncoming = {
        ...incoming,
        location: String(incoming.location || '').trim()
      };
      if (normalizedIncoming.location) {
        const nextCode = assignLocationCode(normalizedIncoming.location, normalizedIncoming.locationCode || '');
        const parsed = parseLocationCode(nextCode);
        normalizedIncoming.locationCode = nextCode;
        normalizedIncoming.locationNumber = Number(parsed?.number || normalizedIncoming.locationNumber || 0);
        state.labInventory.lastLocationNumber = Math.max(
          Number(state.labInventory.lastLocationNumber) || 0,
          Number(normalizedIncoming.locationNumber) || 0
        );
      }
      const index = state.labInventory.chemicals.findIndex((item) => item.id === incoming.id);
      if (index >= 0) {
        state.labInventory.chemicals[index] = normalizedIncoming;
      } else {
        state.labInventory.chemicals.push(normalizedIncoming);
      }

      appendBlock('SYNC_IMPORT', {
        chemicalId: normalizedIncoming.id,
        from: message.from,
        to: message.to
      });

      if (!Array.isArray(message.readBy)) {
        message.readBy = [];
      }
      if (!message.readBy.includes(target)) {
        message.readBy.push(target);
      }
    });

    persist();
    void syncChemicalSqliteBundle(true);
    renderAll();
  }

  function renderAll() {
    ensureLabInventoryShape();
    const migrated = ensureChemicalCodes();
    if (migrated) {
      persist();
    }
    renderLocationOptions();
    renderChemicalList();
    renderChemicalDetail();
    renderBlockchain();
    renderInboxEmails();
    renderPendingCount();
    void syncChemicalSqliteBundle(migrated);
  }

  return { renderAll, renderLocationOptions };
}
