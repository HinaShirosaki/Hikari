'use strict';

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function defaultEnsureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function createAgentInventoryLookupRuntime(deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const ensureObject = typeof deps.ensureObject === 'function' ? deps.ensureObject : defaultEnsureObject;
  const uniqueStrings = typeof deps.uniqueStrings === 'function'
    ? deps.uniqueStrings
    : ((values, max = 20) => {
      const seen = new Set();
      const out = [];
      asArray(values).forEach((value) => {
        const normalized = cleanText(value, 220);
        if (!normalized) {
          return;
        }
        const key = normalized.toLowerCase();
        if (seen.has(key) || out.length >= max) {
          return;
        }
        seen.add(key);
        out.push(normalized);
      });
      return out;
    });
  const buildSearchText = typeof deps.buildSearchText === 'function'
    ? deps.buildSearchText
    : ((values) => values
      .map((value) => cleanText(value, 600))
      .filter(Boolean)
      .join(' ')
      .toLowerCase());
  const normalizeQuery = typeof deps.normalizeQuery === 'function'
    ? deps.normalizeQuery
    : ((value) => ({
      query: cleanText(value, 300).toLowerCase(),
      tokens: cleanText(value, 300)
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .slice(0, 12)
    }));
  const buildTerms = typeof deps.buildTerms === 'function'
    ? deps.buildTerms
    : (({ query = '', terms = [], maxTerms = 10 }) => uniqueStrings([
      ...asArray(terms),
      cleanText(query, 220)
    ], maxTerms));
  const rankRows = typeof deps.rankRows === 'function'
    ? deps.rankRows
    : ((rows, {
      terms = [],
      query = '',
      limit = 6,
      getSearchText = (row) => row?.search_text || '',
      getPrimaryText = (row) => row?.name || row?.title || ''
    } = {}) => {
      const { query: normalizedQuery } = normalizeQuery(query);
      const normalizedTerms = asArray(terms).map((term) => cleanText(term, 220).toLowerCase()).filter(Boolean);
      return asArray(rows)
        .map((row) => {
          const searchText = String(getSearchText(row) || '').toLowerCase();
          const primaryText = String(getPrimaryText(row) || '').toLowerCase();
          let score = normalizedTerms.reduce((acc, term) => (
            searchText.includes(term) ? acc + 10 : acc
          ), 0);
          if (normalizedQuery && primaryText === normalizedQuery) {
            score += 40;
          } else if (normalizedQuery && primaryText.includes(normalizedQuery)) {
            score += 15;
          }
          if (normalizedQuery && searchText.includes(normalizedQuery)) {
            score += 8;
          }
          return {
            ...row,
            _score: score
          };
        })
        .filter((row) => row._score > 0)
        .sort((left, right) => right._score - left._score)
        .slice(0, Math.max(1, Number(limit) || 6));
    });
  const buildLookupContext = typeof deps.buildLookupContext === 'function'
    ? deps.buildLookupContext
    : (async ({
      dataFilePath = '',
      fallbackDataFilePath = '',
      snapshot = {}
    } = {}) => ({
      dataFilePath: cleanText(dataFilePath, 2000),
      fallbackDataFilePath: cleanText(fallbackDataFilePath, 2000),
      sqlitePath: '',
      hydratedSnapshot: ensureObject(snapshot),
      bundlePaths: {}
    }));
  const withSqliteDatabase = typeof deps.withSqliteDatabase === 'function'
    ? deps.withSqliteDatabase
    : (async () => ({
      ok: false,
      reason: 'sqlite_unavailable',
      result: null
    }));
  const readSqliteTables = typeof deps.readSqliteTables === 'function'
    ? deps.readSqliteTables
    : (() => new Set());
  const collectLikeMatches = typeof deps.collectLikeMatches === 'function'
    ? deps.collectLikeMatches
    : ((db, {
      tableName,
      selectColumns,
      terms = [],
      rowLimit = 40,
      tableAvailable = true,
      mapRow,
      dedupeKey
    }) => {
      if (!tableAvailable || !db || typeof db.prepare !== 'function') {
        return [];
      }
      const rowsByKey = new Map();
      const normalizedTerms = asArray(terms).map((term) => cleanText(term, 220).toLowerCase()).filter(Boolean);
      normalizedTerms.forEach((term) => {
        const stmt = db.prepare(
          `SELECT ${selectColumns.join(', ')} FROM ${tableName} WHERE lower(search_text) LIKE ? LIMIT ?`
        );
        try {
          stmt.bind([`%${term}%`, Math.max(1, Number(rowLimit) || 40)]);
          while (stmt.step()) {
            const mapped = mapRow(stmt.getAsObject(), term);
            const key = dedupeKey(mapped);
            if (!key) {
              continue;
            }
            const existing = rowsByKey.get(key);
            if (!existing) {
              rowsByKey.set(key, {
                ...mapped,
                matched_terms: [term]
              });
            } else {
              existing.matched_terms = uniqueStrings([...existing.matched_terms, term], 8);
            }
          }
        } finally {
          stmt.free();
        }
      });
      return [...rowsByKey.values()];
    });
  const maybeBackfillSqlIndex = typeof deps.maybeBackfillSqlIndex === 'function'
    ? deps.maybeBackfillSqlIndex
    : (async () => false);
  const mergeRowsByKey = typeof deps.mergeRowsByKey === 'function'
    ? deps.mergeRowsByKey
    : ((primaryRows, secondaryRows, toKey) => {
      const merged = [];
      const seen = new Set();
      asArray(primaryRows).forEach((row) => {
        const key = toKey(row);
        if (!key || seen.has(key)) {
          return;
        }
        seen.add(key);
        merged.push(row);
      });
      asArray(secondaryRows).forEach((row) => {
        const key = toKey(row);
        if (!key || seen.has(key)) {
          return;
        }
        seen.add(key);
        merged.push(row);
      });
      return merged;
    });
  const buildInventorySearchTerms = typeof deps.buildInventorySearchTerms === 'function'
    ? deps.buildInventorySearchTerms
    : (({
      inventorySearch = {},
      fallbackQuery = '',
      maxTerms = 10
    } = {}) => {
      const source = ensureObject(inventorySearch);
      return buildTerms({
        query: fallbackQuery,
        terms: [
          source.normalized_query,
          ...asArray(source.candidate_terms),
          ...asArray(source.aliases)
        ],
        maxTerms
      });
    });
  const querySqlRows = typeof deps.querySqlRows === 'function'
    ? deps.querySqlRows
    : ((db, sql, values = []) => {
      if (!db || typeof db.prepare !== 'function') {
        return [];
      }
      const stmt = db.prepare(sql);
      const rows = [];
      try {
        stmt.bind(values);
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
      } finally {
        stmt.free();
      }
      return rows;
    });

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

  function buildInventoryFallbackItems({ snapshot = {}, query = '', searchTerms = [], limit = 8 }) {
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
          wellIndex
        ])
      };
    }).filter((sample) => sample.id || sample.name);

    const ranked = rankRows(
      [...chemicalItems, ...personalContainerItems, ...sampleItems],
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
      notes: cleanText(row.notes, 240)
    }));

    return {
      items,
      sampleCount: sampleItems.length,
      termsUsed: uniqueStrings(searchTerms, 10)
    };
  }

  async function searchInventorySqlite({ sqlitePath = '', query = '', searchTerms = [], limit = 8 }) {
    const dbResult = await withSqliteDatabase(sqlitePath, async (db) => {
      const tables = readSqliteTables(db);
      const hasChemicals = tables.has('inventory_chemicals');
      const hasPersonal = tables.has('inventory_personal');
      const hasSamples = tables.has('inventory_samples');
      const sampleRowCount = hasSamples
        ? Number(querySqlRows(db, 'SELECT COUNT(1) AS count FROM inventory_samples', [])[0]?.count || 0)
        : 0;

      const terms = uniqueStrings(searchTerms, 10);

      const chemicalRows = collectLikeMatches(db, {
        tableName: 'inventory_chemicals',
        selectColumns: ['id', 'name', 'amount', 'cas', 'location', 'supplier', 'search_text'],
        terms,
        tableAvailable: hasChemicals,
        mapRow: (row) => ({
          kind: 'chemical',
          zone: 'Lab Inventory',
          id: cleanText(row?.id, 120),
          name: cleanText(row?.name, 220),
          quantity: '',
          amount: cleanText(row?.amount, 80),
          cas: cleanText(row?.cas, 80),
          location: cleanText(row?.location, 220),
          supplier: cleanText(row?.supplier, 180),
          search_text: cleanText(row?.search_text, 4000)
        }),
        dedupeKey: (row) => `chemical::${cleanText(row.id, 120).toLowerCase()}`
      });

      const personalRows = collectLikeMatches(db, {
        tableName: 'inventory_personal',
        selectColumns: ['zone', 'id', 'name', 'quantity', 'location', 'search_text'],
        terms,
        tableAvailable: hasPersonal,
        mapRow: (row) => ({
          kind: 'personal_container',
          zone: cleanText(row?.zone, 120),
          id: cleanText(row?.id, 120),
          name: cleanText(row?.name, 220),
          quantity: cleanText(row?.quantity, 80),
          amount: '',
          cas: '',
          location: cleanText(row?.location, 220),
          supplier: '',
          search_text: cleanText(row?.search_text, 4000)
        }),
        dedupeKey: (row) => `container::${cleanText(row.zone, 120).toLowerCase()}::${cleanText(row.id, 120).toLowerCase()}`
      });

      const sampleRows = collectLikeMatches(db, {
        tableName: 'inventory_samples',
        selectColumns: [
          'id',
          'code',
          'name',
          'sample_type',
          'lot',
          'concentration',
          'section',
          'container_id',
          'container_name',
          'well_index',
          'location_text',
          'notes',
          'search_text'
        ],
        terms,
        tableAvailable: hasSamples,
        mapRow: (row) => ({
          kind: 'personal_sample',
          zone: cleanText(row?.section, 120),
          id: cleanText(row?.id, 120),
          name: cleanText(row?.name || row?.code, 220),
          quantity: cleanText(row?.concentration, 80),
          amount: '',
          cas: '',
          location: cleanText(row?.location_text, 220),
          supplier: '',
          sample_type: cleanText(row?.sample_type, 80),
          sample_code: cleanText(row?.code, 120),
          lot: cleanText(row?.lot, 120),
          container_id: cleanText(row?.container_id, 120),
          container_name: cleanText(row?.container_name, 220),
          well_index: Number.isFinite(Number(row?.well_index)) ? Number(row.well_index) : null,
          notes: cleanText(row?.notes, 240),
          search_text: cleanText(row?.search_text, 4000)
        }),
        dedupeKey: (row) => `sample::${cleanText(row.id || row.sample_code, 120).toLowerCase()}`
      });

      const ranked = rankRows(
        [...chemicalRows, ...personalRows, ...sampleRows],
        {
          terms,
          query,
          limit: Math.max(1, Number(limit) || 8),
          getSearchText: (row) => row?.search_text,
          getPrimaryText: (row) => row?.name
        }
      );

      return {
        usedSqlite: true,
        items: ranked.map((row) => {
          const matched = asArray(row.matched_terms).find((term) => String(row.search_text || '').includes(term));
          return {
            kind: cleanText(row.kind, 40),
            zone: cleanText(row.zone, 120),
            id: cleanText(row.id, 120),
            name: cleanText(row.name, 220),
            quantity: cleanText(row.quantity, 80),
            amount: cleanText(row.amount, 80),
            cas: cleanText(row.cas, 80),
            location: cleanText(row.location, 220),
            supplier: cleanText(row.supplier, 180),
            matched_term: cleanText(matched || asArray(searchTerms)[0], 140),
            sample_type: cleanText(row.sample_type, 80),
            sample_code: cleanText(row.sample_code, 120),
            lot: cleanText(row.lot, 120),
            container_id: cleanText(row.container_id, 120),
            container_name: cleanText(row.container_name, 220),
            well_index: Number.isFinite(Number(row.well_index)) ? Number(row.well_index) : null,
            notes: cleanText(row.notes, 240)
          };
        }),
        tableStatus: {
          inventory_chemicals_exists: hasChemicals,
          inventory_personal_exists: hasPersonal,
          inventory_samples_exists: hasSamples,
          inventory_samples_row_count: sampleRowCount
        }
      };
    });

    if (!dbResult.ok) {
      return {
        usedSqlite: false,
        sqliteReason: dbResult.reason,
        items: [],
        tableStatus: {
          inventory_chemicals_exists: false,
          inventory_personal_exists: false,
          inventory_samples_exists: false,
          inventory_samples_row_count: 0
        }
      };
    }

    return dbResult.result;
  }

  function deriveInventoryLookupQuery({ message = '', parserPayload = {} } = {}) {
    const parser = ensureObject(parserPayload);
    const entities = ensureObject(parser.entities);
    const inventorySearch = ensureObject(parser.inventory_search);
    return cleanText(
      inventorySearch.normalized_query
      || entities.inventory_item
      || entities.compound_name
      || entities.requested_output
      || message,
      300
    );
  }

  async function searchInventoryIndex({
    dataFilePath = '',
    fallbackDataFilePath = '',
    query = '',
    limit = 8,
    searchTerms = [],
    snapshot = {}
  } = {}) {
    const context = await buildLookupContext({
      dataFilePath,
      fallbackDataFilePath,
      snapshot
    });

    const termsUsed = buildTerms({
      query,
      terms: asArray(searchTerms),
      maxTerms: 10
    });

    const sqlResult = await searchInventorySqlite({
      sqlitePath: context.sqlitePath,
      query,
      searchTerms: termsUsed,
      limit
    });
    const fallbackResult = buildInventoryFallbackItems({
      snapshot: context.hydratedSnapshot,
      query,
      searchTerms: termsUsed,
      limit
    });

    let source = sqlResult.usedSqlite ? 'sqlite' : 'fallback_json';
    let items = asArray(sqlResult.items).slice(0, Math.max(1, Number(limit) || 8));

    if (!items.length && fallbackResult.items.length) {
      source = 'fallback_json';
      items = fallbackResult.items.slice(0, Math.max(1, Number(limit) || 8));
    }

    const hasSnapshotSamples = asArray(context.hydratedSnapshot?.samples).length > 0;
    const sqlSampleTableExists = sqlResult.tableStatus?.inventory_samples_exists === true;
    const sqlSampleRowCount = Number(sqlResult.tableStatus?.inventory_samples_row_count) || 0;

    const shouldBackfill = Boolean(
      context.dataFilePath
      && (
        !sqlResult.usedSqlite
        || (hasSnapshotSamples && (!sqlSampleTableExists || sqlSampleRowCount === 0))
        || (source === 'fallback_json' && fallbackResult.items.length > 0)
      )
    );

    const backfilledSql = await maybeBackfillSqlIndex({
      shouldBackfill,
      dataFilePath: context.dataFilePath,
      fallbackDataFilePath: context.fallbackDataFilePath,
      snapshot: context.hydratedSnapshot
    });

    if (backfilledSql) {
      const rerun = await searchInventorySqlite({
        sqlitePath: context.sqlitePath,
        query,
        searchTerms: termsUsed,
        limit
      });
      if (asArray(rerun.items).length) {
        const merged = mergeRowsByKey(
          rerun.items,
          fallbackResult.items,
          (row) => `${cleanText(row?.kind, 40)}::${cleanText(row?.zone, 120)}::${cleanText(row?.id, 120)}`
        );
        items = merged.slice(0, Math.max(1, Number(limit) || 8));
        source = merged.length > asArray(rerun.items).length ? 'sqlite+fallback' : 'sqlite';
      }
    }

    return {
      items,
      usedSqlite: source.startsWith('sqlite'),
      source,
      termsUsed,
      backfilledSql,
      query: cleanText(query, 300)
    };
  }

  async function executeInventoryLookup({
    message = '',
    parserPayload = {},
    snapshot = {},
    dataFilePath = '',
    fallbackDataFilePath = '',
    limit = 8
  } = {}) {
    const parser = ensureObject(parserPayload);
    const query = deriveInventoryLookupQuery({ message, parserPayload: parser });
    const termsUsed = buildInventorySearchTerms({
      inventorySearch: ensureObject(parser.inventory_search),
      fallbackQuery: query,
      maxTerms: 10
    });

    const searchResult = await searchInventoryIndex({
      dataFilePath,
      fallbackDataFilePath,
      query,
      limit,
      searchTerms: termsUsed,
      snapshot
    });

    const items = asArray(searchResult.items).slice(0, Math.max(1, Number(limit) || 8));
    return {
      status: items.length ? 'matched' : 'no_match',
      query: cleanText(searchResult.query || query, 300),
      terms_used: uniqueStrings(searchResult.termsUsed || termsUsed, 10),
      source: cleanText(searchResult.source, 80) || 'fallback_json',
      backfilled_sql: searchResult.backfilledSql === true,
      items
    };
  }

  return {
    resolvePersonalSections,
    buildContainerMapFromSnapshot,
    formatSampleLocation,
    buildInventoryFallbackItems,
    searchInventorySqlite,
    deriveInventoryLookupQuery,
    searchInventoryIndex,
    executeInventoryLookup
  };
}

module.exports = {
  createAgentInventoryLookupRuntime
};
