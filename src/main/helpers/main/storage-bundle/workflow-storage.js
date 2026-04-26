'use strict';

const fs = require('fs/promises');
const path = require('path');
const { MEMORY_FILE_NAME, buildWorkflowMemoryMarkdown } = require('./storage-memory');
const {
  asArray,
  cleanText,
  ensureObject,
  loadSqlJs,
  parseJsonObject,
  readJsonFile
} = require('./storage-utils');

const WORKFLOW_ROOT_FOLDER_NAME = 'Workflow';
const WORKFLOW_STATUS_SQLITE_FILE_NAME = 'workflow-status.sqlite';
const TEMPLATE_METADATA_FILE_NAME = 'template.json';
const WORKFLOW_METADATA_FILE_NAME = 'workflow.json';
const RELATED_PAPERS_FILE_NAME = 'related-papers.json';
const NOTEBOOK_PAGE_FILE_NAME = 'page.json';

function sanitizeFolderName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
}

function toPosixRelative(rootPath, targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join('/');
}

function resolveWorkflowStoragePaths(storagePath = '') {
  const resolvedStoragePath = cleanText(storagePath, 2400);
  if (!resolvedStoragePath) {
    return {
      storagePath: '',
      workflowRootPath: '',
      sqlitePath: ''
    };
  }
  const rootPath = path.resolve(resolvedStoragePath);
  const workflowRootPath = path.join(rootPath, WORKFLOW_ROOT_FOLDER_NAME);
  return {
    storagePath: rootPath,
    workflowRootPath,
    sqlitePath: path.join(workflowRootPath, WORKFLOW_STATUS_SQLITE_FILE_NAME)
  };
}

function buildTemplateFolderName(template) {
  const source = ensureObject(template);
  return `${sanitizeFolderName(source.name, 'Untitled_Template')}__${sanitizeFolderName(source.id, 'template')}`;
}

function buildWorkflowFolderName(workflow) {
  const source = ensureObject(workflow);
  return `${sanitizeFolderName(source.name, 'Untitled_Workflow')}__${sanitizeFolderName(source.id, 'workflow')}`;
}

function buildEntryFolderName(entryName = '', entryId = '') {
  return `${sanitizeFolderName(entryName, 'Entry')}__${sanitizeFolderName(entryId, 'entry')}`;
}

function buildNotebookPageFolderName(notebookEntryId = '') {
  return `${sanitizeFolderName('Notebook_Page', 'Notebook_Page')}__${sanitizeFolderName(notebookEntryId, 'page')}`;
}

function buildBlockFolderName(blockName = '', blockId = '') {
  return `${sanitizeFolderName(blockName, 'Step')}__${sanitizeFolderName(blockId, 'step')}`;
}

function buildWorkflowFolderLayout({ storagePath, template, workflow }) {
  const rootPaths = resolveWorkflowStoragePaths(storagePath);
  if (!rootPaths.workflowRootPath) {
    return {
      ...rootPaths,
      templateFolderPath: '',
      workflowFolderPath: '',
      resultsFolderPath: '',
      notebookFolderPath: '',
      relatedPapersFolderPath: '',
      relativeFolderPath: ''
    };
  }

  const templateFolderName = buildTemplateFolderName(template);
  const workflowFolderName = buildWorkflowFolderName(workflow);
  const templateFolderPath = path.join(rootPaths.workflowRootPath, templateFolderName);
  const workflowFolderPath = path.join(templateFolderPath, workflowFolderName);
  return {
    ...rootPaths,
    templateFolderPath,
    workflowFolderPath,
    resultsFolderPath: path.join(workflowFolderPath, 'Results'),
    notebookFolderPath: path.join(workflowFolderPath, 'Notebook'),
    relatedPapersFolderPath: path.join(workflowFolderPath, 'RelatedPapers'),
    relativeFolderPath: [templateFolderName, workflowFolderName].join('/')
  };
}

function collectLinkedNotebookIds(workflow) {
  const source = ensureObject(workflow);
  const ids = new Set();
  asArray(source.notebookEntryIds).forEach((id) => {
    const normalized = cleanText(id, 220);
    if (normalized) {
      ids.add(normalized);
    }
  });
  asArray(source.entries).forEach((entry) => {
    const stepStates = entry && typeof entry.stepStates === 'object' && !Array.isArray(entry.stepStates)
      ? entry.stepStates
      : {};
    Object.values(stepStates).forEach((rawStepState) => {
      const notebookEntryId = cleanText(rawStepState?.notebookEntryId, 220);
      if (notebookEntryId) {
        ids.add(notebookEntryId);
      }
    });
  });
  return [...ids];
}

function normalizeStepStatus(stepState) {
  const source = ensureObject(stepState);
  const status = cleanText(source.status, 40).toLowerCase();
  if (status === 'completed' || status === 'failed' || status === 'pending') {
    return status;
  }
  return 'not_done';
}

function normalizePortableFileRecord(record) {
  const source = ensureObject(record);
  const name = cleanText(source.name, 320);
  if (!name) {
    return null;
  }
  return {
    name,
    path: '',
    relativePath: cleanText(source.relativePath, 2000),
    size: Number(source.size) || 0,
    importedAt: cleanText(source.importedAt, 80)
  };
}

function compactNotebookEntry(entry) {
  const source = ensureObject(entry);
  const resultFileRecords = asArray(source.resultFileRecords)
    .map((record) => normalizePortableFileRecord(record))
    .filter(Boolean);
  return {
    ...source,
    storageFolder: '',
    resultFileRecords,
    resultFiles: resultFileRecords.length
      ? resultFileRecords.map((record) => record.name)
      : asArray(source.resultFiles).map((item) => cleanText(item, 320)).filter(Boolean)
  };
}

function compactWorkflowRecord(workflow) {
  const source = ensureObject(workflow);
  return {
    ...source,
    entries: asArray(source.entries).map((entry) => {
      const normalizedEntry = {
        ...ensureObject(entry),
        stepStates: {}
      };
      const stepStates = entry && typeof entry.stepStates === 'object' && !Array.isArray(entry.stepStates)
        ? entry.stepStates
        : {};
      Object.entries(stepStates).forEach(([blockId, rawStepState]) => {
        const stepState = ensureObject(rawStepState);
        const resultFileRecords = asArray(stepState.resultFileRecords)
          .map((record) => normalizePortableFileRecord(record))
          .filter(Boolean);
        normalizedEntry.stepStates[blockId] = {
          ...stepState,
          resultFileRecords,
          resultFiles: resultFileRecords.length
            ? resultFileRecords.map((record) => record.name)
            : asArray(stepState.resultFiles).map((item) => cleanText(item, 320)).filter(Boolean)
        };
      });
      return normalizedEntry;
    })
  };
}

function compactPaperRecord(paper) {
  const source = ensureObject(paper);
  const compact = {
    ...source,
    pdfDataUrl: '',
    storedFilePath: ''
  };
  if (!cleanText(compact.storedRelativePath, 2000) && cleanText(source.storedFilePath, 2400)) {
    compact.storedRelativePath = '';
  }
  return compact;
}

function collectWorkflowSummary(workflow) {
  const source = ensureObject(workflow);
  const blocks = asArray(source.blocks);
  const entries = asArray(source.entries);
  let totalSteps = 0;
  let completedSteps = 0;
  let failedSteps = 0;
  let pendingSteps = 0;
  let resultFileCount = 0;
  let linkedNotebookCount = 0;
  const linkedNotebookIds = new Set();

  if (!entries.length) {
    totalSteps = blocks.length;
  }

  entries.forEach((entry) => {
    const stepStates = entry && typeof entry.stepStates === 'object' && !Array.isArray(entry.stepStates)
      ? entry.stepStates
      : {};
    blocks.forEach((block) => {
      totalSteps += 1;
      const stepState = ensureObject(stepStates[block?.id]);
      const status = normalizeStepStatus(stepState);
      if (status === 'completed') {
        completedSteps += 1;
      } else if (status === 'failed') {
        failedSteps += 1;
      } else if (status === 'pending') {
        pendingSteps += 1;
      }
      const notebookEntryId = cleanText(stepState.notebookEntryId, 220);
      if (notebookEntryId) {
        linkedNotebookIds.add(notebookEntryId);
      }
      resultFileCount += asArray(stepState.resultFileRecords).length || asArray(stepState.resultFiles).length;
    });
  });

  linkedNotebookCount = linkedNotebookIds.size;
  const percentComplete = totalSteps
    ? Math.round((completedSteps / totalSteps) * 100)
    : 0;
  const overallStatus = totalSteps && completedSteps === totalSteps
    ? 'completed'
    : (failedSteps > 0
      ? 'failed'
      : ((pendingSteps > 0 || completedSteps > 0) ? 'pending' : 'not_done'));

  return {
    overallStatus,
    totalSteps,
    completedSteps,
    failedSteps,
    pendingSteps,
    percentComplete,
    resultFileCount,
    linkedNotebookCount
  };
}

function collectRelatedPaperData(snapshot, workflow, notebookIds = []) {
  const safeSnapshot = ensureObject(snapshot);
  const workflowRecord = ensureObject(workflow);
  const notebookIdSet = new Set(asArray(notebookIds).map((id) => cleanText(id, 220)).filter(Boolean));
  const paperIds = new Set();

  asArray(safeSnapshot.papers).forEach((paper) => {
    const normalized = ensureObject(paper);
    if (
      cleanText(normalized.linkedType, 60).toLowerCase() === 'project'
      && cleanText(normalized.linkedId, 220) === cleanText(workflowRecord.projectId, 220)
    ) {
      const paperId = cleanText(normalized.id, 220);
      if (paperId) {
        paperIds.add(paperId);
      }
    }
  });

  const links = asArray(safeSnapshot.paperExperimentLinks).filter((rawLink) => {
    const link = ensureObject(rawLink);
    const paperId = cleanText(link.paperId, 220);
    const entryId = cleanText(link.entryId, 220);
    const projectId = cleanText(link.projectId, 220);
    const matchesNotebook = entryId && notebookIdSet.has(entryId);
    const matchesProject = projectId && projectId === cleanText(workflowRecord.projectId, 220);
    if ((matchesNotebook || matchesProject) && paperId) {
      paperIds.add(paperId);
      return true;
    }
    return false;
  }).map((rawLink) => ({ ...ensureObject(rawLink) }));

  const papers = asArray(safeSnapshot.papers)
    .filter((paper) => paperIds.has(cleanText(paper?.id, 220)))
    .map((paper) => compactPaperRecord(paper));

  return {
    papers,
    paperExperimentLinks: links
  };
}

function resolveWorkflowTemplateRecord(templateById, workflow) {
  const workflowRecord = ensureObject(workflow);
  const templateId = cleanText(workflowRecord.templateId, 220);
  if (templateId && templateById.has(templateId)) {
    return ensureObject(templateById.get(templateId));
  }
  return {
    id: templateId || 'untemplated',
    name: 'Untemplated Workflow',
    description: ''
  };
}

async function ensureFolder(targetPath) {
  if (!targetPath) {
    return;
  }
  await fs.mkdir(targetPath, { recursive: true });
}

async function writeJsonFile(targetPath, payload) {
  await ensureFolder(path.dirname(targetPath));
  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8');
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  if (parent === child) {
    return true;
  }
  const prefix = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  return child.startsWith(prefix);
}

function buildNotebookStorageFolder(runLayout, notebookEntry) {
  const entry = ensureObject(notebookEntry);
  const workflowContext = ensureObject(entry.workflowContext);
  if (cleanText(workflowContext.workflowEntryId, 220) || cleanText(workflowContext.workflowBlockId, 220)) {
    return path.join(
      runLayout.notebookFolderPath,
      buildEntryFolderName(
        workflowContext.workflowEntryName || workflowContext.workflowName || entry.protocolName || entry.id,
        workflowContext.workflowEntryId || entry.id
      ),
      buildNotebookPageFolderName(entry.id)
    );
  }

  const existingStorageFolder = cleanText(entry.storageFolder, 2400);
  if (existingStorageFolder && isPathInside(runLayout.workflowFolderPath, existingStorageFolder)) {
    return existingStorageFolder;
  }

  return path.join(
    runLayout.notebookFolderPath,
    buildNotebookPageFolderName(entry.id)
  );
}

function applyWorkflowStorageSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      folder_name TEXT,
      relative_folder_path TEXT,
      updated_at TEXT,
      created_at TEXT,
      raw_json TEXT
    );
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      template_id TEXT,
      template_name TEXT,
      name TEXT,
      description TEXT,
      project_id TEXT,
      project_name TEXT,
      folder_name TEXT,
      relative_folder_path TEXT,
      overall_status TEXT,
      percent_complete INTEGER,
      completed_steps INTEGER,
      total_steps INTEGER,
      notebook_count INTEGER,
      paper_count INTEGER,
      result_file_count INTEGER,
      updated_at TEXT,
      created_at TEXT,
      raw_json TEXT
    );
    CREATE TABLE IF NOT EXISTS workflow_step_status (
      workflow_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      entry_name TEXT,
      block_name TEXT,
      status TEXT,
      notebook_entry_id TEXT,
      values_json TEXT,
      result_files_json TEXT,
      assay_ids_json TEXT,
      gel_analysis_ids_json TEXT,
      completed_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (workflow_id, entry_id, block_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_template ON workflow_runs(template_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(overall_status);
    CREATE INDEX IF NOT EXISTS idx_workflow_step_status_status ON workflow_step_status(status);
  `);
}

async function syncWorkflowRootFromSnapshot({
  storagePath = '',
  snapshot = {}
} = {}) {
  const safeSnapshot = ensureObject(snapshot);
  const targetStoragePath = cleanText(storagePath, 2400)
    || cleanText(safeSnapshot?.settings?.storagePath, 2400);
  const rootPaths = resolveWorkflowStoragePaths(targetStoragePath);
  if (!rootPaths.workflowRootPath) {
    return {
      workflowRootPath: '',
      sqlitePath: '',
      summary: {
        workflowTemplates: 0,
        workflows: 0,
        notebookEntries: 0,
        papers: 0
      }
    };
  }

  await ensureFolder(rootPaths.workflowRootPath);
  const templateById = new Map();
  asArray(safeSnapshot.workflowTemplates).forEach((template) => {
    const id = cleanText(template?.id, 220);
    if (id) {
      templateById.set(id, ensureObject(template));
    }
  });

  const templatesForStorage = new Map();
  asArray(safeSnapshot.workflowTemplates).forEach((template) => {
    const templateRecord = ensureObject(template);
    const templateId = cleanText(templateRecord.id, 220);
    if (!templateId) {
      return;
    }
    templatesForStorage.set(templateId, templateRecord);
  });
  asArray(safeSnapshot.workflows).forEach((workflow) => {
    const templateRecord = resolveWorkflowTemplateRecord(templateById, workflow);
    const templateId = cleanText(templateRecord.id, 220);
    if (templateId && !templatesForStorage.has(templateId)) {
      templatesForStorage.set(templateId, templateRecord);
    }
  });

  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  applyWorkflowStorageSchema(db);

  for (const template of templatesForStorage.values()) {
    const folderName = buildTemplateFolderName(template);
    const templateFolderPath = path.join(rootPaths.workflowRootPath, folderName);
    await ensureFolder(templateFolderPath);
    await writeJsonFile(path.join(templateFolderPath, TEMPLATE_METADATA_FILE_NAME), {
      exportedAt: new Date().toISOString(),
      template: ensureObject(template)
    });
    db.run(
      `INSERT OR REPLACE INTO workflow_templates
        (id, name, description, folder_name, relative_folder_path, updated_at, created_at, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanText(template.id, 220),
        cleanText(template.name, 320),
        cleanText(template.description, 4000),
        folderName,
        folderName,
        cleanText(template.updatedAt, 80),
        cleanText(template.createdAt, 80),
        JSON.stringify(ensureObject(template))
      ]
    );
  }

  const notebookIdsWritten = new Set();
  const paperIdsWritten = new Set();

  for (const rawWorkflow of asArray(safeSnapshot.workflows)) {
    const workflow = ensureObject(rawWorkflow);
    const workflowId = cleanText(workflow.id, 220);
    if (!workflowId) {
      continue;
    }
    const template = resolveWorkflowTemplateRecord(templateById, workflow);
    const runLayout = buildWorkflowFolderLayout({
      storagePath: rootPaths.storagePath,
      template,
      workflow
    });
    await ensureFolder(runLayout.resultsFolderPath);
    await ensureFolder(runLayout.notebookFolderPath);
    await ensureFolder(runLayout.relatedPapersFolderPath);

    const linkedNotebookIds = collectLinkedNotebookIds(workflow);
    const notebookEntries = asArray(safeSnapshot.notebookEntries).filter((entry) => (
      linkedNotebookIds.includes(cleanText(entry?.id, 220))
    ));
    const relatedPapers = collectRelatedPaperData(safeSnapshot, workflow, linkedNotebookIds);
    const workflowSummary = collectWorkflowSummary(workflow);
    const project = asArray(safeSnapshot.projects).find((item) => (
      cleanText(item?.id, 220) === cleanText(workflow.projectId, 220)
    ));
    const portableWorkflow = compactWorkflowRecord(workflow);

    await ensureFolder(runLayout.workflowFolderPath);
    await fs.writeFile(
      path.join(runLayout.workflowFolderPath, MEMORY_FILE_NAME),
      buildWorkflowMemoryMarkdown({
        workflow,
        template,
        project,
        workflowSummary,
        notebookEntries,
        relatedPapers: relatedPapers.papers
      }),
      'utf8'
    );
    await writeJsonFile(path.join(runLayout.workflowFolderPath, WORKFLOW_METADATA_FILE_NAME), {
      exportedAt: new Date().toISOString(),
      template: ensureObject(template),
      workflow: portableWorkflow,
      summary: {
        ...workflowSummary,
        notebookCount: notebookEntries.length,
        paperCount: relatedPapers.papers.length
      }
    });
    await writeJsonFile(path.join(runLayout.relatedPapersFolderPath, RELATED_PAPERS_FILE_NAME), {
      exportedAt: new Date().toISOString(),
      workflowId,
      papers: relatedPapers.papers,
      paperExperimentLinks: relatedPapers.paperExperimentLinks
    });

    for (const notebookEntry of notebookEntries) {
      const notebookFolder = buildNotebookStorageFolder(runLayout, notebookEntry);
      const compactEntry = compactNotebookEntry(notebookEntry);
      compactEntry.storageFolder = '';
      await writeJsonFile(path.join(notebookFolder, NOTEBOOK_PAGE_FILE_NAME), {
        exportedAt: new Date().toISOString(),
        workflowId,
        notebookEntry: compactEntry
      });
      const notebookId = cleanText(notebookEntry?.id, 220);
      if (notebookId) {
        notebookIdsWritten.add(notebookId);
      }
    }

    relatedPapers.papers.forEach((paper) => {
      const paperId = cleanText(paper?.id, 220);
      if (paperId) {
        paperIdsWritten.add(paperId);
      }
    });

    db.run(
      `INSERT OR REPLACE INTO workflow_runs
        (id, template_id, template_name, name, description, project_id, project_name, folder_name, relative_folder_path,
         overall_status, percent_complete, completed_steps, total_steps, notebook_count, paper_count, result_file_count,
         updated_at, created_at, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workflowId,
        cleanText(template.id, 220),
        cleanText(template.name, 320),
        cleanText(workflow.name, 320),
        cleanText(workflow.description, 4000),
        cleanText(workflow.projectId, 220),
        cleanText(project?.name, 320),
        buildWorkflowFolderName(workflow),
        runLayout.relativeFolderPath,
        workflowSummary.overallStatus,
        workflowSummary.percentComplete,
        workflowSummary.completedSteps,
        workflowSummary.totalSteps,
        notebookEntries.length,
        relatedPapers.papers.length,
        workflowSummary.resultFileCount,
        cleanText(workflow.updatedAt, 80),
        cleanText(workflow.createdAt, 80),
        JSON.stringify(portableWorkflow)
      ]
    );

    asArray(workflow.entries).forEach((entry) => {
      const stepStates = entry && typeof entry.stepStates === 'object' && !Array.isArray(entry.stepStates)
        ? entry.stepStates
        : {};
      asArray(workflow.blocks).forEach((block) => {
        const stepState = ensureObject(stepStates[block?.id]);
        const portableResultFileRecords = asArray(stepState.resultFileRecords)
          .map((record) => normalizePortableFileRecord(record))
          .filter(Boolean);
        db.run(
          `INSERT OR REPLACE INTO workflow_step_status
            (workflow_id, entry_id, block_id, entry_name, block_name, status, notebook_entry_id, values_json, result_files_json,
             assay_ids_json, gel_analysis_ids_json, completed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            workflowId,
            cleanText(entry?.id, 220),
            cleanText(block?.id, 220),
            cleanText(entry?.name, 320),
            cleanText(block?.text || block?.protocolId || block?.id, 320),
            normalizeStepStatus(stepState),
            cleanText(stepState.notebookEntryId, 220),
            JSON.stringify(ensureObject(stepState.values)),
            JSON.stringify(portableResultFileRecords.length
              ? portableResultFileRecords
              : asArray(stepState.resultFiles).map((name) => cleanText(name, 320)).filter(Boolean)),
            JSON.stringify(asArray(stepState.assayIds).map((id) => cleanText(id, 220)).filter(Boolean)),
            JSON.stringify(asArray(stepState.gelAnalysisIds).map((id) => cleanText(id, 220)).filter(Boolean)),
            cleanText(stepState.completedAt, 80),
            cleanText(stepState.updatedAt, 80)
          ]
        );
      });
    });
  }

  const bytes = db.export();
  db.close();
  await fs.writeFile(rootPaths.sqlitePath, Buffer.from(bytes));

  return {
    workflowRootPath: rootPaths.workflowRootPath,
    sqlitePath: rootPaths.sqlitePath,
    summary: {
      workflowTemplates: templatesForStorage.size,
      workflows: asArray(safeSnapshot.workflows).length,
      notebookEntries: notebookIdsWritten.size,
      papers: paperIdsWritten.size
    }
  };
}

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

async function readWorkflowStatusIndex(sqlitePath) {
  try {
    const bytes = await fs.readFile(sqlitePath);
    if (!bytes.length) {
      return {
        exists: true,
        templateRows: [],
        workflowRows: []
      };
    }
    const SQL = await loadSqlJs();
    const db = new SQL.Database(new Uint8Array(bytes));
    try {
      const templateRows = readSqlRows(db, 'SELECT * FROM workflow_templates', []);
      const workflowRows = readSqlRows(db, 'SELECT * FROM workflow_runs', []);
      return {
        exists: true,
        templateRows,
        workflowRows
      };
    } finally {
      db.close();
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        exists: false,
        templateRows: [],
        workflowRows: []
      };
    }
    throw error;
  }
}

async function readNotebookEntriesForWorkflowFolder(workflowFolderPath) {
  const notebookRoot = path.join(workflowFolderPath, 'Notebook');
  const out = [];
  async function walk(currentPath) {
    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const absPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== NOTEBOOK_PAGE_FILE_NAME) {
        continue;
      }
      const payload = await readJsonFile(absPath);
      if (!payload.ok) {
        continue;
      }
      const notebookEntry = ensureObject(payload.data?.notebookEntry);
      const notebookId = cleanText(notebookEntry.id, 220);
      if (!notebookId) {
        continue;
      }
      out.push({
        ...notebookEntry,
        storageFolder: path.dirname(absPath)
      });
    }
  }
  await walk(notebookRoot);
  return out;
}

async function hydrateWorkflowRootFromStoragePath({
  storagePath = ''
} = {}) {
  const rootPaths = resolveWorkflowStoragePaths(storagePath);
  if (!rootPaths.workflowRootPath) {
    return {
      exists: false,
      workflowTemplates: [],
      workflows: [],
      notebookEntries: [],
      papers: [],
      paperExperimentLinks: [],
      warnings: []
    };
  }

  const sqlData = await readWorkflowStatusIndex(rootPaths.sqlitePath);
  if (!sqlData.exists) {
    return {
      exists: false,
      workflowTemplates: [],
      workflows: [],
      notebookEntries: [],
      papers: [],
      paperExperimentLinks: [],
      warnings: []
    };
  }

  const warnings = [];
  const workflowTemplates = sqlData.templateRows
    .map((row) => parseJsonObject(row.raw_json) || null)
    .filter(Boolean);
  const workflows = sqlData.workflowRows
    .map((row) => ({
      relativeFolderPath: cleanText(row.relative_folder_path, 600),
      workflow: parseJsonObject(row.raw_json) || null
    }))
    .filter((row) => row.workflow);

  const notebookMap = new Map();
  const paperMap = new Map();
  const paperLinkMap = new Map();

  for (const row of workflows) {
    const relativeFolderPath = cleanText(row.relativeFolderPath, 600);
    if (!relativeFolderPath) {
      continue;
    }
    const workflowFolderPath = path.join(rootPaths.workflowRootPath, ...relativeFolderPath.split('/').filter(Boolean));
    try {
      const notebookEntries = await readNotebookEntriesForWorkflowFolder(workflowFolderPath);
      notebookEntries.forEach((entry) => {
        const notebookId = cleanText(entry?.id, 220);
        if (notebookId) {
          notebookMap.set(notebookId, entry);
        }
      });
      const relatedPayload = await readJsonFile(path.join(workflowFolderPath, 'RelatedPapers', RELATED_PAPERS_FILE_NAME));
      if (relatedPayload.ok) {
        asArray(relatedPayload.data?.papers).forEach((paper) => {
          const paperId = cleanText(paper?.id, 220);
          if (paperId) {
            paperMap.set(paperId, ensureObject(paper));
          }
        });
        asArray(relatedPayload.data?.paperExperimentLinks).forEach((link, index) => {
          const normalizedLink = ensureObject(link);
          const key = [
            cleanText(normalizedLink.paperId, 220),
            cleanText(normalizedLink.entryId, 220),
            cleanText(normalizedLink.projectId, 220),
            cleanText(normalizedLink.note, 500),
            index
          ].join('::');
          paperLinkMap.set(key, normalizedLink);
        });
      }
    } catch (error) {
      warnings.push(`Failed to read workflow folder ${relativeFolderPath}: ${String(error?.message || error)}`);
    }
  }

  return {
    exists: true,
    workflowTemplates,
    workflows: workflows.map((row) => row.workflow),
    notebookEntries: [...notebookMap.values()],
    papers: [...paperMap.values()],
    paperExperimentLinks: [...paperLinkMap.values()],
    warnings
  };
}

async function importWorkflowRoot({
  storagePath = ''
} = {}) {
  const hydrated = await hydrateWorkflowRootFromStoragePath({ storagePath });
  return {
    statePatch: {
      workflowTemplates: hydrated.workflowTemplates,
      workflows: hydrated.workflows,
      notebookEntries: hydrated.notebookEntries,
      papers: hydrated.papers,
      paperExperimentLinks: hydrated.paperExperimentLinks
    },
    summary: {
      workflowTemplates: hydrated.workflowTemplates.length,
      workflows: hydrated.workflows.length,
      notebookEntries: hydrated.notebookEntries.length,
      papers: hydrated.papers.length
    },
    warnings: hydrated.warnings || []
  };
}

module.exports = {
  WORKFLOW_ROOT_FOLDER_NAME,
  WORKFLOW_STATUS_SQLITE_FILE_NAME,
  buildBlockFolderName,
  buildEntryFolderName,
  buildNotebookPageFolderName,
  buildTemplateFolderName,
  buildWorkflowFolderName,
  buildWorkflowFolderLayout,
  hydrateWorkflowRootFromStoragePath,
  importWorkflowRoot,
  resolveWorkflowStoragePaths,
  sanitizeFolderName,
  syncWorkflowRootFromSnapshot
};
