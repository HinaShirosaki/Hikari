'use strict';

const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { cloneJson, ensureObject } = require('../../lib/normalize.js');
const { createBrowserDownloadSession } = require('./paper-download/browser-session.js');
const { createPaperTransfer } = require('./paper-download/transfer.js');
const { PAPER_DOWNLOAD_ACTIONS } = require('./paper-download/constants.js');
const { createDownloadError, inferPdfFileName, isExplicitFalse } = require('./paper-download/http-response.js');
const { buildPaperStorageFolder, buildRelativePath, createDownloadId, defaultCleanText, ensurePathWithinRoot, getUniqueFilePath, resolvePaperCollectionName } = require('./paper-download/storage-paths.js');
const { extractPaperDownloadTargets, normalizeAction } = require('./paper-download/url-targets.js');

function createPaperDownloadRuntime(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const createId = typeof deps.createId === 'function' ? deps.createId : createDownloadId;
  const fetchImpl = typeof deps.fetch === 'function'
    ? deps.fetch
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const onJobUpdate = typeof deps.onJobUpdate === 'function' ? deps.onJobUpdate : null;
  const jobs = deps.jobs instanceof Map ? deps.jobs : new Map();
  const activeTasks = deps.activeTasks instanceof Map ? deps.activeTasks : new Map();
  const providedBrowserSession = typeof deps.startBrowserDownloadSession === 'function'
    ? deps.startBrowserDownloadSession
    : null;
  const terminateBrowserDownloadSession = typeof deps.terminateBrowserDownloadSession === 'function'
    ? deps.terminateBrowserDownloadSession
    : null;
  const allowDefaultBrowserSession = deps.enableDefaultBrowserSession === true;
  const BrowserWindow = allowDefaultBrowserSession && typeof deps.BrowserWindow === 'function'
    ? deps.BrowserWindow
    : (allowDefaultBrowserSession && typeof deps.electron?.BrowserWindow === 'function' ? deps.electron.BrowserWindow : null);
  const { startDefaultBrowserDownloadSession } = createBrowserDownloadSession({
    BrowserWindow,
    cleanText,
    providedBrowserSession,
    terminateBrowserDownloadSession
  });
  const paperKnowledgeDatabaseRuntime = deps.paperKnowledgeDatabaseRuntime
    && typeof deps.paperKnowledgeDatabaseRuntime === 'object'
    ? deps.paperKnowledgeDatabaseRuntime
    : null;

  function buildJobSnapshot(job) {
    return cloneJson(ensureObject(job), {});
  }

  function getStoredJob(downloadId) {
    const key = cleanText(downloadId, 160);
    if (!key || !jobs.has(key)) {
      return null;
    }
    return buildJobSnapshot(jobs.get(key));
  }

  function persistJob(job) {
    const source = ensureObject(job);
    const key = cleanText(source.download_id, 160);
    if (!key) {
      throw new Error('download_id is required.');
    }
    const snapshot = buildJobSnapshot(source);
    jobs.set(key, snapshot);
    return snapshot;
  }

  function updateJob(downloadId, patch = {}) {
    const current = ensureObject(getStoredJob(downloadId));
    const merged = {
      ...current,
      ...cloneJson(ensureObject(patch), {}),
      updated_at: now()
    };
    const totalBytes = Number(merged.total_bytes);
    const receivedBytes = Number(merged.received_bytes);
    if (Number.isFinite(totalBytes) && totalBytes > 0 && Number.isFinite(receivedBytes)) {
      merged.progress_ratio = Math.max(0, Math.min(1, receivedBytes / totalBytes));
    } else if (merged.status === 'completed') {
      merged.progress_ratio = 1;
    } else if (!Number.isFinite(Number(merged.progress_ratio))) {
      merged.progress_ratio = 0;
    }
    const snapshot = persistJob(merged);
    if (onJobUpdate) {
      Promise.resolve(onJobUpdate(buildJobSnapshot(snapshot))).catch(() => {});
    }
    return snapshot;
  }

  async function waitForDownload(input = {}) {
    const source = ensureObject(input);
    const downloadId = cleanText(source.download_id || source.downloadId, 160);
    if (!downloadId) {
      return {
        ok: false,
        status: 'error',
        error: 'wait requires download_id.'
      };
    }
    const task = activeTasks.get(downloadId);
    if (task) {
      await task.catch(() => {});
    }
    return getDownloadStatus({ download_id: downloadId });
  }

  function getDownloadStatus(input = {}) {
    const source = ensureObject(input);
    const downloadId = cleanText(source.download_id || source.downloadId, 160);
    if (!downloadId) {
      return {
        ok: false,
        status: 'error',
        error: 'status requires download_id.'
      };
    }
    const job = getStoredJob(downloadId);
    if (!job) {
      return {
        ok: false,
        status: 'missing',
        error: `Paper download "${downloadId}" was not found.`
      };
    }
    return {
      ...job,
      ok: job.status === 'completed'
    };
  }

  async function resolveTargetFile(input = {}, extraction = {}) {
    const source = ensureObject(input);
    const storagePath = cleanText(source.storage_path || source.storagePath, 2000);
    if (!storagePath) {
      throw createDownloadError('Paper download requires storage_path.');
    }

    const linkedName = cleanText(resolvePaperCollectionName(source), 220);
    if (!linkedName) {
      throw createDownloadError('Paper download requires linked_name.');
    }

    const targetFolder = ensurePathWithinRoot(
      storagePath,
      buildPaperStorageFolder({
        rootPath: storagePath,
        linkedType: cleanText(source.linked_type || source.linkedType, 80),
        linkedName
      })
    );
    await fsPromises.mkdir(targetFolder, { recursive: true });

    const inferredName = inferPdfFileName(source, extraction.selected_pdf_url || extraction.browser_entry_url || '');
    const targetFilePath = await getUniqueFilePath(targetFolder, inferredName);
    return {
      storage_path: path.resolve(storagePath),
      target_folder: targetFolder,
      target_file_path: targetFilePath,
      file_name: path.basename(targetFilePath),
      relative_path: buildRelativePath(storagePath, targetFilePath)
    };
  }



  const {
    performDirectDownload,
    performBrowserFallback,
    attachKnowledgeDatabaseResult
  } = createPaperTransfer({
    cleanText,
    now,
    fetchImpl,
    updateJob,
    paperKnowledgeDatabaseRuntime,
    providedBrowserSession,
    terminateBrowserDownloadSession,
    startDefaultBrowserDownloadSession
  });

  async function runDownload(downloadId, input = {}) {
    const extraction = extractPaperDownloadTargets(input);
    const target = await resolveTargetFile(input, extraction);
    updateJob(downloadId, {
      extraction,
      storage_path: target.storage_path,
      target_folder: target.target_folder,
      file_name: target.file_name,
      file_path: target.target_file_path,
      relative_path: target.relative_path,
      selected_pdf_url: extraction.selected_pdf_url,
      browser_entry_url: extraction.browser_entry_url,
      summary: extraction.summary
    });

    try {
      if (extraction.selected_pdf_url) {
        const completed = await performDirectDownload({
          input,
          extraction,
          target,
          downloadId
        });
        return attachKnowledgeDatabaseResult(downloadId, completed, input);
      }
      if (extraction.browser_entry_url) {
        const completed = await performBrowserFallback({
          input,
          extraction,
          target,
          downloadId
        });
        return attachKnowledgeDatabaseResult(downloadId, completed, input);
      }
      throw createDownloadError('No paper download URL was found.');
    } catch (error) {
      const shouldUseBrowser = error?.retry_with_browser === true
        || error?.browser_required === true
        || (!extraction.selected_pdf_url && Boolean(extraction.browser_entry_url));
      if (shouldUseBrowser && !isExplicitFalse(ensureObject(input).use_browser_fallback) && extraction.browser_entry_url) {
        try {
          const completed = await performBrowserFallback({
            input,
            extraction,
            target,
            downloadId
          });
          return attachKnowledgeDatabaseResult(downloadId, completed, input);
        } catch (browserError) {
          const browserStatus = browserError?.browser_required === true ? 'browser_required' : 'failed';
          const failed = updateJob(downloadId, {
            ok: false,
            status: browserStatus,
            method: extraction.selected_pdf_url ? 'direct' : 'browser',
            browser_session_active: false,
            error: cleanText(browserError?.message, 1200) || 'Paper download failed.',
            completed_at: now(),
            summary: cleanText(browserError?.message, 600) || 'Paper download failed.'
          });
          return failed;
        }
      }

      const status = error?.browser_required === true ? 'browser_required' : 'failed';
      return updateJob(downloadId, {
        ok: false,
        status,
        method: extraction.selected_pdf_url ? 'direct' : '',
        browser_session_active: false,
        error: cleanText(error?.message, 1200) || 'Paper download failed.',
        completed_at: now(),
        summary: cleanText(error?.message, 600) || 'Paper download failed.'
      });
    } finally {
      activeTasks.delete(downloadId);
    }
  }

  async function startDownload(input = {}) {
    const source = ensureObject(input);
    const action = normalizeAction(source.action);
    if (action && action !== PAPER_DOWNLOAD_ACTIONS.START && action !== PAPER_DOWNLOAD_ACTIONS.DOWNLOAD) {
      return {
        ok: false,
        status: 'error',
        error: 'start supports only the "start" or "download" action.'
      };
    }

    const downloadId = cleanText(source.download_id || source.downloadId, 160) || createId();
    if (jobs.has(downloadId) || activeTasks.has(downloadId)) {
      return {
        ok: false,
        status: 'error',
        error: `Paper download "${downloadId}" already exists.`
      };
    }

    const createdAt = now();
    const initialJob = persistJob({
      ok: false,
      download_id: downloadId,
      action: PAPER_DOWNLOAD_ACTIONS.START,
      status: 'queued',
      created_at: createdAt,
      updated_at: createdAt,
      started_at: createdAt,
      linked_type: cleanText(source.linked_type || source.linkedType, 80) || 'project',
      linked_name: cleanText(resolvePaperCollectionName(source), 220),
      progress_ratio: 0,
      received_bytes: 0,
      total_bytes: 0,
      summary: 'Paper download queued.'
    });
    const task = runDownload(downloadId, source);
    activeTasks.set(downloadId, task);
    return {
      ...buildJobSnapshot(initialJob),
      ok: true,
      status: 'started',
      summary: `Started paper download ${downloadId}.`
    };
  }

  async function downloadPaper(input = {}) {
    const started = await startDownload({
      ...ensureObject(input),
      action: PAPER_DOWNLOAD_ACTIONS.DOWNLOAD
    });
    if (!started?.ok) {
      return started;
    }
    return waitForDownload({ download_id: started.download_id });
  }

  async function execute(input = {}) {
    const source = ensureObject(input);
    const action = normalizeAction(source.action);
    if (!action) {
      return {
        ok: false,
        status: 'error',
        error: 'action must be one of download, start, or status.'
      };
    }

    if (action === PAPER_DOWNLOAD_ACTIONS.STATUS) {
      return getDownloadStatus(source);
    }
    if (action === PAPER_DOWNLOAD_ACTIONS.START) {
      return startDownload(source);
    }
    return downloadPaper(source);
  }

  return {
    PAPER_DOWNLOAD_ACTIONS,
    buildPaperStorageFolder,
    extractPaperDownloadTargets,
    startDownload,
    waitForDownload,
    getDownloadStatus,
    downloadPaper,
    execute
  };
}

module.exports = {
  PAPER_DOWNLOAD_ACTIONS,
  buildPaperStorageFolder,
  extractPaperDownloadTargets,
  createPaperDownloadRuntime
};
