'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { asArray, cleanText, ensureObject } = require('../storage-utils');
const { atomicWriteFile, buildFallbackCacheEntry, pruneNotebookConclusionCache, readJsonObject, readNotebookConclusionCache, stableJson, writeNotebookConclusionCache } = require('./conclusion-cache.js');
const { buildNotebookConclusionRequest, validateNotebookConclusionResult } = require('./conclusion-request.js');
const { PAPER_SUMMARY_PENDING } = require('./constants.js');
const { buildProjectMemoryGeneratedBlock, mergeProjectMemoryMarkdown, readExistingText } = require('./memory-markdown.js');
const { buildNotebookMemorySource, deriveKnowledgePaperId, projectRecordMatchesSource } = require('./notebook-sources.js');
const { enqueueProjectMemoryWork, latestProjectMemoryInputs } = require('./queues.js');
const { normalizeRelativePath } = require('./text-utils.js');

function collectProjectPaperSources(snapshot, projectRecord) {
  return asArray(snapshot?.papers)
    .map((paper) => ensureObject(paper))
    .filter((paper) => (
      cleanText(paper.linkedType || paper.linked_type, 60).toLowerCase() === 'project'
      && projectRecordMatchesSource(projectRecord, paper)
    ))
    .map((paper) => {
      const paperId = deriveKnowledgePaperId(paper);
      return paperId ? {
        paperId,
        fallbackTitle: cleanText(paper.title, 400),
        knowledgeMarkdownRelativePath: normalizeRelativePath(
          paper.knowledgeMarkdownRelativePath || paper.knowledge_markdown_relative_path
        )
      } : null;
    })
    .filter(Boolean);
}

async function loadProjectPaperEntries(storageRootPath, paperSources) {
  const seen = new Set();
  const entries = [];
  for (const source of asArray(paperSources)) {
    if (!source.paperId || seen.has(source.paperId)) {
      continue;
    }
    seen.add(source.paperId);
    const sourceRelativePath = path.posix.join(
      'KnowledgeBase',
      'papers.md',
      source.paperId,
      'intake.json'
    );
    const intake = await readJsonObject(path.join(storageRootPath, ...sourceRelativePath.split('/')));
    const summary = cleanText(intake.one_sentence_summary, 1200);
    entries.push({
      paperId: source.paperId,
      title: cleanText(intake.title, 400) || source.fallbackTitle || source.paperId,
      docType: cleanText(intake.doc_type, 80) || 'other',
      doi: cleanText(intake.doi, 240),
      // ponytail: papers predating intake.json used to be dropped here, so a
      // project with linked-but-unanalyzed papers rendered the same as one with
      // no papers. Keep the title and path; say the summary is missing.
      summary: summary || PAPER_SUMMARY_PENDING,
      sourceRelativePath: normalizeRelativePath(intake.source_paths?.paper_md)
        || source.knowledgeMarkdownRelativePath
        || sourceRelativePath
    });
  }
  return entries.sort((left, right) => (
    String(left.title || left.paperId).localeCompare(String(right.title || right.paperId))
  ));
}

function buildProjectMemoryInput({
  storageRootPath,
  folderPath,
  filePath,
  snapshot,
  projectRecord,
  requestNotebookConclusion
} = {}) {
  const safeSnapshot = ensureObject(snapshot);
  const notebooks = asArray(safeSnapshot.notebookEntries)
    .map((entry) => buildNotebookMemorySource(storageRootPath, projectRecord, ensureObject(entry)))
    .filter(Boolean)
    .sort((left, right) => String(left.title || left.id).localeCompare(String(right.title || right.id)));
  return {
    projectKey: path.resolve(folderPath),
    storageRootPath,
    folderPath,
    filePath,
    projectRecord: JSON.parse(JSON.stringify(projectRecord)),
    paperSources: collectProjectPaperSources(safeSnapshot, projectRecord),
    notebooks,
    requestNotebookConclusion: typeof requestNotebookConclusion === 'function'
      ? requestNotebookConclusion
      : null
  };
}

async function renderProjectMemoryInput(input, { writePrunedCache = false } = {}) {
  const [paperEntries, loadedCache] = await Promise.all([
    loadProjectPaperEntries(input.storageRootPath, input.paperSources),
    readNotebookConclusionCache(input.folderPath)
  ]);
  const cache = pruneNotebookConclusionCache(loadedCache, input.notebooks);
  if (writePrunedCache && stableJson(cache) !== stableJson(loadedCache)) {
    await writeNotebookConclusionCache(input.folderPath, cache);
  }
  const misses = [];
  const notebookEntries = input.notebooks.map((source) => {
    const cached = cache[source.key];
    if (!cached || cached.hash !== source.hash) {
      misses.push(source);
    }
    const conclusion = cached && cached.hash === source.hash
      ? cached
      : buildFallbackCacheEntry(source, '');
    return {
      ...source,
      conclusion: conclusion.conclusion,
      generatedAt: conclusion.generatedAt,
      model: conclusion.model
    };
  });
  const generatedBlock = buildProjectMemoryGeneratedBlock(input.projectRecord, {
    paperEntries,
    notebookEntries
  });
  const existing = await readExistingText(input.filePath);
  await atomicWriteFile(
    input.filePath,
    mergeProjectMemoryMarkdown(existing, generatedBlock)
  );
  return { misses };
}

// A page we cannot read is not the same as a page that changed, and readJsonObject
// reports both as {}. Conflating them is what made a failed read re-ask the model
// on every single save, so the caller needs to tell them apart.
async function readCurrentNotebookMemorySource(input, requestedSource) {
  let payload = null;
  try {
    payload = JSON.parse(await fs.readFile(requestedSource.pageFilePath, 'utf8'));
  } catch {
    return { unverifiable: true, source: null };
  }
  return {
    unverifiable: false,
    source: buildNotebookMemorySource(
      input.storageRootPath,
      input.projectRecord,
      ensureObject(ensureObject(payload).notebookEntry)
    )
  };
}

async function generateAndCacheNotebookConclusion(projectKey, requestedSource) {
  const input = latestProjectMemoryInputs.get(projectKey);
  if (!input) {
    return;
  }
  const latestSource = input.notebooks.find((source) => source.key === requestedSource.key);
  if (!latestSource || latestSource.hash !== requestedSource.hash) {
    return;
  }
  const cache = pruneNotebookConclusionCache(
    await readNotebookConclusionCache(input.folderPath),
    input.notebooks
  );
  if (cache[requestedSource.key]?.hash === requestedSource.hash) {
    return;
  }

  let result = null;
  if (input.requestNotebookConclusion) {
    try {
      result = await input.requestNotebookConclusion(
        buildNotebookConclusionRequest(requestedSource)
      );
    } catch {
      result = null;
    }
  }

  const currentInput = latestProjectMemoryInputs.get(projectKey);
  const latestSnapshotSource = currentInput?.notebooks.find((source) => source.key === requestedSource.key);
  if (!currentInput || !latestSnapshotSource || latestSnapshotSource.hash !== requestedSource.hash) {
    return;
  }
  const { unverifiable, source: currentSource } = await readCurrentNotebookMemorySource(
    currentInput,
    requestedSource
  );
  const verified = Boolean(
    currentSource
    && currentSource.key === requestedSource.key
    && currentSource.hash === requestedSource.hash
  );
  if (!verified && !unverifiable) {
    // The saved page really did change under us. Drop the answer and let a later
    // sync generate against the new content.
    return;
  }

  // Unverifiable falls through to the verbatim extract below: still never publish
  // a conclusion we could not confirm against the saved page, but do record that
  // we are done asking, or this repeats on every save forever.
  const validated = verified ? validateNotebookConclusionResult(result, currentSource) : null;
  // Only the read-modify-write needs the file queue; the model call above must
  // stay outside it or every save queues behind the whole batch.
  await enqueueProjectMemoryWork(projectKey, async () => {
    const nextCache = pruneNotebookConclusionCache(
      await readNotebookConclusionCache(currentInput.folderPath),
      currentInput.notebooks
    );
    nextCache[requestedSource.key] = validated
      ? {
          hash: requestedSource.hash,
          conclusion: validated.conclusion,
          generatedAt: new Date().toISOString(),
          model: validated.model || 'generated'
        }
      : buildFallbackCacheEntry(requestedSource);
    await writeNotebookConclusionCache(currentInput.folderPath, nextCache);
  });
}

module.exports = {
  buildProjectMemoryInput,
  generateAndCacheNotebookConclusion,
  renderProjectMemoryInput
};
