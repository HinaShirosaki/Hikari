'use strict';

/**
 * Paper-intake summary knowledge base — storage layer.
 *
 * Holds the per-paper one-sentence summary and structured experiment list that the
 * `hikari-paper-intake` skill produces after a PDF is transferred into
 * `KnowledgeBase/papers.md/<paper_id>/paper.md`. This is a separate KB from the
 * existing LLM-wiki chunk store: the intake KB is *one record per paper*, schema
 * is fixed, and queries operate on whole summaries and experiment entries — not
 * on free-form chunks.
 *
 * All filesystem access is injected so live code can plug in workspace storage
 * helpers, and tests can plug in an in-memory map.
 */

const path = require('node:path');
const {
  KNOWLEDGE_BASE_ROOT_FOLDER_NAME,
  PAPER_MARKDOWN_ROOT_FOLDER_NAME
} = require('../../../helpers/main/storage-bundle/storage-paths.js');

const INTAKE_SCHEMA_VERSION = 1;
const INTAKE_FILE_NAME = 'intake.json';
const PAPERS_ROOT_REL = path.posix.join(
  KNOWLEDGE_BASE_ROOT_FOLDER_NAME,
  PAPER_MARKDOWN_ROOT_FOLDER_NAME
);

const DOC_TYPES = Object.freeze([
  'research_paper',
  'review',
  'book',
  'book_chapter',
  'other'
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 2000) {
  const text = String(value == null ? '' : value).trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values = [], max = 50) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 240);
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
}

function normalizeDocType(value) {
  const text = cleanText(value, 40).toLowerCase().replace(/[\s-]+/gu, '_');
  return DOC_TYPES.includes(text) ? text : 'other';
}

function normalizeExperiment(value, index = 0) {
  const source = ensureObject(value);
  const evidence = cleanText(source.evidence || source.source_content || source.sourceContent, 1600);
  return {
    id: cleanText(source.id, 80) || `e${index + 1}`,
    title: cleanText(source.title, 240),
    technique: cleanText(source.technique, 240),
    variables: cleanText(source.variables, 400),
    figure_ref: cleanText(source.figure_ref || source.figureRef, 80),
    outcome: cleanText(source.outcome, 600),
    ...(evidence ? { evidence } : {})
  };
}

function normalizeOutlineEntry(value) {
  const source = ensureObject(value);
  return {
    section: cleanText(source.section, 240),
    summary: cleanText(source.summary, 600)
  };
}

function normalizeClaim(value) {
  const source = ensureObject(value);
  return {
    section: cleanText(source.section, 240),
    claim: cleanText(source.claim, 600)
  };
}

/**
 * Build a fully-normalized intake record from an unstructured input. Safe to
 * call on partial input — missing fields collapse to empty strings/arrays.
 */
function normalizeIntakeRecord(input = {}) {
  const source = ensureObject(input);
  const docType = normalizeDocType(source.doc_type || source.docType);
  return {
    schema_version: INTAKE_SCHEMA_VERSION,
    paper_id: cleanText(source.paper_id || source.paperId, 200),
    doc_type: docType,
    title: cleanText(source.title, 400),
    doi: cleanText(source.doi, 200),
    one_sentence_summary: cleanText(source.one_sentence_summary || source.summary, 800),
    project_ids: uniqueStrings(source.project_ids || source.projectIds, 25),
    experiments: docType === 'research_paper'
      ? asArray(source.experiments).map(normalizeExperiment)
      : [],
    structure_outline: docType === 'research_paper'
      ? []
      : asArray(source.structure_outline || source.structureOutline).map(normalizeOutlineEntry),
    notable_claims: docType === 'research_paper'
      ? []
      : asArray(source.notable_claims || source.notableClaims).map(normalizeClaim),
    source_paths: {
      paper_md: cleanText(source.source_paths?.paper_md, 400),
      figures_dir: cleanText(source.source_paths?.figures_dir, 400),
      pdf_path: cleanText(source.source_paths?.pdf_path, 400)
    },
    created_at: cleanText(source.created_at, 60),
    updated_at: cleanText(source.updated_at, 60)
  };
}

function intakeRelativePath(paperId = '') {
  const id = cleanText(paperId, 200);
  if (!id) {
    return '';
  }
  return path.posix.join(PAPERS_ROOT_REL, id, INTAKE_FILE_NAME);
}

function defaultSourcePaths(paperId = '') {
  const id = cleanText(paperId, 200);
  if (!id) {
    return { paper_md: '', figures_dir: '', pdf_path: '' };
  }
  const dir = path.posix.join(PAPERS_ROOT_REL, id);
  return {
    paper_md: path.posix.join(dir, 'paper.md'),
    figures_dir: path.posix.join(dir, 'figures'),
    pdf_path: ''
  };
}

/**
 * Create an intake store bound to a workspace root and an injected file-system.
 *
 * Required deps:
 *   - workspacePath: string. Absolute path to the Hikari workspace root.
 *   - fs: { readFile, writeFile, readdir, mkdir, stat } — node:fs/promises shape.
 *
 * Optional deps:
 *   - resolveProjectIdsForPaper(paperId): Promise<string[]> — returns the project
 *     ids that own this paper. If omitted, the store relies solely on
 *     record.project_ids stored inside intake.json. Wire this later to the
 *     project↔paper linkage table.
 *   - listKnownPaperIds(): Promise<string[]> — return all paper ids the workspace
 *     knows about. If omitted, the store falls back to listing immediate
 *     subdirectories of `KnowledgeBase/papers.md/`.
 */
function createIntakeStore(deps = {}) {
  const workspacePath = cleanText(deps.workspacePath, 1024);
  const fs = ensureObject(deps.fs);
  const resolveProjectIdsForPaper = typeof deps.resolveProjectIdsForPaper === 'function'
    ? deps.resolveProjectIdsForPaper
    : null;
  const listKnownPaperIds = typeof deps.listKnownPaperIds === 'function'
    ? deps.listKnownPaperIds
    : null;

  function configError() {
    return {
      ok: false,
      status: 'executor_unavailable',
      error: 'Paper intake store is not bound to a workspace yet.'
    };
  }

  function ensureReady() {
    if (!workspacePath) {
      return configError();
    }
    if (typeof fs.readFile !== 'function' || typeof fs.readdir !== 'function') {
      return configError();
    }
    return null;
  }

  function absoluteIntakePath(paperId) {
    const rel = intakeRelativePath(paperId);
    if (!rel) {
      return '';
    }
    return path.join(workspacePath, rel);
  }

  function papersRootAbsolute() {
    return path.join(workspacePath, PAPERS_ROOT_REL);
  }

  function paperFolderAbsolute(paperId) {
    const id = cleanText(paperId, 200);
    if (!id) {
      return '';
    }
    return path.join(workspacePath, PAPERS_ROOT_REL, id);
  }

  /**
   * Read the transferred `paper.md` for a paper. This is the primary source the
   * intake pipeline classifies and summarizes. Returns `{ ok, status, markdown }`.
   */
  async function readPaperMarkdown(paperId) {
    const guard = ensureReady();
    if (guard) {
      return guard;
    }
    const id = cleanText(paperId, 200);
    if (!id) {
      return { ok: false, status: 'invalid_arguments', error: 'paper_id is required.' };
    }
    const absPath = path.join(paperFolderAbsolute(id), 'paper.md');
    try {
      const markdown = await fs.readFile(absPath, 'utf8');
      return { ok: true, status: 'loaded', paper_id: id, markdown: String(markdown || '') };
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        return { ok: false, status: 'not_found', paper_id: id };
      }
      return {
        ok: false,
        status: 'read_failed',
        paper_id: id,
        error: cleanText(error?.message || error, 600)
      };
    }
  }

  /**
   * Read the page-delimited `extracted.txt` generated beside paper.md. Each
   * page starts with `[[page:N]]`; the intake pipeline owns that cursor and
   * only gives the model the current page content.
   */
  async function readPaperExtractedText(paperId) {
    const guard = ensureReady();
    if (guard) {
      return guard;
    }
    const id = cleanText(paperId, 200);
    if (!id) {
      return { ok: false, status: 'invalid_arguments', error: 'paper_id is required.' };
    }
    const absPath = path.join(paperFolderAbsolute(id), 'extracted.txt');
    try {
      const content = await fs.readFile(absPath, 'utf8');
      return { ok: true, status: 'loaded', paper_id: id, content: String(content || '') };
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        return { ok: false, status: 'not_found', paper_id: id };
      }
      return {
        ok: false,
        status: 'read_failed',
        paper_id: id,
        error: cleanText(error?.message || error, 600)
      };
    }
  }

  /**
   * Read `meta.json` (title, authors, doi, pdf_path, page_count) for a paper.
   * Missing or corrupt metadata collapses to an empty object rather than an error
   * so the pipeline can still classify from the markdown alone.
   */
  async function readPaperMeta(paperId) {
    const guard = ensureReady();
    if (guard) {
      return guard;
    }
    const id = cleanText(paperId, 200);
    if (!id) {
      return { ok: false, status: 'invalid_arguments', error: 'paper_id is required.' };
    }
    const absPath = path.join(paperFolderAbsolute(id), 'meta.json');
    let raw = '';
    try {
      raw = await fs.readFile(absPath, 'utf8');
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        return { ok: true, status: 'not_found', paper_id: id, meta: {} };
      }
      return {
        ok: false,
        status: 'read_failed',
        paper_id: id,
        error: cleanText(error?.message || error, 600)
      };
    }
    try {
      const meta = JSON.parse(raw);
      return {
        ok: true,
        status: 'loaded',
        paper_id: id,
        meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
      };
    } catch {
      return { ok: true, status: 'corrupt', paper_id: id, meta: {} };
    }
  }

  async function listPaperIds() {
    if (listKnownPaperIds) {
      const ids = await listKnownPaperIds();
      return uniqueStrings(ids, 1000);
    }
    try {
      const entries = await fs.readdir(papersRootAbsolute(), { withFileTypes: true });
      return uniqueStrings(
        asArray(entries)
          .filter((entry) => entry && typeof entry === 'object' && entry.isDirectory && entry.isDirectory())
          .map((entry) => entry.name),
        1000
      );
    } catch {
      return [];
    }
  }

  async function readIntake(paperId) {
    const guard = ensureReady();
    if (guard) {
      return guard;
    }
    const id = cleanText(paperId, 200);
    if (!id) {
      return { ok: false, status: 'invalid_arguments', error: 'paper_id is required.' };
    }
    const absPath = absoluteIntakePath(id);
    let raw = '';
    try {
      raw = await fs.readFile(absPath, 'utf8');
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        return { ok: false, status: 'not_found', paper_id: id };
      }
      return {
        ok: false,
        status: 'read_failed',
        paper_id: id,
        error: cleanText(error?.message || error, 600)
      };
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        status: 'corrupt',
        paper_id: id,
        error: cleanText(error?.message || error, 600)
      };
    }
    const record = normalizeIntakeRecord({ ...parsed, paper_id: parsed?.paper_id || id });
    if (!record.source_paths.paper_md) {
      record.source_paths = { ...defaultSourcePaths(id), ...record.source_paths };
    }
    return { ok: true, status: 'loaded', paper_id: id, record };
  }

  async function writeIntake(paperId, record) {
    const guard = ensureReady();
    if (guard) {
      return guard;
    }
    if (typeof fs.writeFile !== 'function' || typeof fs.mkdir !== 'function') {
      return configError();
    }
    const id = cleanText(paperId, 200);
    if (!id) {
      return { ok: false, status: 'invalid_arguments', error: 'paper_id is required.' };
    }
    const now = new Date().toISOString();
    const previous = await readIntake(id);
    const previousRecord = previous.ok ? previous.record : {};
    const merged = normalizeIntakeRecord({
      ...defaultSourcePaths(id),
      ...previousRecord,
      ...ensureObject(record),
      paper_id: id,
      created_at: previousRecord.created_at || now,
      updated_at: now
    });
    const absPath = absoluteIntakePath(id);
    try {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    } catch (error) {
      return {
        ok: false,
        status: 'write_failed',
        paper_id: id,
        error: cleanText(error?.message || error, 600)
      };
    }
    return { ok: true, status: 'saved', paper_id: id, record: merged };
  }

  async function loadAll() {
    const guard = ensureReady();
    if (guard) {
      return guard;
    }
    const ids = await listPaperIds();
    const records = [];
    const errors = [];
    for (const paperId of ids) {
      const result = await readIntake(paperId);
      if (result.ok) {
        records.push(result.record);
      } else if (result.status && result.status !== 'not_found') {
        errors.push({ paper_id: paperId, status: result.status, error: result.error });
      }
    }
    return { ok: true, status: 'loaded', records, errors };
  }

  async function effectiveProjectIds(record) {
    const stored = uniqueStrings(record?.project_ids, 25);
    if (!resolveProjectIdsForPaper) {
      return stored;
    }
    try {
      const resolved = await resolveProjectIdsForPaper(record.paper_id);
      return uniqueStrings([...stored, ...asArray(resolved)], 25);
    } catch {
      return stored;
    }
  }

  /**
   * Filter records by project membership. `projectFilter` may carry project_id
   * and/or project_name. Name matching is best-effort: it relies on the
   * optional `matchProjectName` dep (e.g. a `(record, name) => boolean`).
   */
  async function filterByProject(records, projectFilter = {}) {
    const projectId = cleanText(projectFilter.project_id || projectFilter.projectId, 200);
    const projectName = cleanText(projectFilter.project_name || projectFilter.projectName, 240);
    const matchProjectName = typeof deps.matchProjectName === 'function'
      ? deps.matchProjectName
      : null;
    if (!projectId && !projectName) {
      return asArray(records);
    }
    const out = [];
    for (const record of asArray(records)) {
      const ids = await effectiveProjectIds(record);
      if (projectId && ids.includes(projectId)) {
        out.push(record);
        continue;
      }
      if (projectName && matchProjectName) {
        try {
          if (await matchProjectName(record, projectName)) {
            out.push(record);
          }
        } catch {
          // Ignore project-name match failures.
        }
      }
    }
    return out;
  }

  return Object.freeze({
    INTAKE_SCHEMA_VERSION,
    INTAKE_FILE_NAME,
    PAPERS_ROOT_REL,
    DOC_TYPES,
    readIntake,
    writeIntake,
    loadAll,
    listPaperIds,
    readPaperMarkdown,
    readPaperExtractedText,
    readPaperMeta,
    effectiveProjectIds,
    filterByProject,
    intakeRelativePath,
    defaultSourcePaths,
    normalizeIntakeRecord
  });
}

module.exports = {
  INTAKE_SCHEMA_VERSION,
  INTAKE_FILE_NAME,
  PAPERS_ROOT_REL,
  DOC_TYPES,
  normalizeIntakeRecord,
  intakeRelativePath,
  defaultSourcePaths,
  createIntakeStore
};
