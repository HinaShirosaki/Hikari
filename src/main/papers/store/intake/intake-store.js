'use strict';

const path = require('node:path');
const { asArray, ensureObject } = require('../../../lib/normalize.js');
const { buildKnowledgeMarkdownFileName } = require('../paper-knowledge-paths.js');
const { defaultSourcePaths, intakeRelativePath } = require('./store/paths.js');
const { DOC_TYPES, INTAKE_FILE_NAME, INTAKE_SCHEMA_VERSION, PAPERS_ROOT_REL, cleanText, normalizeIntakeRecord, uniqueStrings } = require('./store/record-normalizing.js');

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

  function isInsidePaperFolder(paperId, candidatePath) {
    const folder = path.resolve(paperFolderAbsolute(paperId));
    const candidate = path.resolve(candidatePath);
    return candidate === folder || candidate.startsWith(`${folder}${path.sep}`);
  }

  function addMarkdownCandidate(candidates, paperId, maybePath) {
    const source = cleanText(maybePath, 4000);
    if (!source) {
      return;
    }
    const candidate = path.isAbsolute(source)
      ? path.resolve(source)
      : path.resolve(workspacePath, source);
    if (isInsidePaperFolder(paperId, candidate) && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  /**
   * Locate the transferred title-named Markdown file for a paper WITHOUT reading
   * its body. Metadata is the primary locator; legacy `paper.md` and a folder
   * scan keep older libraries readable. Callers that only need the path (the
   * intake record's `source_paths.paper_md`) must use this rather than
   * `readPaperMarkdown`, which pulls the whole document into memory.
   * Pass `knownMeta` when meta.json has already been read to avoid a second read.
   */
  async function resolvePaperMarkdownPath(paperId, knownMeta = null) {
    const guard = ensureReady();
    if (guard) {
      return guard;
    }
    const id = cleanText(paperId, 200);
    if (!id) {
      return { ok: false, status: 'invalid_arguments', error: 'paper_id is required.' };
    }
    const meta = knownMeta ? ensureObject(knownMeta) : ensureObject((await readPaperMeta(id))?.meta);
    const candidates = [];
    addMarkdownCandidate(candidates, id, meta.markdown_path || meta.markdownPath);
    addMarkdownCandidate(
      candidates,
      id,
      path.join(paperFolderAbsolute(id), buildKnowledgeMarkdownFileName({
        title: meta.title || meta.paper_title
      }))
    );
    addMarkdownCandidate(candidates, id, path.join(paperFolderAbsolute(id), 'paper.md'));

    try {
      const entries = await fs.readdir(paperFolderAbsolute(id), { withFileTypes: true });
      asArray(entries).forEach((entry) => {
        const name = typeof entry === 'string' ? entry : entry?.name;
        const isFile = typeof entry === 'string'
          || typeof entry?.isFile !== 'function'
          || entry.isFile();
        if (isFile && /\.md$/i.test(String(name || ''))) {
          addMarkdownCandidate(candidates, id, path.join(paperFolderAbsolute(id), name));
        }
      });
    } catch {
      // Candidate reads below provide the useful not-found/read-failed status.
    }

    let lastError = null;
    for (const absPath of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const stats = typeof fs.stat === 'function' ? await fs.stat(absPath) : null;
        if (stats && typeof stats.isFile === 'function' && !stats.isFile()) {
          continue;
        }
        if (!stats) {
          // Injected filesystems without stat still have to prove readability.
          // eslint-disable-next-line no-await-in-loop
          await fs.readFile(absPath, 'utf8');
        }
        return {
          ok: true,
          status: 'located',
          paper_id: id,
          paper_md: path.relative(workspacePath, absPath).split(path.sep).join('/'),
          paper_md_absolute_path: absPath,
          markdown_file_name: path.basename(absPath)
        };
      } catch (error) {
        if (!error || (error.code !== 'ENOENT' && error.code !== 'ENOTDIR' && error.code !== 'EISDIR')) {
          lastError = error;
        }
      }
    }
    if (lastError) {
      return {
        ok: false,
        status: 'read_failed',
        paper_id: id,
        error: cleanText(lastError?.message || lastError, 600)
      };
    }
    return { ok: false, status: 'not_found', paper_id: id };
  }

  /**
   * Resolve the paper Markdown and return its content. Thin wrapper over
   * `resolvePaperMarkdownPath` so path resolution has exactly one implementation.
   */
  async function readPaperMarkdown(paperId, knownMeta = null) {
    const located = await resolvePaperMarkdownPath(paperId, knownMeta);
    if (!located.ok) {
      return located;
    }
    try {
      const markdown = await fs.readFile(located.paper_md_absolute_path, 'utf8');
      return { ...located, status: 'loaded', markdown: String(markdown || '') };
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        return { ok: false, status: 'not_found', paper_id: located.paper_id };
      }
      return {
        ok: false,
        status: 'read_failed',
        paper_id: located.paper_id,
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
      const located = await resolvePaperMarkdownPath(id);
      const defaults = defaultSourcePaths(id, {
        paper_md: located?.paper_md,
        title: record.title
      });
      record.source_paths = {
        paper_md: defaults.paper_md,
        figures_dir: record.source_paths.figures_dir || defaults.figures_dir,
        pdf_path: record.source_paths.pdf_path || defaults.pdf_path
      };
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
    const nextRecord = ensureObject(record);
    const defaults = defaultSourcePaths(id, { title: nextRecord.title || previousRecord.title });
    const previousSourcePaths = ensureObject(previousRecord.source_paths);
    const nextSourcePaths = ensureObject(nextRecord.source_paths);
    const sourcePaths = {
      paper_md: cleanText(nextSourcePaths.paper_md, 400)
        || cleanText(previousSourcePaths.paper_md, 400)
        || defaults.paper_md,
      figures_dir: cleanText(nextSourcePaths.figures_dir, 400)
        || cleanText(previousSourcePaths.figures_dir, 400)
        || defaults.figures_dir,
      pdf_path: cleanText(nextSourcePaths.pdf_path, 400)
        || cleanText(previousSourcePaths.pdf_path, 400)
        || defaults.pdf_path
    };
    const merged = normalizeIntakeRecord({
      ...previousRecord,
      ...nextRecord,
      paper_id: id,
      source_paths: sourcePaths,
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
      } else if (result.status === 'not_found') {
        // Older converted papers may predate intake.json. Keep their metadata
        // title discoverable so the agent can route to full-paper analysis
        // instead of incorrectly reporting that the local paper is absent.
        // eslint-disable-next-line no-await-in-loop
        const metaResult = await readPaperMeta(paperId);
        const meta = ensureObject(metaResult?.meta);
        // eslint-disable-next-line no-await-in-loop
        const located = await resolvePaperMarkdownPath(paperId, meta);
        const title = cleanText(meta.title || meta.paper_title, 400);
        if (title && located?.ok) {
          records.push({
            schema_version: INTAKE_SCHEMA_VERSION,
            paper_id: paperId,
            doc_type: '',
            intake_status: 'metadata_only',
            title,
            doi: cleanText(meta.doi, 200),
            one_sentence_summary: '',
            project_ids: [],
            experiments: [],
            structure_outline: [],
            notable_claims: [],
            source_paths: {
              ...defaultSourcePaths(paperId, { paper_md: located.paper_md }),
              pdf_path: cleanText(meta.pdf_path || meta.pdfPath || meta.source_pdf_path, 400)
            },
            created_at: '',
            updated_at: cleanText(meta.updated_at, 60)
          });
        }
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
    resolvePaperMarkdownPath,
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
