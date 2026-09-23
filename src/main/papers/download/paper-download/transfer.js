'use strict';

const fsPromises = require('node:fs/promises');

const { ensureObject } = require('../../../lib/normalize.js');
const {
  BLOCKED_HTML_PATTERN,
  BLOCKED_STATUS_CODES,
  DEFAULT_FETCH_ACCEPT,
  DEFAULT_USER_AGENT
} = require('./constants.js');
const {
  bufferLooksLikePdf,
  createDownloadError,
  isExplicitFalse,
  normalizeHeadersObject,
  readResponseBuffer,
  readResponseText
} = require('./http-response.js');
const { resolvePaperCollectionName } = require('./storage-paths.js');

// Getting the bytes onto disk: the direct fetch, the browser-session fallback
// when a publisher blocks it, and the knowledge-database handoff afterwards.
function createPaperTransfer({
  cleanText,
  now,
  fetchImpl,
  updateJob,
  paperKnowledgeDatabaseRuntime,
  providedBrowserSession,
  terminateBrowserDownloadSession,
  startDefaultBrowserDownloadSession
} = {}) {
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

    updateJob(downloadId, { knowledge_status: 'processing' });
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
      knowledge_status: knowledgeResult?.ok ? 'ready' : 'failed',
      knowledge_markdown_path: cleanText(knowledgeResult?.markdown_path, 4000),
      knowledge_markdown_relative_path: cleanText(knowledgeResult?.markdown_relative_path, 2000),
      summary: cleanText(result.summary, 600)
    });
  }

  return {
    performDirectDownload,
    performBrowserFallback,
    attachKnowledgeDatabaseResult
  };
}

module.exports = { createPaperTransfer };
