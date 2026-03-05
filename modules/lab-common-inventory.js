export function initLabCommonInventory({ state, persist, createId, safeText }) {
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

    const location = chemicalLocation.value.trim();
    const name = chemicalName.value.trim();
    const casNumber = chemicalCas.value.trim();
    if (!name || !casNumber || !location) {
      return;
    }

    const existingId = chemicalId.value;
    const existing = state.labInventory.chemicals.find((item) => item.id === existingId);
    const locationNumber = existing?.locationNumber || (state.labInventory.lastLocationNumber + 1);
    if (!existing?.locationNumber) {
      state.labInventory.lastLocationNumber = locationNumber;
    }

    const record = {
      id: existingId || createId(),
      name,
      casNumber,
      location,
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
      location: `${record.location}-${record.locationNumber}`
    });

    broadcastInventoryUpdate(record);
    persist();
    resetChemicalForm();
    renderAll();
  }

  function resetChemicalForm() {
    chemicalId.value = '';
    chemicalForm.reset();
    renderLocationOptions();
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
    renderChemicalDetail();
  }

  function deleteChemical(id) {
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
          return (a.locationNumber || 0) - (b.locationNumber || 0);
        case 'location_desc':
          return (b.locationNumber || 0) - (a.locationNumber || 0);
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
      chemicalList.innerHTML = '<p class="small-note">No chemicals recorded.</p>';
      return;
    }

    const chemicals = getVisibleChemicals();
    if (!chemicals.length) {
      chemicalList.innerHTML = '<p class="small-note">No chemicals match current search/filter.</p>';
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
        <span>${safeText(item.casNumber)}</span>
      </article>
    `).join('');

    chemicalList.innerHTML = `
      <article class="list-row list-row-header">
        <strong>Name</strong>
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
    chemicalDetailContent.innerHTML = `
      <p><strong>Name:</strong> ${safeText(selected.name)}</p>
      <p><strong>CAS:</strong> ${safeText(selected.casNumber)}</p>
      <p><strong>Location:</strong> ${safeText(selected.location)} #${selected.locationNumber}</p>
      <p><strong>Vendor:</strong> ${safeText(selected.vendor || '-')}</p>
      <p><strong>Catalog:</strong> ${safeText(selected.catalogNumber || '-')}</p>
      <p><strong>Unit Size:</strong> ${safeText(selected.unitSize || '-')}</p>
      <p><strong>Price:</strong> ${safeText(selected.price || '-')}</p>
      <p><strong>Stock:</strong> ${safeText(selected.amountInStock || '-')}</p>
      <p><strong>URL:</strong> ${safeText(selected.url || '-')}</p>
      <p><strong>Expiration:</strong> ${safeText(selected.expirationDate || '-')}</p>
      <p><strong>Linked Samples:</strong> ${safeText(linkedSamples.join(', ') || '-')}</p>
      <p><strong>Updated:</strong> ${new Date(selected.updatedAt).toLocaleString()}</p>
    `;
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
      const index = state.labInventory.chemicals.findIndex((item) => item.id === incoming.id);
      if (index >= 0) {
        state.labInventory.chemicals[index] = incoming;
      } else {
        state.labInventory.chemicals.push(incoming);
      }

      appendBlock('SYNC_IMPORT', {
        chemicalId: incoming.id,
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
    renderAll();
  }

  function renderAll() {
    renderLocationOptions();
    renderChemicalList();
    renderChemicalDetail();
    renderBlockchain();
    renderInboxEmails();
    renderPendingCount();
  }

  return { renderAll, renderLocationOptions };
}
