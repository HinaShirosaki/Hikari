'use strict';

const { createInventorySnapshotSearch } = require('./inventory-lookup/snapshot-search.js');
const { createInventorySqliteSearch } = require('./inventory-lookup/sqlite-search.js');
const {
  asArray: defaultAsArray,
  ensureObject: defaultEnsureObject
} = require('../../lib/normalize.js');

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

const ALL_INVENTORY_KINDS = ['chemical', 'personal_container', 'personal_sample'];

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
    collectLikeMatches
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

    // Chemicals come from their SQLite index; containers and samples from the
    // loaded state (their JSON is the only copy). If the chemicals index cannot
    // be read, the loaded state answers for chemicals too.
    const maxItems = Math.max(1, Number(limit) || 8);
    const wantsChemicals = !kindSet.length || kindSet.includes('chemical');
    const sqlResult = wantsChemicals
      ? await searchInventorySqlite({
        chemicalsSqlitePath: context.bundlePaths?.chemicalsSqlitePath || '',
        query,
        searchTerms: termsUsed,
        limit
      })
      : { usedSqlite: false, items: [] };
    const snapshotKinds = sqlResult.usedSqlite
      ? (kindSet.length ? kindSet : ALL_INVENTORY_KINDS).filter((kind) => kind !== 'chemical')
      : kindSet;
    const snapshotItems = sqlResult.usedSqlite && !snapshotKinds.length
      ? []
      : buildInventoryFallbackItems({
        snapshot: context.hydratedSnapshot,
        query,
        searchTerms: termsUsed,
        limit,
        kinds: snapshotKinds
      }).items;
    const items = [...scopeItems(sqlResult.items), ...scopeItems(snapshotItems)]
      .sort((left, right) => (Number(right.score) || 0) - (Number(left.score) || 0))
      .slice(0, maxItems)
      .map(({ score: _score, ...item }) => item);
    let source = 'fallback_json';
    if (sqlResult.usedSqlite) {
      source = snapshotItems.length ? 'sqlite+fallback' : 'sqlite';
    }

    return {
      items,
      usedSqlite: sqlResult.usedSqlite === true,
      source,
      termsUsed,
      backfilledSql: false,
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
