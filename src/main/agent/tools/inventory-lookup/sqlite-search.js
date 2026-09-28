'use strict';

// Chemical search over the chemicals index, the one inventory kind stored in
// SQLite. Containers and samples are searched in the loaded state instead (see
// snapshot-search.js). Every database primitive is injected so the runtime keeps
// ownership of connection handling.
function createInventorySqliteSearch({
  asArray,
  cleanText,
  uniqueStrings,
  rankRows,
  withSqliteDatabase,
  readSqliteTables,
  collectLikeMatches
} = {}) {
  async function searchInventorySqlite({ chemicalsSqlitePath = '', query = '', searchTerms = [], limit = 8 }) {
    const lookup = await withSqliteDatabase(chemicalsSqlitePath, async (db) => collectLikeMatches(db, {
      tableName: 'inventory_chemicals',
      selectColumns: ['id', 'name', 'amount', 'cas', 'location', 'supplier', 'search_text'],
      terms: uniqueStrings(searchTerms, 10),
      tableAvailable: readSqliteTables(db).has('inventory_chemicals'),
      mapRow: (row) => ({
        kind: 'chemical',
        zone: 'Lab Inventory',
        id: cleanText(row?.id, 120),
        name: cleanText(row?.name, 220),
        amount: cleanText(row?.amount, 80),
        cas: cleanText(row?.cas, 80),
        location: cleanText(row?.location, 220),
        supplier: cleanText(row?.supplier, 180),
        search_text: cleanText(row?.search_text, 4000)
      }),
      dedupeKey: (row) => `chemical::${cleanText(row.id, 120).toLowerCase()}`
    }));
    if (!lookup.ok) {
      return { usedSqlite: false, sqliteReason: lookup.reason, items: [] };
    }

    const ranked = rankRows(asArray(lookup.result), {
      terms: searchTerms,
      query,
      limit: Math.max(1, Number(limit) || 8),
      getSearchText: (row) => row?.search_text,
      getPrimaryText: (row) => row?.name
    });
    return {
      usedSqlite: true,
      items: ranked.map((row) => {
        const matched = asArray(row.matched_terms).find((term) => String(row.search_text || '').includes(term));
        return {
          kind: 'chemical',
          zone: cleanText(row.zone, 120),
          id: cleanText(row.id, 120),
          name: cleanText(row.name, 220),
          quantity: '',
          amount: cleanText(row.amount, 80),
          cas: cleanText(row.cas, 80),
          location: cleanText(row.location, 220),
          supplier: cleanText(row.supplier, 180),
          matched_term: cleanText(matched || asArray(searchTerms)[0], 140),
          score: row._score
        };
      })
    };
  }

  return { searchInventorySqlite };
}

module.exports = { createInventorySqliteSearch };
