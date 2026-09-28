'use strict';

// In-memory fallback used when the SQLite index is unavailable or empty.
function createInventorySnapshotSearch({
  asArray,
  cleanText,
  ensureObject,
  uniqueStrings,
  buildSearchText,
  rankRows
} = {}) {
  function resolvePersonalSections(inventoryPayload) {
    const inventory = ensureObject(inventoryPayload);
    if (Array.isArray(inventory.personal)) {
      return asArray(inventory.personal).map((zone) => ({
        zone: cleanText(zone?.zone, 120),
        items: asArray(zone?.items)
      })).filter((zone) => zone.zone || zone.items.length > 0);
    }
    if (inventory.personal && typeof inventory.personal === 'object') {
      return Object.entries(inventory.personal).map(([zoneName, rawItems]) => ({
        zone: cleanText(zoneName, 120),
        items: asArray(rawItems)
      })).filter((zone) => zone.zone || zone.items.length > 0);
    }
    return Object.entries(inventory)
      .filter(([zoneName, rawItems]) => zoneName !== 'chemicals' && zoneName !== 'personal' && Array.isArray(rawItems))
      .map(([zoneName, rawItems]) => ({
        zone: cleanText(zoneName, 120),
        items: asArray(rawItems)
      }));
  }

  function buildContainerMapFromSnapshot(snapshot) {
    const map = new Map();
    resolvePersonalSections(snapshot?.inventory).forEach((section) => {
      asArray(section.items).forEach((container) => {
        const id = cleanText(container?.id, 140);
        if (!id) {
          return;
        }
        const key = `${cleanText(section.zone, 120).toLowerCase()}::${id.toLowerCase()}`;
        map.set(key, {
          zone: cleanText(section.zone, 120),
          id,
          name: cleanText(container?.name, 220),
          type: cleanText(container?.type, 40),
          location: cleanText(container?.location, 220),
          quantity: cleanText(container?.quantity, 80),
          singleContent: cleanText(container?.singleContent, 260),
          wellsSummary: asArray(container?.wells)
            .map((well) => {
              if (typeof well === 'string') {
                return cleanText(well, 80);
              }
              const payload = ensureObject(well);
              return cleanText(payload.content || payload.name, 80);
            })
            .filter(Boolean)
            .slice(0, 24)
            .join(' ')
        });
      });
    });
    return map;
  }

  function formatSampleLocation(sample) {
    const location = ensureObject(sample?.location);
    const parts = Object.entries(location)
      .filter(([key]) => key !== 'storageType')
      .map(([, value]) => cleanText(value, 120))
      .filter(Boolean);
    return parts.join(' / ');
  }

  function buildInventoryFallbackItems({ snapshot = {}, query = '', searchTerms = [], limit = 8, kinds = [] }) {
    const containerMap = buildContainerMapFromSnapshot(snapshot);
    const chemicalItems = asArray(snapshot?.labInventory?.chemicals).map((chemical) => {
      const payload = ensureObject(chemical);
      return {
        kind: 'chemical',
        zone: 'Lab Inventory',
        id: cleanText(payload.id, 120),
        name: cleanText(payload.name, 220),
        quantity: '',
        amount: cleanText(payload.amountInStock || payload.amount, 80),
        cas: cleanText(payload.casNumber || payload.cas, 80),
        location: cleanText(payload.location || payload.locationCode, 220),
        supplier: cleanText(payload.vendor || payload.supplier, 180),
        search_text: buildSearchText([
          payload.id,
          payload.name,
          payload.amountInStock,
          payload.amount,
          payload.casNumber,
          payload.cas,
          payload.location,
          payload.locationCode,
          payload.vendor,
          payload.supplier,
          payload.catalogNumber,
          payload.unitSize
        ])
      };
    });

    const personalContainerItems = [...containerMap.values()].map((container) => ({
      kind: 'personal_container',
      zone: cleanText(container.zone, 120),
      id: cleanText(container.id, 120),
      name: cleanText(container.name, 220),
      quantity: cleanText(container.quantity, 80),
      amount: '',
      cas: '',
      location: cleanText(container.location, 220),
      supplier: '',
      search_text: buildSearchText([
        container.zone,
        container.id,
        container.name,
        container.quantity,
        container.location,
        container.type,
        container.singleContent,
        container.wellsSummary
      ])
    }));

    const sampleItems = asArray(snapshot?.samples).map((sample) => {
      const payload = ensureObject(sample);
      const link = ensureObject(payload.inventoryLink);
      const section = cleanText(link.section, 120);
      const containerId = cleanText(link.containerId, 120);
      const containerKey = `${section.toLowerCase()}::${containerId.toLowerCase()}`;
      const container = containerMap.get(containerKey);
      const wellIndex = Number.isFinite(Number(link.wellIndex)) ? Number(link.wellIndex) : null;
      const location = formatSampleLocation(payload) || cleanText(container?.location, 220);
      const name = cleanText(payload.name, 220);
      const code = cleanText(payload.code, 120);
      return {
        kind: 'personal_sample',
        zone: section || cleanText(container?.zone, 120),
        id: cleanText(payload.id, 120) || code,
        name: name || code,
        quantity: cleanText(payload.concentration, 80),
        amount: '',
        cas: '',
        location,
        supplier: '',
        matched_term: '',
        sample_type: cleanText(payload.type, 80),
        sample_code: code,
        lot: cleanText(payload.lot, 120),
        container_id: containerId,
        container_name: cleanText(container?.name, 220),
        well_index: wellIndex,
        notes: cleanText(payload.notes, 240),
        // Type-specific fields (a plasmid's backbone, an antibody's target, ...)
        // differ per sample type, so they are searched and returned as a whole.
        details: payload.details && typeof payload.details === 'object' ? payload.details : null,
        search_text: buildSearchText([
          payload.id,
          payload.code,
          payload.name,
          payload.type,
          payload.lot,
          payload.concentration,
          payload.notes,
          section,
          containerId,
          container?.name,
          wellIndex,
          ...Object.values(ensureObject(payload.details))
        ])
      };
    }).filter((sample) => sample.id || sample.name);

    // Scope to the requested kinds before ranking so one kind cannot crowd out another.
    const kindSet = asArray(kinds).map((kind) => cleanText(kind, 40)).filter(Boolean);
    const allItems = [...chemicalItems, ...personalContainerItems, ...sampleItems];
    const scopedItems = kindSet.length
      ? allItems.filter((row) => kindSet.includes(cleanText(row?.kind, 40)))
      : allItems;
    const ranked = rankRows(
      scopedItems,
      {
        terms: searchTerms,
        query,
        limit: Math.max(Number(limit) || 8, 40),
        getSearchText: (row) => row?.search_text,
        getPrimaryText: (row) => row?.name
      }
    );

    const normalizedTerms = asArray(searchTerms).map((term) => cleanText(term, 220).toLowerCase()).filter(Boolean);
    const items = ranked.slice(0, Math.max(1, Number(limit) || 8)).map((row) => ({
      kind: cleanText(row.kind, 40),
      zone: cleanText(row.zone, 120),
      id: cleanText(row.id, 120),
      name: cleanText(row.name, 220),
      quantity: cleanText(row.quantity, 80),
      amount: cleanText(row.amount, 80),
      cas: cleanText(row.cas, 80),
      location: cleanText(row.location, 220),
      supplier: cleanText(row.supplier, 180),
      matched_term: cleanText(
        asArray(normalizedTerms).find((term) => String(row.search_text || '').includes(term)),
        140
      ) || cleanText(asArray(searchTerms)[0], 140),
      sample_type: cleanText(row.sample_type, 80),
      sample_code: cleanText(row.sample_code, 120),
      lot: cleanText(row.lot, 120),
      container_id: cleanText(row.container_id, 120),
      container_name: cleanText(row.container_name, 220),
      well_index: Number.isFinite(Number(row.well_index)) ? Number(row.well_index) : null,
      notes: cleanText(row.notes, 240),
      ...(row.details ? { details: row.details } : {}),
      score: row._score
    }));

    return {
      items,
      sampleCount: sampleItems.length,
      termsUsed: uniqueStrings(searchTerms, 10)
    };
  }

  return {
    resolvePersonalSections,
    buildContainerMapFromSnapshot,
    formatSampleLocation,
    buildInventoryFallbackItems
  };
}

module.exports = { createInventorySnapshotSearch };
