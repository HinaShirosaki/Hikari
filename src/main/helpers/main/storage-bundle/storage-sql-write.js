'use strict';

const fs = require('fs/promises');
const path = require('path');
const { applySqliteSchema } = require('./storage-sql-schema');
const {
  asArray,
  buildSearchText,
  cleanText,
  ensureObject,
  loadSqlJs
} = require('./storage-utils');

function extractProtocolStepText(step) {
  if (typeof step === 'string') {
    return cleanText(step, 1200);
  }
  const source = ensureObject(step);
  return cleanText(source.text || source.instruction || source.action || source.title, 1200);
}

function resolvePersonalInventorySections(inventoryPayload) {
  const inventory = ensureObject(inventoryPayload);
  if (Array.isArray(inventory.personal)) {
    return asArray(inventory.personal).map((zone) => ({
      zone: cleanText(zone?.zone, 200),
      items: asArray(zone?.items)
    })).filter((zone) => zone.zone || zone.items.length > 0);
  }
  if (inventory.personal && typeof inventory.personal === 'object') {
    return Object.entries(inventory.personal).map(([zoneName, rawItems]) => ({
      zone: cleanText(zoneName, 200),
      items: asArray(rawItems)
    })).filter((zone) => zone.zone || zone.items.length > 0);
  }
  return Object.entries(inventory)
    .filter(([zoneName, rawItems]) => zoneName !== 'chemicals' && zoneName !== 'personal' && Array.isArray(rawItems))
    .map(([zoneName, rawItems]) => ({
      zone: cleanText(zoneName, 200),
      items: asArray(rawItems)
    }));
}

function buildPersonalContainerLookup(snapshot) {
  const out = new Map();
  const sections = resolvePersonalInventorySections(ensureObject(snapshot).inventory);
  sections.forEach((section) => {
    asArray(section.items).forEach((container) => {
      const normalizedContainer = ensureObject(container);
      const containerId = cleanText(normalizedContainer.id, 220);
      if (!containerId) {
        return;
      }
      const key = `${cleanText(section.zone, 200).toLowerCase()}::${containerId.toLowerCase()}`;
      out.set(key, {
        zone: cleanText(section.zone, 200),
        id: containerId,
        name: cleanText(normalizedContainer.name, 320),
        location: cleanText(normalizedContainer.location, 240)
      });
    });
  });
  return out;
}

function formatSampleLocationText(rawLocation) {
  const location = ensureObject(rawLocation);
  return Object.entries(location)
    .filter(([key]) => key !== 'storageType')
    .map(([, value]) => cleanText(value, 120))
    .filter(Boolean)
    .join(' / ');
}

function collectRecordIndexRows(snapshot, updatedAtDefault) {
  const rows = [];
  const pushRow = (recordType, recordId, payload = {}) => {
    const normalizedType = cleanText(recordType, 60);
    const normalizedId = cleanText(recordId, 220);
    if (!normalizedType || !normalizedId) {
      return;
    }
    const title = cleanText(payload.title, 320) || `${normalizedType}:${normalizedId}`;
    const projectId = cleanText(payload.projectId, 220);
    const projectName = cleanText(payload.projectName, 320);
    const summary = cleanText(payload.summary, 6000);
    const linkedProtocolId = cleanText(payload.linkedProtocolId, 220);
    const linkedProtocolName = cleanText(payload.linkedProtocolName, 320);
    const updatedAt = cleanText(payload.updatedAt, 80) || updatedAtDefault;
    const searchText = buildSearchText([
      normalizedType,
      normalizedId,
      title,
      projectId,
      projectName,
      summary,
      linkedProtocolId,
      linkedProtocolName,
      updatedAt,
      payload.searchHints
    ]);
    rows.push({
      record_type: normalizedType,
      record_id: normalizedId,
      title,
      project_id: projectId,
      project_name: projectName,
      summary,
      linked_protocol_id: linkedProtocolId,
      linked_protocol_name: linkedProtocolName,
      updated_at: updatedAt,
      search_text: searchText,
      raw_json: JSON.stringify(payload.raw || {})
    });
  };

  asArray(snapshot.notebookEntries).forEach((rawEntry) => {
    const entry = ensureObject(rawEntry);
    pushRow('notebook', entry.id, {
      title: entry.protocolName || entry.id,
      projectId: entry.projectId,
      projectName: entry.projectName,
      summary: entry.result,
      linkedProtocolId: entry.protocolId,
      linkedProtocolName: entry.protocolName,
      updatedAt: entry.updatedAt || entry.createdAt,
      searchHints: [
        asArray(entry.resultFiles).join(' '),
        JSON.stringify(entry.values || {})
      ].join(' '),
      raw: entry
    });
  });

  asArray(snapshot.workflows).forEach((rawWorkflow) => {
    const workflow = ensureObject(rawWorkflow);
    pushRow('workflow', workflow.id, {
      title: workflow.name || workflow.id,
      projectId: workflow.projectId,
      projectName: workflow.projectName,
      summary: workflow.description,
      updatedAt: workflow.updatedAt || workflow.createdAt,
      searchHints: asArray(workflow.blocks).map((block) => block?.text || block?.protocolId || '').join(' '),
      raw: workflow
    });
  });

  asArray(snapshot.assays).forEach((rawAssay) => {
    const assay = ensureObject(rawAssay);
    pushRow('assay', assay.id || assay.assay_number, {
      title: assay.name || assay.assay_number || assay.id,
      projectId: assay.project_id || assay.projectId,
      projectName: assay.project_name || assay.projectName,
      summary: assay.notes || assay.notebook_entry_protocol_name || assay.name,
      linkedProtocolId: assay.notebook_entry_protocol_id || assay.protocolId,
      linkedProtocolName: assay.notebook_entry_protocol_name || assay.protocolName,
      updatedAt: assay.updated_at || assay.updatedAt || assay.created_at,
      searchHints: [
        assay.assay_number,
        assay.sample_axis,
        assay.concentration_axis
      ].join(' '),
      raw: assay
    });
  });

  asArray(snapshot.gelAnalyses).forEach((rawGel) => {
    const gel = ensureObject(rawGel);
    pushRow('gel', gel.id, {
      title: gel.name || gel.id,
      projectId: gel.project_id || gel.projectId,
      projectName: gel.project_name || gel.projectName,
      summary: gel.analysis_type || gel.notebook_entry_protocol_name || gel.name,
      linkedProtocolId: gel.notebook_entry_protocol_id || gel.protocolId,
      linkedProtocolName: gel.notebook_entry_protocol_name || gel.protocolName,
      updatedAt: gel.updated_at || gel.updatedAt || gel.created_at,
      searchHints: asArray(gel.warnings).join(' '),
      raw: gel
    });
  });

  asArray(snapshot.protocols).forEach((rawProtocol) => {
    const protocol = ensureObject(rawProtocol);
    const stepHints = asArray(protocol.steps).map((step) => (
      typeof step === 'string'
        ? cleanText(step, 220)
        : cleanText(ensureObject(step).text || ensureObject(step).instruction || ensureObject(step).action, 220)
    )).filter(Boolean).join(' ');
    pushRow('protocol', protocol.id, {
      title: protocol.name || protocol.id,
      projectId: protocol.projectId,
      projectName: protocol.projectName || protocol.linkedProject,
      summary: protocol.purpose || protocol.description || protocol.category,
      linkedProtocolId: protocol.id,
      linkedProtocolName: protocol.name,
      updatedAt: protocol.updatedAt || protocol.createdAt,
      searchHints: stepHints,
      raw: protocol
    });
  });

  return rows;
}

function writeSqlInventoryChemicals(db, snapshot) {
  const chemicals = asArray(ensureObject(snapshot.labInventory).chemicals);
  chemicals.forEach((rawChemical, index) => {
    const chemical = ensureObject(rawChemical);
    const id = cleanText(chemical.id, 220) || `chemical_${index + 1}`;
    const name = cleanText(chemical.name, 320);
    const amount = cleanText(chemical.amountInStock || chemical.amount, 120);
    const cas = cleanText(chemical.casNumber || chemical.cas, 120);
    const location = cleanText(chemical.location || chemical.locationCode, 280);
    const supplier = cleanText(chemical.vendor || chemical.supplier, 240);
    const searchText = buildSearchText([
      id,
      name,
      amount,
      cas,
      location,
      supplier,
      chemical.catalogNumber,
      chemical.unitSize
    ]);
    db.run(
      `INSERT OR REPLACE INTO inventory_chemicals
        (id, name, amount, cas, location, supplier, search_text, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        amount,
        cas,
        location,
        supplier,
        searchText,
        JSON.stringify({
          ...chemical,
          amount,
          cas,
          supplier
        })
      ]
    );
  });
}

function writeSqlInventoryPersonal(db, snapshot) {
  const inventory = ensureObject(snapshot.inventory);
  Object.entries(inventory).forEach(([zoneName, rawContainers]) => {
    const zone = cleanText(zoneName, 200);
    asArray(rawContainers).forEach((rawContainer, index) => {
      const container = ensureObject(rawContainer);
      const id = cleanText(container.id, 220) || `${zone || 'zone'}_${index + 1}`;
      const name = cleanText(container.name, 320);
      const quantity = cleanText(container.quantity, 120);
      const location = cleanText(container.location, 240);
      const wellsSummary = asArray(container.wells)
        .map((well) => (typeof well === 'string' ? cleanText(well, 60) : cleanText(ensureObject(well).content, 60)))
        .filter(Boolean)
        .slice(0, 24)
        .join(' ');
      const searchText = buildSearchText([
        zone,
        id,
        name,
        quantity,
        location,
        container.type,
        container.singleContent,
        wellsSummary
      ]);
      db.run(
        `INSERT OR REPLACE INTO inventory_personal
          (zone, id, name, quantity, location, search_text, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          zone,
          id,
          name,
          quantity,
          location,
          searchText,
          JSON.stringify(container)
        ]
      );
    });
  });
}

function writeSqlInventorySamples(db, snapshot) {
  const samples = asArray(snapshot.samples);
  const containerLookup = buildPersonalContainerLookup(snapshot);
  samples.forEach((rawSample, index) => {
    const sample = ensureObject(rawSample);
    const id = cleanText(sample.id, 220) || `sample_${index + 1}`;
    const code = cleanText(sample.code, 180);
    const name = cleanText(sample.name, 320);
    const sampleType = cleanText(sample.type, 80);
    const lot = cleanText(sample.lot, 160);
    const concentration = cleanText(sample.concentration, 160);
    const notes = cleanText(sample.notes, 4000);
    const link = ensureObject(sample.inventoryLink);
    const section = cleanText(link.section, 200);
    const containerId = cleanText(link.containerId, 220);
    const containerKey = `${section.toLowerCase()}::${containerId.toLowerCase()}`;
    const linkedContainer = containerLookup.get(containerKey);
    const containerName = cleanText(linkedContainer?.name, 320);
    const wellIndex = Number.isFinite(Number(link.wellIndex)) ? Number(link.wellIndex) : null;
    const locationText = formatSampleLocationText(sample.location) || cleanText(linkedContainer?.location, 240);
    const searchText = buildSearchText([
      id,
      code,
      name,
      sampleType,
      lot,
      concentration,
      notes,
      section,
      containerId,
      containerName,
      Number.isFinite(wellIndex) ? String(wellIndex) : '',
      locationText,
      asArray(sample.chemicalLinks).join(' ')
    ]);
    db.run(
      `INSERT OR REPLACE INTO inventory_samples
        (id, code, name, sample_type, lot, concentration, section, container_id, container_name, well_index, location_text, notes, chemical_links_json, search_text, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        code,
        name,
        sampleType,
        lot,
        concentration,
        section,
        containerId,
        containerName,
        Number.isFinite(wellIndex) ? wellIndex : null,
        locationText,
        notes,
        JSON.stringify(asArray(sample.chemicalLinks).map((value) => cleanText(value, 120)).filter(Boolean)),
        searchText,
        JSON.stringify(sample)
      ]
    );
  });
}

function writeSqlProtocolIndex(db, snapshot, updatedAtDefault) {
  const protocols = asArray(snapshot.protocols);
  protocols.forEach((rawProtocol, index) => {
    const protocol = ensureObject(rawProtocol);
    const id = cleanText(protocol.id, 220) || `protocol_${index + 1}`;
    const name = cleanText(protocol.name, 320);
    const category = cleanText(protocol.category, 120);
    const description = cleanText(protocol.purpose || protocol.description, 4000);
    const tags = asArray(protocol.tags).map((value) => cleanText(value, 120)).filter(Boolean);
    const linkedProject = cleanText(protocol.linkedProject || protocol.projectName || protocol.projectId, 240);
    const steps = asArray(protocol.steps).map((step) => extractProtocolStepText(step)).filter(Boolean);
    const searchText = buildSearchText([
      id,
      name,
      category,
      description,
      linkedProject,
      tags.join(' '),
      asArray(protocol.materials).join(' '),
      steps.join(' '),
      asArray(protocol.troubleshooting)
        .map((row) => (typeof row === 'string' ? row : JSON.stringify(row)))
        .join(' ')
    ]);
    db.run(
      `INSERT OR REPLACE INTO protocol_index
        (id, name, category, description, tags_json, linked_project, step_count, steps_preview_json, search_text, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        category,
        description,
        JSON.stringify(tags),
        linkedProject,
        Math.max(0, steps.length),
        JSON.stringify(steps.slice(0, 80)),
        searchText,
        cleanText(protocol.updatedAt || protocol.createdAt, 80) || updatedAtDefault
      ]
    );
  });
}

function writeSqlNotebookIndex(db, snapshot, updatedAtDefault) {
  const notebookEntries = asArray(snapshot.notebookEntries);
  notebookEntries.forEach((rawEntry, index) => {
    const entry = ensureObject(rawEntry);
    const id = cleanText(entry.id, 220) || `notebook_${index + 1}`;
    const protocolId = cleanText(entry.protocolId, 220);
    const protocolName = cleanText(entry.protocolName, 320);
    const projectId = cleanText(entry.projectId, 220);
    const projectName = cleanText(entry.projectName, 320);
    const result = cleanText(entry.result, 12000);
    const notebookState = cleanText(entry.notebookState, 40).toLowerCase() === 'planned' ? 'planned' : 'executed';
    const executedAt = cleanText(entry.executedAt, 80);
    const agentDraftStatus = cleanText(entry.agentDraftStatus, 80);
    const workflowId = cleanText(entry?.agentDraftMeta?.workflowId, 120);
    const proposalId = cleanText(entry?.agentDraftMeta?.proposalId, 160);
    const updatedAt = cleanText(entry.updatedAt, 80) || updatedAtDefault;
    const createdAt = cleanText(entry.createdAt, 80);
    const linkedRefs = {
      assays: asArray(entry.assayIds || entry.assays).map((value) => cleanText(value, 120)).filter(Boolean),
      gels: asArray(entry.gelIds || entry.gels).map((value) => cleanText(value, 120)).filter(Boolean),
      files: asArray(entry.resultFiles || entry.resultFileAddresses).map((value) => cleanText(value, 240)).filter(Boolean)
    };
    const searchText = buildSearchText([
      id,
      protocolName,
      projectName,
      result,
      updatedAt,
      asArray(entry.resultFiles).join(' '),
      JSON.stringify(entry.values || {})
    ]);
    db.run(
      `INSERT OR REPLACE INTO notebook_index
        (id, protocol_id, protocol_name, project_id, project_name, result, notebook_state, executed_at, agent_draft_status, workflow_id, proposal_id, updated_at, created_at, linked_refs_json, search_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        protocolId,
        protocolName,
        projectId,
        projectName,
        result,
        notebookState,
        executedAt,
        agentDraftStatus,
        workflowId,
        proposalId,
        updatedAt,
        createdAt,
        JSON.stringify(linkedRefs),
        searchText
      ]
    );
  });
}

function writeSqlRecordIndex(db, snapshot, updatedAtDefault) {
  const rows = collectRecordIndexRows(snapshot, updatedAtDefault);
  rows.forEach((row) => {
    db.run(
      `INSERT OR REPLACE INTO record_index
        (record_type, record_id, title, project_id, project_name, summary, linked_protocol_id, linked_protocol_name, updated_at, search_text, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.record_type,
        row.record_id,
        row.title,
        row.project_id,
        row.project_name,
        row.summary,
        row.linked_protocol_id,
        row.linked_protocol_name,
        row.updated_at,
        row.search_text,
        row.raw_json
      ]
    );
  });
}

function writeSqlInventoryMeta(db, snapshot) {
  const labInventory = ensureObject(snapshot.labInventory);
  const metaRows = [
    ['lab_blocks', JSON.stringify(asArray(labInventory.blocks))],
    ['lab_last_location_number', JSON.stringify(Number(labInventory.lastLocationNumber) || 0)],
    ['lab_location_code_map', JSON.stringify(ensureObject(labInventory.locationCodeMap))],
    ['lab_location_code_next_by_location', JSON.stringify(ensureObject(labInventory.locationCodeNextByLocation))]
  ];
  metaRows.forEach(([key, valueJson]) => {
    db.run(
      'INSERT OR REPLACE INTO inventory_meta (key, value_json) VALUES (?, ?)',
      [key, valueJson]
    );
  });
}

async function writeSqliteBundleIndex(sqlitePath, snapshot) {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  const updatedAtDefault = new Date().toISOString();
  try {
    applySqliteSchema(db);
    writeSqlInventoryChemicals(db, snapshot);
    writeSqlInventoryPersonal(db, snapshot);
    writeSqlInventorySamples(db, snapshot);
    writeSqlProtocolIndex(db, snapshot, updatedAtDefault);
    writeSqlNotebookIndex(db, snapshot, updatedAtDefault);
    writeSqlRecordIndex(db, snapshot, updatedAtDefault);
    writeSqlInventoryMeta(db, snapshot);
    const bytes = db.export();
    await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
    await fs.writeFile(sqlitePath, Buffer.from(bytes));
  } finally {
    db.close();
  }
}

module.exports = {
  writeSqlInventoryChemicals,
  writeSqlInventoryMeta,
  writeSqlInventoryPersonal,
  writeSqlInventorySamples,
  writeSqlNotebookIndex,
  writeSqlProtocolIndex,
  writeSqlRecordIndex,
  writeSqliteBundleIndex
};
