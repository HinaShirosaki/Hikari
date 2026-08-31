'use strict';

// SQLite-backed inventory search. Every database primitive is injected so the
// runtime keeps ownership of connection handling and index backfill.
function createInventorySqliteSearch({
  asArray,
  cleanText,
  uniqueStrings,
  rankRows,
  withSqliteDatabase,
  readSqliteTables,
  collectLikeMatches,
  querySqlRows
} = {}) {
  // Chemicals live in their own bundle file; personal/samples live in the common one.
  async function searchInventorySqlite({ sqlitePath = '', chemicalsSqlitePath = '', query = '', searchTerms = [], limit = 8, kinds = [] }) {
    const dbResult = await withSqliteDatabase(sqlitePath, async (db) => {
      const tables = readSqliteTables(db);
      const hasPersonal = tables.has('inventory_personal');
      const hasSamples = tables.has('inventory_samples');
      const sampleRowCount = hasSamples
        ? Number(querySqlRows(db, 'SELECT COUNT(1) AS count FROM inventory_samples', [])[0]?.count || 0)
        : 0;

      const terms = uniqueStrings(searchTerms, 10);

      const chemicalLookup = await withSqliteDatabase(chemicalsSqlitePath, async (chemicalDb) => collectLikeMatches(chemicalDb, {
        tableName: 'inventory_chemicals',
        selectColumns: ['id', 'name', 'amount', 'cas', 'location', 'supplier', 'search_text'],
        terms,
        tableAvailable: readSqliteTables(chemicalDb).has('inventory_chemicals'),
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
      }));
      const hasChemicals = chemicalLookup.ok;
      const chemicalRows = asArray(chemicalLookup.result);

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

      // Scope to the requested kinds before ranking so one kind cannot crowd out another.
      const kindSet = asArray(kinds).map((kind) => cleanText(kind, 40)).filter(Boolean);
      const allRows = [...chemicalRows, ...personalRows, ...sampleRows];
      const scopedRows = kindSet.length
        ? allRows.filter((row) => kindSet.includes(cleanText(row?.kind, 40)))
        : allRows;
      const ranked = rankRows(
        scopedRows,
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

  return { searchInventorySqlite };
}

module.exports = { createInventorySqliteSearch };
