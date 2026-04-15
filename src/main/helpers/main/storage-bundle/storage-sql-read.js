'use strict';

const fs = require('fs/promises');
const {
  asArray,
  cleanText,
  ensureObject,
  loadSqlJs,
  parseJsonArray,
  parseJsonObject
} = require('./storage-utils');

function readSqlRows(db, sql, values = []) {
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
}

function readProtocolRowsFromSqlite(rows) {
  return asArray(rows).map((row, index) => {
    const source = ensureObject(row);
    const id = cleanText(source.id, 220) || `protocol_${index + 1}`;
    const name = cleanText(source.name, 320) || `Protocol ${index + 1}`;
    return {
      id,
      name,
      category: cleanText(source.category, 120),
      purpose: cleanText(source.description, 4000),
      materials: [],
      steps: parseJsonArray(source.steps_preview_json).map((step) => ({
        id: `${id}_step_${Math.random().toString(16).slice(2, 8)}`,
        text: cleanText(step, 1200),
        placeholders: []
      })),
      troubleshooting: [],
      tags: parseJsonArray(source.tags_json),
      linkedProject: cleanText(source.linked_project, 240),
      createdAt: cleanText(source.updated_at, 80),
      updatedAt: cleanText(source.updated_at, 80)
    };
  });
}

function readNotebookRowsFromSqlite(rows) {
  return asArray(rows).map((row, index) => {
    const source = ensureObject(row);
    const workflowId = cleanText(source.workflow_id, 120);
    const proposalId = cleanText(source.proposal_id, 160);
    return {
      id: cleanText(source.id, 220) || `notebook_${index + 1}`,
      protocolId: cleanText(source.protocol_id, 220),
      protocolName: cleanText(source.protocol_name, 320),
      projectId: cleanText(source.project_id, 220),
      projectName: cleanText(source.project_name, 320),
      result: cleanText(source.result, 12000),
      resultFiles: [],
      resultFileRecords: [],
      resultFileAddresses: [],
      notebookState: cleanText(source.notebook_state, 40).toLowerCase() === 'planned' ? 'planned' : 'executed',
      executedAt: cleanText(source.executed_at, 80),
      agentDraftStatus: cleanText(source.agent_draft_status, 80),
      agentDraftMeta: {
        workflowId,
        proposalId
      },
      updatedAt: cleanText(source.updated_at, 80),
      createdAt: cleanText(source.created_at, 80)
    };
  });
}

function readPaperRowsFromSqlite(rows) {
  return asArray(rows).map((row, index) => {
    const source = ensureObject(row);
    const parsed = parseJsonObject(source.raw_json);
    if (parsed) {
      return parsed;
    }
    return {
      id: cleanText(source.id, 220) || `paper_${index + 1}`,
      title: cleanText(source.title, 320) || `Paper ${index + 1}`,
      fileName: cleanText(source.file_name, 320),
      linkedType: cleanText(source.linked_type, 80),
      linkedId: cleanText(source.linked_id, 220),
      linkedName: cleanText(source.linked_name, 320),
      storedRelativePath: cleanText(source.stored_relative_path, 2400),
      availabilityStatus: cleanText(source.availability_status, 80),
      ingestionStatus: cleanText(source.ingestion_status, 80),
      summaryStatus: cleanText(source.summary_status, 80),
      methodsStatus: cleanText(source.methods_status, 80),
      reagentsStatus: cleanText(source.reagents_status, 80),
      discoveredAt: cleanText(source.discovered_at, 80),
      updatedAt: cleanText(source.updated_at, 80)
    };
  });
}

async function readSqliteBundleIndex(sqlitePath) {
  try {
    const bytes = await fs.readFile(sqlitePath);
    if (!bytes.length) {
      return {
        exists: true,
        inventoryChemicals: [],
        inventoryPersonal: [],
        inventorySamples: [],
        protocolRows: [],
        notebookRows: [],
        paperRows: [],
        recordRows: [],
        inventoryMeta: {}
      };
    }
    const SQL = await loadSqlJs();
    const db = new SQL.Database(new Uint8Array(bytes));
    try {
      const tableRows = readSqlRows(db, "SELECT name FROM sqlite_master WHERE type='table'", []);
      const tableNames = new Set(asArray(tableRows).map((row) => cleanText(row?.name, 220).toLowerCase()).filter(Boolean));
      const inventoryChemicalRows = tableNames.has('inventory_chemicals')
        ? readSqlRows(db, 'SELECT * FROM inventory_chemicals', [])
        : [];
      const inventoryChemicals = inventoryChemicalRows.map((row) => parseJsonObject(row.raw_json) || {
        id: cleanText(row.id, 220),
        name: cleanText(row.name, 320),
        amount: cleanText(row.amount, 120),
        cas: cleanText(row.cas, 120),
        location: cleanText(row.location, 280),
        supplier: cleanText(row.supplier, 240)
      });
      const inventoryPersonalRows = tableNames.has('inventory_personal')
        ? readSqlRows(db, 'SELECT * FROM inventory_personal', [])
        : [];
      const inventoryPersonal = inventoryPersonalRows.map((row) => ({
        zone: cleanText(row.zone, 200),
        item: parseJsonObject(row.raw_json) || {
          id: cleanText(row.id, 220),
          name: cleanText(row.name, 320),
          quantity: cleanText(row.quantity, 120),
          location: cleanText(row.location, 240)
        }
      }));
      const inventorySampleRows = tableNames.has('inventory_samples')
        ? readSqlRows(db, 'SELECT * FROM inventory_samples', [])
        : [];
      const inventorySamples = inventorySampleRows.map((row) => parseJsonObject(row.raw_json) || {
        id: cleanText(row.id, 220),
        code: cleanText(row.code, 180),
        name: cleanText(row.name, 320),
        type: cleanText(row.sample_type, 80),
        concentration: cleanText(row.concentration, 160),
        lot: cleanText(row.lot, 160),
        inventoryLink: {
          section: cleanText(row.section, 200),
          containerId: cleanText(row.container_id, 220),
          wellIndex: Number.isFinite(Number(row.well_index)) ? Number(row.well_index) : null
        },
        notes: cleanText(row.notes, 4000),
        updatedAt: cleanText(row.updated_at, 80)
      });
      const protocolRows = tableNames.has('protocol_index')
        ? readSqlRows(db, 'SELECT * FROM protocol_index', [])
        : [];
      const notebookRows = tableNames.has('notebook_index')
        ? readSqlRows(db, 'SELECT * FROM notebook_index', [])
        : [];
      const paperRows = tableNames.has('paper_index')
        ? readSqlRows(db, 'SELECT * FROM paper_index', [])
        : [];
      const recordRows = tableNames.has('record_index')
        ? readSqlRows(db, 'SELECT * FROM record_index', [])
        : [];
      const inventoryMetaRows = tableNames.has('inventory_meta')
        ? readSqlRows(db, 'SELECT * FROM inventory_meta', [])
        : [];
      const inventoryMeta = {};
      inventoryMetaRows.forEach((row) => {
        const key = cleanText(row.key, 220);
        if (!key) {
          return;
        }
        try {
          inventoryMeta[key] = JSON.parse(String(row.value_json || 'null'));
        } catch {
          inventoryMeta[key] = null;
        }
      });
      return {
        exists: true,
        inventoryChemicals,
        inventoryPersonal,
        inventorySamples,
        protocolRows,
        notebookRows,
        paperRows,
        recordRows,
        inventoryMeta
      };
    } finally {
      db.close();
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        exists: false,
        inventoryChemicals: [],
        inventoryPersonal: [],
        inventorySamples: [],
        protocolRows: [],
        notebookRows: [],
        paperRows: [],
        recordRows: [],
        inventoryMeta: {}
      };
    }
    throw error;
  }
}

module.exports = {
  readNotebookRowsFromSqlite,
  readPaperRowsFromSqlite,
  readProtocolRowsFromSqlite,
  readSqlRows,
  readSqliteBundleIndex
};
