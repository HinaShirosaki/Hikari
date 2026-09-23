'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { asArray, cleanText, ensureObject } = require('../storage-utils');
const { atomicWriteFile, buildFallbackCacheEntry, shouldGenerateConclusion, pruneNotebookConclusionCache, readJsonObject, readNotebookConclusionCache, stableJson, writeNotebookConclusionCache } = require('./conclusion-cache.js');
const { buildNotebookConclusionRequest, validateNotebookConclusionResult } = require('./conclusion-request.js');
const { PAPER_SUMMARY_PENDING } = require('./constants.js');
const { buildProjectMemoryGeneratedBlock, mergeProjectMemoryMarkdown, projectMemoryByteBudget, readExistingText } = require('./memory-markdown.js');
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
        updatedAt: cleanText(paper.updatedAt || paper.updated_at || paper.createdAt || paper.discoveredAt, 80),
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
      updatedAt: source.updatedAt,
      title: cleanText(intake.title, 400) || source.fallbackTitle || source.paperId,
      // ponytail: papers predating intake.json used to be dropped here, so a
      // project with linked-but-unanalyzed papers rendered the same as one with
      // no papers. Keep the title; say the summary is missing.
      summary: summary || PAPER_SUMMARY_PENDING
    });
  }
  return entries;
}

// The agent cannot write this file: Codex runs read-only. Its durable write is
// the `memory` tool, so the notes section renders that store's project-scoped
// records rather than inviting an edit the sandbox would refuse.
async function loadProjectNoteEntries(agentMemoryFilePath, projectRecord) {
  const filePath = cleanText(agentMemoryFilePath, 2400);
  if (!filePath) {
    return [];
  }
  const payload = await readJsonObject(filePath);
  const projectId = cleanText(ensureObject(projectRecord).projectId, 220);
  const projectName = cleanText(
    ensureObject(projectRecord).displayName || ensureObject(projectRecord).folderName,
    320
  ).toLowerCase();
  return asArray(payload.items)
    .map((item) => ensureObject(item))
    .filter((item) => {
      if (cleanText(item.scope, 40) !== 'project') {
        return false;
      }
      const itemId = cleanText(item.project_id, 220);
      const itemName = cleanText(item.project_name, 320).toLowerCase();
      return (projectId && itemId && itemId === projectId)
        || (projectName && itemName && itemName === projectName);
    })
    .map((item) => ({
      id: cleanText(item.id, 160),
      title: cleanText(item.key, 220) || cleanText(item.category, 120) || cleanText(item.id, 160),
      summary: cleanText(item.summary, 800)
        || (item.value && typeof item.value === 'object' ? JSON.stringify(item.value) : cleanText(item.value, 800)),
      updatedAt: cleanText(item.updated_at || item.created_at, 80)
    }))
    .filter((note) => note.title && note.summary);
}

function buildProjectMemoryInput({
  storageRootPath,
  folderPath,
  filePath,
  snapshot,
  projectRecord,
  requestNotebookConclusion,
  agentMemoryFilePath = ''
} = {}) {
  const safeSnapshot = ensureObject(snapshot);
  const notebooks = asArray(safeSnapshot.notebookEntries)
    .map((entry) => buildNotebookMemorySource(storageRootPath, projectRecord, ensureObject(entry)))
    .filter(Boolean);
  return {
    projectKey: path.resolve(folderPath),
    storageRootPath,
    folderPath,
    filePath,
    projectRecord: JSON.parse(JSON.stringify(projectRecord)),
    paperSources: collectProjectPaperSources(safeSnapshot, projectRecord),
    agentMemoryFilePath: cleanText(agentMemoryFilePath, 2400),
    notebooks,
    requestNotebookConclusion: typeof requestNotebookConclusion === 'function'
      ? requestNotebookConclusion
      : null
  };
}

async function renderProjectMemoryInput(input, { writePrunedCache = false, resetConclusions = false } = {}) {
  const [paperEntries, noteEntries, loadedCache] = await Promise.all([
    loadProjectPaperEntries(input.storageRootPath, input.paperSources),
    loadProjectNoteEntries(input.agentMemoryFilePath, input.projectRecord),
    readNotebookConclusionCache(input.folderPath)
  ]);
  const cache = resetConclusions ? {} : pruneNotebookConclusionCache(loadedCache, input.notebooks);
  if (writePrunedCache && stableJson(cache) !== stableJson(loadedCache)) {
    await writeNotebookConclusionCache(input.folderPath, cache);
  }
  const misses = [];
  const notebookEntries = input.notebooks.map((source) => {
    const cached = cache[source.key];
    if (shouldGenerateConclusion(cached, source)) {
      misses.push(source);
    }
    const conclusion = cached && cached.hash === source.hash && cached.status === 'evidence'
      ? cached
      : buildFallbackCacheEntry(source, '');
    return {
      ...source,
      conclusion: conclusion.conclusion,
      quotes: conclusion.quotes,
      generatedAt: conclusion.generatedAt,
      model: conclusion.model
    };
  });
  const existing = await readExistingText(input.filePath);
  const generatedBlock = buildProjectMemoryGeneratedBlock(input.projectRecord, {
    paperEntries,
    notebookEntries,
    noteEntries,
    byteBudget: projectMemoryByteBudget(existing)
  });
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
  if (!shouldGenerateConclusion(cache[requestedSource.key], requestedSource)) {
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
  // a conclusion we could not confirm against the saved page. Record a bounded
  // retry with backoff instead of paying again on every save.
  const validated = verified ? validateNotebookConclusionResult(result, currentSource) : null;
  // Only the read-modify-write needs the file queue; the model call above must
  // stay outside it or every save queues behind the whole batch.
  await enqueueProjectMemoryWork(projectKey, async () => {
    const newestInput = latestProjectMemoryInputs.get(projectKey);
    const newestSource = newestInput?.notebooks.find((source) => source.key === requestedSource.key);
    if (!newestSource || newestSource.hash !== requestedSource.hash) return;
    const nextCache = pruneNotebookConclusionCache(
      await readNotebookConclusionCache(newestInput.folderPath),
      newestInput.notebooks
    );
    nextCache[requestedSource.key] = validated
      ? {
          hash: requestedSource.hash,
          conclusion: validated.conclusion,
          generatedAt: new Date().toISOString(),
          model: validated.model || 'generated',
          status: 'evidence',
          quotes: validated.quotes,
          sourceRelativePath: requestedSource.sourceRelativePath,
          attempts: 0,
          retryAfter: ''
        }
      : {
          ...buildFallbackCacheEntry(requestedSource),
          attempts: (cache[requestedSource.key]?.attempts || 0) + 1,
          retryAfter: new Date(Date.now() + 5 * 60 * 1000 * (2 ** (cache[requestedSource.key]?.attempts || 0))).toISOString()
        };
    await writeNotebookConclusionCache(newestInput.folderPath, nextCache);
  });
}

module.exports = {
  buildProjectMemoryInput,
  generateAndCacheNotebookConclusion,
  renderProjectMemoryInput
};
