'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { bufferLooksLikePdf } = require('./http-response.js');
const { buildPaperStorageFolder, buildRelativePath, ensurePathWithinRoot, resolvePaperCollectionName } = require('./storage-paths.js');
const { extractPaperDownloadTargets } = require('./url-targets.js');

function normalizeDoi(value) {
  return String(value || '').trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').toLowerCase();
}

// Scope the identity to the destination, not the publisher URL or suggested filename.
function downloadIdentity(source) {
  const root = source.storage_path || source.storagePath;
  const name = resolvePaperCollectionName(source);
  if (!root || !name) throw new Error('Paper download requires storage_path and linked_name.');
  const folder = ensurePathWithinRoot(root, buildPaperStorageFolder({
    rootPath: root, linkedType: source.linked_type || source.linkedType, linkedName: name
  }));
  const doi = normalizeDoi(source.doi || source.paper_doi || source.paperDoi);
  const pmid = String(source.pmid || '').trim();
  const pmcid = String(source.pmcid || '').trim().toUpperCase();
  const title = String(source.paper_title || source.paperTitle || source.title || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const targets = extractPaperDownloadTargets(source);
  const identity = doi ? `doi:${doi}` : pmid ? `pmid:${pmid}` : pmcid ? `pmcid:${pmcid}`
    : title ? `title:${title}` : `url:${targets.selected_pdf_url || targets.browser_entry_url}`;
  const key = createHash('sha256').update(`${folder}\n${identity}`).digest('hex');
  return { key, folder, root: path.resolve(root), doi, pmid, pmcid,
    receiptPath: path.join(folder, '.hikari-downloads', `${key}.json`) };
}

async function verifiedPdf(filePath, identity) {
  if (!filePath || path.dirname(path.resolve(filePath)) !== identity.folder) return false;
  let handle;
  try {
    ensurePathWithinRoot(await fs.realpath(identity.root), await fs.realpath(filePath));
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 5) return false;
    const header = Buffer.alloc(5);
    await handle.read(header, 0, 5, 0);
    return bufferLooksLikePdf(header);
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

function createDownloadReconciliation(knowledgeRuntime) {
  async function lookup(source, identity) {
    if (typeof knowledgeRuntime?.lookupPaper !== 'function') return null;
    const result = await knowledgeRuntime.lookupPaper({ ...source, storage_path: identity.root,
      linked_name: resolvePaperCollectionName(source) }).catch(() => null);
    const paper = result?.ok && result.paper;
    if (!paper || (identity.doi && normalizeDoi(paper.doi) !== identity.doi)
      || (identity.pmid && String(paper.pmid) !== identity.pmid)
      || (identity.pmcid && String(paper.pmcid).toUpperCase() !== identity.pmcid)
      || !await verifiedPdf(paper.pdf_file_path, identity)) return null;
    return paper;
  }

  async function markdownPatch(paper, identity) {
    if (!paper?.wiki_exists || paper.wiki_status !== 'ready' || !paper.wiki_file_path) return {};
    try {
      ensurePathWithinRoot(await fs.realpath(identity.root), await fs.realpath(paper.wiki_file_path));
      const stat = await fs.stat(paper.wiki_file_path);
      if (!stat.isFile() || stat.size === 0) return {};
      return {
        knowledge_paper_id: paper.id,
        knowledge_markdown_path: paper.wiki_file_path,
        knowledge_markdown_relative_path: paper.wiki_path,
        knowledge_status: 'ready'
      };
    } catch { return {}; }
  }

  async function findSaved(source, identity) {
    const paper = await lookup(source, identity);
    let filePath = paper?.pdf_file_path;
    if (!filePath) {
      const receipt = await fs.readFile(identity.receiptPath, 'utf8').then(JSON.parse).catch(() => null);
      if (receipt?.key === identity.key && await verifiedPdf(receipt.file_path, identity)) filePath = receipt.file_path;
    }
    if (!filePath) return null;
    const stat = await fs.stat(filePath);
    return {
      ok: true, status: 'completed', reused: true, method: 'local',
      file_path: filePath, file_name: path.basename(filePath),
      relative_path: buildRelativePath(identity.root, filePath),
      received_bytes: stat.size, total_bytes: stat.size,
      ...await markdownPatch(paper, identity),
      summary: `Reused saved PDF ${path.basename(filePath)}.`
    };
  }

  async function remember(result, identity) {
    if (!result.ok || !await verifiedPdf(result.file_path, identity)) return;
    await fs.mkdir(path.dirname(identity.receiptPath), { recursive: true });
    const temporaryPath = `${identity.receiptPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify({ key: identity.key, file_path: result.file_path }));
    await fs.rename(temporaryPath, identity.receiptPath);
  }

  async function reconcile(source, identity, job) {
    const paper = await lookup(source, identity);
    if (!paper || path.resolve(paper.pdf_file_path) !== path.resolve(job.file_path || '.')) return {};
    return markdownPatch(paper, identity);
  }

  return { findSaved, remember, reconcile };
}

async function waitForTask(task, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return task.catch(() => {});
  let timer;
  try {
    await Promise.race([task.catch(() => {}), new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

module.exports = { createDownloadReconciliation, downloadIdentity, verifiedPdf, waitForTask };
