'use strict';

const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { cloneJson, ensureObject } = require('../../lib/normalize.js');
const { createBrowserDownloadSession } = require('./paper-download/browser-session.js');
const { BLOCKED_HTML_PATTERN, BLOCKED_STATUS_CODES, DEFAULT_FETCH_ACCEPT, DEFAULT_USER_AGENT, PAPER_DOWNLOAD_ACTIONS } = require('./paper-download/constants.js');
const { bufferLooksLikePdf, createDownloadError, inferPdfFileName, isExplicitFalse, normalizeHeadersObject, readResponseBuffer, readResponseText } = require('./paper-download/http-response.js');
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


  async function performDirectDownload(options = {}) {
    const {
      input,
      extraction,
      target,
      downloadId
    } = options;

    if (!fetchImpl) {
      throw createDownloadError('Fetch is unavailable for paper download.');
    }

    const source = ensureObject(input);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutMs = Number(source.timeout_ms || source.timeoutMs);
    const timeoutHandle = controller && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await fetchImpl(extraction.selected_pdf_url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          Accept: DEFAULT_FETCH_ACCEPT,
          'User-Agent': DEFAULT_USER_AGENT,
          ...normalizeHeadersObject(source.request_headers || source.requestHeaders)
        },
        ...(controller ? { signal: controller.signal } : {})
      });

      const status = Number(response?.status) || 0;
      const contentType = cleanText(response?.headers?.get?.('content-type'), 240).toLowerCase();
      if (!response?.ok) {
        const preview = await readResponseText(response).catch(() => '');
        throw createDownloadError(
          `Failed to download paper PDF (${status || 'request failed'}).`,
          {
            status_code: status,
            retry_with_browser: BLOCKED_STATUS_CODES.has(status) || BLOCKED_HTML_PATTERN.test(preview),
            browser_required: BLOCKED_STATUS_CODES.has(status) || BLOCKED_HTML_PATTERN.test(preview)
          }
        );
      }

      if (contentType && /(text\/html|text\/plain|application\/xhtml\+xml|application\/xml)/i.test(contentType)) {
        const preview = await readResponseText(response).catch(() => '');
        throw createDownloadError(
          'Download response did not return a PDF file.',
          {
            retry_with_browser: BLOCKED_HTML_PATTERN.test(preview) || Boolean(extraction.browser_entry_url),
            browser_required: BLOCKED_HTML_PATTERN.test(preview) || Boolean(extraction.browser_entry_url)
          }
        );
      }

      const totalBytes = Number(response?.headers?.get?.('content-length')) || 0;
      updateJob(downloadId, {
        status: 'downloading',
        method: 'direct',
        selected_pdf_url: extraction.selected_pdf_url,
        browser_entry_url: extraction.browser_entry_url,
        target_folder: target.target_folder,
        file_name: target.file_name,
        file_path: target.target_file_path,
        relative_path: target.relative_path,
        total_bytes: totalBytes,
        received_bytes: 0,
        summary: `Downloading ${target.file_name}.`
      });

      let receivedBytes = 0;
      const buffer = await readResponseBuffer(response, async (chunk) => {
        receivedBytes += chunk.length;
        updateJob(downloadId, {
          status: 'downloading',
          method: 'direct',
          received_bytes: receivedBytes,
          total_bytes: totalBytes
        });
      });

      if (!bufferLooksLikePdf(buffer)) {
        const preview = buffer.toString('utf8', 0, Math.min(buffer.length, 600));
        throw createDownloadError(
          'Downloaded content was not a PDF.',
          {
            retry_with_browser: BLOCKED_HTML_PATTERN.test(preview) || Boolean(extraction.browser_entry_url),
            browser_required: BLOCKED_HTML_PATTERN.test(preview) || Boolean(extraction.browser_entry_url)
          }
        );
      }

      await fsPromises.writeFile(target.target_file_path, buffer);
      return updateJob(downloadId, {
        ok: true,
        status: 'completed',
        method: 'direct',
        file_name: target.file_name,
        file_path: target.target_file_path,
        relative_path: target.relative_path,
        received_bytes: receivedBytes || buffer.length,
        total_bytes: totalBytes || buffer.length,
        completed_at: now(),
        summary: `Downloaded ${target.file_name}.`
      });
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  async function performBrowserFallback(options = {}) {
    const {
      input,
      extraction,
      target,
      downloadId
    } = options;
    const source = ensureObject(input);

    updateJob(downloadId, {
      status: 'awaiting_browser_click',
      method: 'browser',
      browser_session_active: true,
      browser_entry_url: extraction.browser_entry_url,
      selected_pdf_url: extraction.selected_pdf_url,
      summary: 'Waiting for the browser-assisted download session.'
    });

    const result = await startDefaultBrowserDownloadSession({
      downloadId,
      browserEntryUrl: extraction.browser_entry_url,
      selectedPdfUrl: extraction.selected_pdf_url,
      targetFilePath: target.target_file_path,
      storagePath: target.storage_path,
      simulateOneClick: source.simulate_one_click !== false,
      timeoutMs: Number(source.timeout_ms || source.timeoutMs) || 120000,
      updateProgress: (patch) => updateJob(downloadId, patch)
    });
    const browserSessionId = cleanText(result?.session_id, 160);

    if (providedBrowserSession && browserSessionId && terminateBrowserDownloadSession) {
      await Promise.resolve(terminateBrowserDownloadSession({
        session_id: browserSessionId,
        download_id: downloadId
      })).catch(() => {});
    }

    if (!result?.ok) {
      throw createDownloadError(result?.error || 'Browser-assisted paper download failed.', {
        browser_required: true
      });
    }

    if (!result.file_path && result.data_base64) {
      await fsPromises.writeFile(target.target_file_path, Buffer.from(String(result.data_base64), 'base64'));
    }

    return updateJob(downloadId, {
      ok: true,
      status: 'completed',
      method: 'browser',
      browser_session_active: false,
      browser_session_id: browserSessionId,
      browser_session_terminated: Boolean(browserSessionId),
      file_name: cleanText(result.file_name, 240) || target.file_name,
      file_path: cleanText(result.file_path, 4000) || target.target_file_path,
      relative_path: cleanText(result.relative_path, 2000) || target.relative_path,
      received_bytes: Number(result.received_bytes) || Number(result.total_bytes) || 0,
      total_bytes: Number(result.total_bytes) || Number(result.received_bytes) || 0,
      completed_at: now(),
      summary: cleanText(result.summary, 600) || `Downloaded ${target.file_name} through the browser session.`
    });
  }

  async function attachKnowledgeDatabaseResult(downloadId, downloadResult = {}, input = {}) {
    const source = ensureObject(input);
    const result = ensureObject(downloadResult);
    if (!paperKnowledgeDatabaseRuntime || typeof paperKnowledgeDatabaseRuntime.ingestPaperPdf !== 'function') {
      return result;
    }
    if (result.ok !== true || !cleanText(result.file_path, 4000)) {
      return result;
    }
    if (isExplicitFalse(source.knowledge_database) || isExplicitFalse(source.update_knowledge_database)) {
      return result;
    }

    const knowledgeResult = await paperKnowledgeDatabaseRuntime.ingestPaperPdf({
      ...source,
      file_path: result.file_path,
      file_name: result.file_name,
      stored_relative_path: result.relative_path,
      source: cleanText(source.source, 80) || 'agent',
      linked_type: cleanText(source.linked_type || source.linkedType, 80),
      linked_name: cleanText(resolvePaperCollectionName(source), 220),
      paper_title: cleanText(source.paper_title || source.paperTitle || result.file_name, 320),
      traceContext: source.traceContext || null
    }).catch((error) => ({
      ok: false,
      status: 'failed',
      error: cleanText(error?.message || error, 1200) || 'Paper knowledge database update failed.'
    }));

    return updateJob(downloadId, {
      knowledge_database: knowledgeResult,
      knowledge_markdown_path: cleanText(knowledgeResult?.markdown_path, 4000),
      knowledge_markdown_relative_path: cleanText(knowledgeResult?.markdown_relative_path, 2000),
      summary: cleanText(result.summary, 600)
    });
  }

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
