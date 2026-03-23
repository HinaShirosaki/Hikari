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

function createAgentRecordLookupRuntime(deps = {}) {
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

  function buildRecordFallbackItems({ snapshot = {}, query = '', terms = [], limit = 8 }) {
    const records = [];

    asArray(snapshot?.notebookEntries).forEach((entry) => {
      const payload = ensureObject(entry);
      records.push({
        record_type: 'notebook',
        record_id: cleanText(payload.id, 120),
        title: cleanText(payload.protocolName || payload.id, 220),
        project_id: cleanText(payload.projectId, 120),
        project_name: cleanText(payload.projectName, 220),
        summary: cleanText(payload.result, 500),
        linked_protocol_id: cleanText(payload.protocolId, 120),
        linked_protocol_name: cleanText(payload.protocolName, 220),
        updated_at: cleanText(payload.updatedAt || payload.createdAt, 80),
        search_text: buildSearchText([
          payload.id,
          payload.protocolId,
          payload.protocolName,
          payload.projectId,
          payload.projectName,
          payload.result,
          payload.updatedAt,
          JSON.stringify(payload.values || {})
        ])
      });
    });

    asArray(snapshot?.workflows).forEach((workflow) => {
      const payload = ensureObject(workflow);
      records.push({
        record_type: 'workflow',
        record_id: cleanText(payload.id, 120),
        title: cleanText(payload.name || payload.id, 220),
        project_id: cleanText(payload.projectId, 120),
        project_name: cleanText(payload.projectName, 220),
        summary: cleanText(payload.description, 500),
        linked_protocol_id: '',
        linked_protocol_name: '',
        updated_at: cleanText(payload.updatedAt || payload.createdAt, 80),
        search_text: buildSearchText([
          payload.id,
          payload.name,
          payload.description,
          payload.projectId,
          payload.projectName,
          asArray(payload.blocks).map((block) => block?.text || block?.protocolId).join(' ')
        ])
      });
    });

    asArray(snapshot?.assays).forEach((assay) => {
      const payload = ensureObject(assay);
      records.push({
        record_type: 'assay',
        record_id: cleanText(payload.id || payload.assay_number, 120),
        title: cleanText(payload.name || payload.assay_number || payload.id, 220),
        project_id: cleanText(payload.project_id || payload.projectId, 120),
        project_name: cleanText(payload.project_name || payload.projectName, 220),
        summary: cleanText(payload.notes || payload.notebook_entry_protocol_name || payload.name, 500),
        linked_protocol_id: cleanText(payload.notebook_entry_protocol_id || payload.protocolId, 120),
        linked_protocol_name: cleanText(payload.notebook_entry_protocol_name || payload.protocolName, 220),
        updated_at: cleanText(payload.updated_at || payload.updatedAt || payload.created_at, 80),
        search_text: buildSearchText([
          payload.id,
          payload.assay_number,
          payload.name,
          payload.notes,
          payload.project_id,
          payload.project_name,
          payload.notebook_entry_protocol_name
        ])
      });
    });

    asArray(snapshot?.gelAnalyses).forEach((analysis) => {
      const payload = ensureObject(analysis);
      records.push({
        record_type: 'gel',
        record_id: cleanText(payload.id, 120),
        title: cleanText(payload.name || payload.id, 220),
        project_id: cleanText(payload.project_id || payload.projectId, 120),
        project_name: cleanText(payload.project_name || payload.projectName, 220),
        summary: cleanText(payload.analysis_type || payload.notebook_entry_protocol_name || payload.name, 500),
        linked_protocol_id: cleanText(payload.notebook_entry_protocol_id || payload.protocolId, 120),
        linked_protocol_name: cleanText(payload.notebook_entry_protocol_name || payload.protocolName, 220),
        updated_at: cleanText(payload.updated_at || payload.updatedAt || payload.created_at, 80),
        search_text: buildSearchText([
          payload.id,
          payload.name,
          payload.analysis_type,
          payload.project_id,
          payload.project_name,
          payload.notebook_entry_protocol_name,
          asArray(payload.warnings).join(' ')
        ])
      });
    });

    asArray(snapshot?.protocols).forEach((protocol) => {
      const payload = ensureObject(protocol);
      records.push({
        record_type: 'protocol',
        record_id: cleanText(payload.id, 120),
        title: cleanText(payload.name || payload.id, 220),
        project_id: cleanText(payload.projectId, 120),
        project_name: cleanText(payload.projectName || payload.linkedProject, 220),
        summary: cleanText(payload.purpose || payload.description || payload.category, 500),
        linked_protocol_id: cleanText(payload.id, 120),
        linked_protocol_name: cleanText(payload.name, 220),
        updated_at: cleanText(payload.updatedAt || payload.createdAt, 80),
        search_text: buildSearchText([
          payload.id,
          payload.name,
          payload.purpose,
          payload.description,
          payload.category,
          payload.projectId,
          payload.projectName,
          payload.linkedProject,
          asArray(payload.steps).map((step) => {
            if (typeof step === 'string') {
              return step;
            }
            return step?.text || step?.instruction || step?.action || '';
          }).join(' ')
        ])
      });
    });

    const ranked = rankRows(records, {
      terms,
      query,
      limit: Math.max(Number(limit) || 8, 80),
      getSearchText: (row) => row?.search_text,
      getPrimaryText: (row) => row?.title
    });

    return ranked.slice(0, Math.max(1, Number(limit) || 8)).map((row) => ({
      record_type: cleanText(row.record_type, 40),
      id: cleanText(row.record_id, 120),
      title: cleanText(row.title, 220),
      project_id: cleanText(row.project_id, 120),
      project_name: cleanText(row.project_name, 220),
      summary: cleanText(row.summary, 500),
      linked_protocol_id: cleanText(row.linked_protocol_id, 120),
      linked_protocol_name: cleanText(row.linked_protocol_name, 220),
      updated_at: cleanText(row.updated_at, 80)
    }));
  }

  async function searchRecordSqlite({ sqlitePath = '', query = '', searchTerms = [], limit = 8 }) {
    const dbResult = await withSqliteDatabase(sqlitePath, async (db) => {
      const tables = readSqliteTables(db);
      const hasRecordIndex = tables.has('record_index');
      const terms = uniqueStrings(searchTerms, 10);

      if (!hasRecordIndex) {
        return {
          usedSqlite: true,
          items: [],
          tableStatus: {
            record_index_exists: false,
            record_index_row_count: 0
          }
        };
      }

      const rowCount = Number(querySqlRows(db, 'SELECT COUNT(1) AS count FROM record_index', [])[0]?.count || 0);
      const rows = collectLikeMatches(db, {
        tableName: 'record_index',
        selectColumns: [
          'record_type',
          'record_id',
          'title',
          'project_id',
          'project_name',
          'summary',
          'linked_protocol_id',
          'linked_protocol_name',
          'updated_at',
          'search_text'
        ],
        terms,
        tableAvailable: hasRecordIndex,
        mapRow: (row) => ({
          record_type: cleanText(row?.record_type, 40),
          record_id: cleanText(row?.record_id, 120),
          title: cleanText(row?.title, 220),
          project_id: cleanText(row?.project_id, 120),
          project_name: cleanText(row?.project_name, 220),
          summary: cleanText(row?.summary, 500),
          linked_protocol_id: cleanText(row?.linked_protocol_id, 120),
          linked_protocol_name: cleanText(row?.linked_protocol_name, 220),
          updated_at: cleanText(row?.updated_at, 80),
          search_text: cleanText(row?.search_text, 5000)
        }),
        dedupeKey: (row) => `${cleanText(row.record_type, 40).toLowerCase()}::${cleanText(row.record_id, 120).toLowerCase()}`
      });

      const ranked = rankRows(rows, {
        terms,
        query,
        limit: Math.max(1, Number(limit) || 8),
        getSearchText: (row) => row?.search_text,
        getPrimaryText: (row) => row?.title
      });

      return {
        usedSqlite: true,
        items: ranked.map((row) => ({
          record_type: cleanText(row.record_type, 40),
          id: cleanText(row.record_id, 120),
          title: cleanText(row.title, 220),
          project_id: cleanText(row.project_id, 120),
          project_name: cleanText(row.project_name, 220),
          summary: cleanText(row.summary, 500),
          linked_protocol_id: cleanText(row.linked_protocol_id, 120),
          linked_protocol_name: cleanText(row.linked_protocol_name, 220),
          updated_at: cleanText(row.updated_at, 80)
        })),
        tableStatus: {
          record_index_exists: true,
          record_index_row_count: rowCount
        }
      };
    });

    if (!dbResult.ok) {
      return {
        usedSqlite: false,
        sqliteReason: dbResult.reason,
        items: [],
        tableStatus: {
          record_index_exists: false,
          record_index_row_count: 0
        }
      };
    }

    return dbResult.result;
  }

  function deriveRecordLookupQuery({ message = '', parserPayload = {} } = {}) {
    const parser = ensureObject(parserPayload);
    const entities = ensureObject(parser.entities);
    return cleanText(
      entities.requested_output
      || entities.protocol_name
      || entities.project_name
      || entities.activity_type
      || message,
      300
    );
  }

  async function searchRecordIndex({
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

    const termsUsed = buildTerms({ query, terms: searchTerms, maxTerms: 10 });
    const sqlResult = await searchRecordSqlite({
      sqlitePath: context.sqlitePath,
      query,
      searchTerms: termsUsed,
      limit
    });
    const fallbackItems = buildRecordFallbackItems({
      snapshot: context.hydratedSnapshot,
      query,
      terms: termsUsed,
      limit
    });

    let source = sqlResult.usedSqlite ? 'sqlite' : 'fallback_json';
    let items = asArray(sqlResult.items).slice(0, Math.max(1, Number(limit) || 8));
    if (!items.length && fallbackItems.length) {
      source = 'fallback_json';
      items = fallbackItems.slice(0, Math.max(1, Number(limit) || 8));
    }

    const shouldBackfill = Boolean(
      context.dataFilePath
      && (
        !sqlResult.usedSqlite
        || sqlResult.tableStatus?.record_index_exists !== true
        || Number(sqlResult.tableStatus?.record_index_row_count || 0) === 0
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
      const rerun = await searchRecordSqlite({
        sqlitePath: context.sqlitePath,
        query,
        searchTerms: termsUsed,
        limit
      });
      if (asArray(rerun.items).length) {
        items = mergeRowsByKey(
          rerun.items,
          fallbackItems,
          (row) => `${cleanText(row?.record_type, 40)}::${cleanText(row?.id, 120)}`
        ).slice(0, Math.max(1, Number(limit) || 8));
        source = items.length > asArray(rerun.items).length ? 'sqlite+fallback' : 'sqlite';
      }
    }

    return {
      items,
      usedSqlite: source.startsWith('sqlite'),
      source,
      backfilledSql,
      query: cleanText(query, 300),
      termsUsed
    };
  }

  async function executeRecordLookup({
    message = '',
    parserPayload = {},
    snapshot = {},
    dataFilePath = '',
    fallbackDataFilePath = '',
    limit = 8
  } = {}) {
    const query = deriveRecordLookupQuery({ message, parserPayload });
    const parser = ensureObject(parserPayload);
    const entities = ensureObject(parser.entities);
    const terms = buildTerms({
      query,
      terms: [
        entities.project_name,
        entities.protocol_name,
        entities.workflow_step,
        entities.requested_output,
        entities.activity_type
      ],
      maxTerms: 10
    });

    const searchResult = await searchRecordIndex({
      dataFilePath,
      fallbackDataFilePath,
      query,
      limit,
      searchTerms: terms,
      snapshot
    });

    const items = asArray(searchResult.items).slice(0, Math.max(1, Number(limit) || 8));
    return {
      status: items.length ? 'matched' : 'no_match',
      query: cleanText(searchResult.query || query, 300),
      source: cleanText(searchResult.source, 80) || 'fallback_json',
      backfilled_sql: searchResult.backfilledSql === true,
      items
    };
  }

  return {
    buildRecordFallbackItems,
    searchRecordSqlite,
    deriveRecordLookupQuery,
    searchRecordIndex,
    executeRecordLookup
  };
}

module.exports = {
  createAgentRecordLookupRuntime
};
