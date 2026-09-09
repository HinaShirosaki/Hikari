'use strict';

const fs = require('fs/promises');
const path = require('path');
const {
  applyChemicalSqliteSchema,
  applyCommonSqliteSchema
} = require('./storage-sql-schema');
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

// Hydration reads only record_type and raw_json; the composite PK keeps the
// upsert deduping. Everything else this used to derive was write-only.
function collectRecordIndexRows(snapshot) {
  const rows = [];
  const pushRow = (recordType, recordId, raw) => {
    const normalizedType = cleanText(recordType, 60);
    const normalizedId = cleanText(recordId, 220);
    if (!normalizedType || !normalizedId) {
      return;
    }
    rows.push({
      record_type: normalizedType,
      record_id: normalizedId,
      raw_json: JSON.stringify(raw || {})
    });
  };

  asArray(snapshot.notebookEntries).forEach((raw) => {
    const entry = ensureObject(raw);
    pushRow('notebook', entry.id, entry);
  });
  asArray(snapshot.workflows).forEach((raw) => {
    const workflow = ensureObject(raw);
    pushRow('workflow', workflow.id, workflow);
  });
  asArray(snapshot.assays).forEach((raw) => {
    const assay = ensureObject(raw);
    pushRow('assay', assay.id || assay.assay_number, assay);
  });
  asArray(snapshot.gelAnalyses).forEach((raw) => {
    const gel = ensureObject(raw);
    pushRow('gel', gel.id, gel);
  });
  asArray(snapshot.papers).forEach((raw) => {
    const paper = ensureObject(raw);
    pushRow('paper', paper.id, paper);
  });
  asArray(snapshot.protocols).forEach((raw) => {
    const protocol = ensureObject(raw);
    pushRow('protocol', protocol.id, protocol);
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
    db.run(
      `INSERT OR REPLACE INTO protocol_index
        (id, name, category, description, tags_json, linked_project, step_count, steps_preview_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        category,
        description,
        JSON.stringify(tags),
        linkedProject,
        Math.max(0, steps.length),
        JSON.stringify(steps.slice(0, 80)),
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
    const notebookState = (['planned', 'suggested'].includes(cleanText(entry.notebookState, 40).toLowerCase()) ? cleanText(entry.notebookState, 40).toLowerCase() : 'executed');
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
    db.run(
      `INSERT OR REPLACE INTO notebook_index
        (id, protocol_id, protocol_name, project_id, project_name, result, notebook_state, executed_at, agent_draft_status, workflow_id, proposal_id, updated_at, created_at, linked_refs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        JSON.stringify(linkedRefs)
      ]
    );
  });
}

function writeSqlPaperIndex(db, snapshot, updatedAtDefault) {
  const papers = asArray(snapshot.papers);
  papers.forEach((rawPaper, index) => {
    const paper = ensureObject(rawPaper);
    const id = cleanText(paper.id, 220) || `paper_${index + 1}`;
    const title = cleanText(paper.title, 320) || cleanText(paper.fileName, 320) || `Paper ${index + 1}`;
    const fileName = cleanText(paper.fileName, 320);
    const linkedType = cleanText(paper.linkedType, 80);
    const linkedId = cleanText(paper.linkedId, 220);
    const linkedName = cleanText(paper.linkedName, 320);
    const storedRelativePath = cleanText(paper.storedRelativePath, 2400);
    const availabilityStatus = cleanText(paper.availabilityStatus, 80);
    const ingestionStatus = cleanText(paper.ingestionStatus, 80);
    const summaryStatus = cleanText(paper.summaryStatus, 80);
    const methodsStatus = cleanText(paper.methodsStatus, 80);
    const reagentsStatus = cleanText(paper.reagentsStatus, 80);
    const discoveredAt = cleanText(paper.discoveredAt || paper.createdAt, 80);
    const updatedAt = cleanText(paper.updatedAt || paper.createdAt, 80) || updatedAtDefault;
    db.run(
      `INSERT OR REPLACE INTO paper_index
        (id, title, file_name, linked_type, linked_id, linked_name, stored_relative_path,
         availability_status, ingestion_status, summary_status, methods_status, reagents_status,
         discovered_at, updated_at, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        title,
        fileName,
        linkedType,
        linkedId,
        linkedName,
        storedRelativePath,
        availabilityStatus,
        ingestionStatus,
        summaryStatus,
        methodsStatus,
        reagentsStatus,
        discoveredAt,
        updatedAt,
        JSON.stringify({
          ...paper,
          id,
          title,
          fileName,
          linkedType,
          linkedId,
          linkedName,
          storedRelativePath,
          availabilityStatus,
          ingestionStatus,
          summaryStatus,
          methodsStatus,
          reagentsStatus,
          discoveredAt,
          updatedAt,
          pdfDataUrl: '',
          storedFilePath: ''
        })
      ]
    );
  });
}

function writeSqlRecordIndex(db, snapshot) {
  collectRecordIndexRows(snapshot).forEach((row) => {
    db.run(
      'INSERT OR REPLACE INTO record_index (record_type, record_id, raw_json) VALUES (?, ?, ?)',
      [row.record_type, row.record_id, row.raw_json]
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
    applyCommonSqliteSchema(db);
    writeSqlInventoryPersonal(db, snapshot);
    writeSqlInventorySamples(db, snapshot);
    writeSqlProtocolIndex(db, snapshot, updatedAtDefault);
    writeSqlNotebookIndex(db, snapshot, updatedAtDefault);
    writeSqlPaperIndex(db, snapshot, updatedAtDefault);
    writeSqlRecordIndex(db, snapshot);
    const bytes = db.export();
    await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
    await fs.writeFile(sqlitePath, Buffer.from(bytes));
  } finally {
    db.close();
  }
}

async function writeChemicalSqliteBundleIndex(sqlitePath, snapshot) {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  try {
    applyChemicalSqliteSchema(db);
    writeSqlInventoryChemicals(db, snapshot);
    writeSqlInventoryMeta(db, snapshot);
    const bytes = db.export();
    await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
    await fs.writeFile(sqlitePath, Buffer.from(bytes));
  } finally {
    db.close();
  }
}

module.exports = {
  writeChemicalSqliteBundleIndex,
  writeSqlInventoryChemicals,
  writeSqlInventoryMeta,
  writeSqlInventoryPersonal,
  writeSqlInventorySamples,
  writeSqlNotebookIndex,
  writeSqlPaperIndex,
  writeSqlProtocolIndex,
  writeSqlRecordIndex,
  writeSqliteBundleIndex
};
