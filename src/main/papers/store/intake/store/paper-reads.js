'use strict';

const path = require('node:path');

const { asArray, ensureObject } = require('../../../../lib/normalize.js');
const { buildKnowledgeMarkdownFileName } = require('../../paper-knowledge-paths.js');
const { intakeRelativePath } = require('./paths.js');
const { PAPERS_ROOT_REL, cleanText } = require('./record-normalizing.js');

// Locating a paper's folder inside the knowledge base and reading the markdown,
// extracted text, and metadata the intake pipeline needs.
function createPaperReads({ workspacePath, fs, ensureReady } = {}) {
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

  return {
    absoluteIntakePath,
    papersRootAbsolute,
    paperFolderAbsolute,
    isInsidePaperFolder,
    addMarkdownCandidate,
    resolvePaperMarkdownPath,
    readPaperMarkdown,
    readPaperExtractedText,
    readPaperMeta
  };
}

module.exports = { createPaperReads };
