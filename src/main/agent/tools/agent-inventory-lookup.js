'use strict';

const { createInventorySnapshotSearch } = require('./inventory-lookup/snapshot-search.js');
const { createInventorySqliteSearch } = require('./inventory-lookup/sqlite-search.js');

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
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
        terms: asArray(source.candidate_terms),
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

  const {
    resolvePersonalSections,
    buildContainerMapFromSnapshot,
    formatSampleLocation,
    buildInventoryFallbackItems
  } = createInventorySnapshotSearch({
    asArray,
    cleanText,
    ensureObject,
    uniqueStrings,
    buildSearchText,
    rankRows
  });

  const { searchInventorySqlite } = createInventorySqliteSearch({
    asArray,
    cleanText,
    uniqueStrings,
    rankRows,
    withSqliteDatabase,
    readSqliteTables,
    collectLikeMatches,
    querySqlRows
  });

  function deriveInventoryLookupQuery({ message = '', parserPayload = {} } = {}) {
    const parser = ensureObject(parserPayload);
    const entities = ensureObject(parser.entities);
    const inventorySearch = ensureObject(parser.inventory_search);
    return cleanText(
      asArray(inventorySearch.candidate_terms)[0]
      || entities.inventory_item
      || entities.compound_name
      || message
      || entities.requested_output,
      300
    );
  }

  async function searchInventoryIndex({
    dataFilePath = '',
    fallbackDataFilePath = '',
    query = '',
    limit = 8,
    searchTerms = [],
    snapshot = {},
    kinds = []
  } = {}) {
    const context = await buildLookupContext({
      dataFilePath,
      fallbackDataFilePath,
      snapshot
    });

    // Optional kind scope (e.g. chemical_lookup passes ['chemical']); empty means all kinds.
    const kindSet = asArray(kinds).map((kind) => cleanText(kind, 40)).filter(Boolean);
    const scopeItems = (rows) => (kindSet.length
      ? asArray(rows).filter((row) => kindSet.includes(cleanText(row?.kind, 40)))
      : asArray(rows));

    const termsUsed = buildTerms({
      query,
      terms: asArray(searchTerms),
      maxTerms: 10
    });

    const sqlResult = await searchInventorySqlite({
      sqlitePath: context.sqlitePath,
      chemicalsSqlitePath: context.bundlePaths?.chemicalsSqlitePath || '',
      query,
      searchTerms: termsUsed,
      limit,
      kinds: kindSet
    });
    const fallbackResult = buildInventoryFallbackItems({
      snapshot: context.hydratedSnapshot,
      query,
      searchTerms: termsUsed,
      limit,
      kinds: kindSet
    });

    const sqlItems = scopeItems(sqlResult.items);
    const fallbackItems = scopeItems(fallbackResult.items);

    let source = sqlResult.usedSqlite ? 'sqlite' : 'fallback_json';
    let items = sqlItems.slice(0, Math.max(1, Number(limit) || 8));

    if (!items.length && fallbackItems.length) {
      source = 'fallback_json';
      items = fallbackItems.slice(0, Math.max(1, Number(limit) || 8));
    }

    const hasSnapshotSamples = asArray(context.hydratedSnapshot?.samples).length > 0;
    const sqlSampleTableExists = sqlResult.tableStatus?.inventory_samples_exists === true;
    const sqlSampleRowCount = Number(sqlResult.tableStatus?.inventory_samples_row_count) || 0;

    const shouldBackfill = Boolean(
      context.dataFilePath
      && (
        !sqlResult.usedSqlite
        || (hasSnapshotSamples && (!sqlSampleTableExists || sqlSampleRowCount === 0))
        || (source === 'fallback_json' && fallbackItems.length > 0)
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
        chemicalsSqlitePath: context.bundlePaths?.chemicalsSqlitePath || '',
        query,
        searchTerms: termsUsed,
        limit,
        kinds: kindSet
      });
      const rerunItems = scopeItems(rerun.items);
      if (rerunItems.length) {
        const merged = mergeRowsByKey(
          rerunItems,
          fallbackItems,
          (row) => `${cleanText(row?.kind, 40)}::${cleanText(row?.zone, 120)}::${cleanText(row?.id, 120)}`
        );
        items = merged.slice(0, Math.max(1, Number(limit) || 8));
        source = merged.length > rerunItems.length ? 'sqlite+fallback' : 'sqlite';
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
    limit = 8,
    kinds = []
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
      snapshot,
      kinds
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
