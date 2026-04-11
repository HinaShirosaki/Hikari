'use strict';

const fsPromises = require('node:fs/promises');
const path = require('node:path');

const PAPER_DOWNLOAD_ACTIONS = Object.freeze({
  DOWNLOAD: 'download',
  START: 'start',
  STATUS: 'status'
});

const BLOCKED_STATUS_CODES = new Set([401, 403, 407, 409, 423, 425, 429, 451, 503]);
const BLOCKED_HTML_PATTERN = /captcha|cloudflare|checking your browser|access denied|verify you are human|automated requests|enable javascript|robot/i;
const PDF_URL_HINT_PATTERN = /(?:\.pdf(?:$|[?#])|\/pdf(?:\/|$)|[?&](?:format|type|download|pdf)=(?:1|true|pdf)?\b|[?&][^=#]*pdf\b)/i;
const DEFAULT_FETCH_ACCEPT = 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; EnanaPaperDownload/1.0; +https://enana.local)';

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, _maxLength = 4000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function createDownloadId() {
  return `paper-download-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function sanitizeStorageName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
}

function sanitizeImportedFileName(fileName, fallback = 'paper.pdf') {
  const rawName = String(fileName || '').trim();
  const ext = path.extname(rawName).replace(/[^.\w-]+/g, '').slice(0, 24);
  const base = rawName.slice(0, Math.max(0, rawName.length - ext.length));
  const safeBase = sanitizeStorageName(base, path.parse(fallback).name || 'paper');
  const safeExt = ext || '.pdf';
  return `${safeBase}${safeExt}`;
}

function ensurePdfFileName(fileName, fallback = 'paper.pdf') {
  const sanitized = sanitizeImportedFileName(fileName || fallback, fallback);
  return /\.pdf$/i.test(sanitized) ? sanitized : `${sanitized}.pdf`;
}

function buildPaperStorageFolder({ rootPath, linkedType, linkedName }) {
  const normalizedType = String(linkedType || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  const category = normalizedType === 'journal-club'
    ? 'JournalClub'
    : (normalizedType === 'literature-search'
      ? 'LiteratureSearch'
      : 'Project');
  const safeLinkedName = sanitizeStorageName(linkedName, 'Uncategorized');
  return `${String(rootPath || '').trim()}/${category}/${safeLinkedName}/Papers`;
}

function ensurePathWithinRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === resolvedRoot) {
    return resolvedTarget;
  }
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : `${resolvedRoot}${path.sep}`;
  if (!resolvedTarget.startsWith(rootWithSep)) {
    throw new Error('Target path must be inside the configured storage path.');
  }
  return resolvedTarget;
}

async function pathExists(targetPath) {
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function getUniqueFilePath(folderPath, fileName) {
  const parsed = path.parse(fileName);
  const safeNameBase = sanitizeStorageName(parsed.name, 'paper');
  const safeExt = String(parsed.ext || '.pdf').replace(/[^.\w-]+/g, '').slice(0, 24) || '.pdf';
  let attempt = 0;

  while (attempt < 5000) {
    const suffix = attempt === 0 ? '' : `_${attempt + 1}`;
    const candidateName = `${safeNameBase}${suffix}${safeExt}`;
    const candidatePath = path.join(folderPath, candidateName);
    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
    attempt += 1;
  }

  throw new Error('Unable to find a unique file name for paper download.');
}

function normalizeAction(value) {
  const normalized = defaultCleanText(value, 40).toLowerCase();
  if (!normalized) {
    return PAPER_DOWNLOAD_ACTIONS.DOWNLOAD;
  }
  return Object.values(PAPER_DOWNLOAD_ACTIONS).includes(normalized) ? normalized : '';
}

function resolveAbsoluteUrl(rawUrl, baseUrl = '') {
  const candidate = String(rawUrl || '').trim();
  if (!candidate) {
    return '';
  }
  try {
    return new URL(candidate, baseUrl || undefined).toString();
  } catch {
    return '';
  }
}

function extractUrlsFromText(rawText, baseUrl = '') {
  const text = String(rawText || '');
  const urls = [];
  const pattern = /https?:\/\/[^\s<>"')\]]+/gi;
  let match = pattern.exec(text);
  while (match) {
    const cleaned = String(match[0] || '').replace(/[),.;]+$/g, '');
    const resolved = resolveAbsoluteUrl(cleaned, baseUrl);
    if (resolved) {
      urls.push(resolved);
    }
    match = pattern.exec(text);
  }
  return urls;
}

function extractUrlsFromHtml(rawHtml, baseUrl = '') {
  const html = String(rawHtml || '');
  const urls = [];
  const attrPattern = /\b(?:href|src|content|data-href|data-url)\s*=\s*["']([^"']+)["']/gi;
  let match = attrPattern.exec(html);
  while (match) {
    const resolved = resolveAbsoluteUrl(match[1], baseUrl);
    if (resolved) {
      urls.push(resolved);
    }
    match = attrPattern.exec(html);
  }
  return urls;
}

function looksLikePdfUrl(url) {
  return PDF_URL_HINT_PATTERN.test(String(url || '').trim());
}

function scoreCandidateUrl(candidate = {}) {
  const url = String(candidate.url || '');
  const source = String(candidate.source || '');
  let score = 0;
  if (source === 'paper_pdf_url' || source === 'pdf_url') {
    score += 200;
  } else if (source === 'candidate_urls' || source === 'pdf_urls') {
    score += 140;
  } else if (source === 'page_html') {
    score += 100;
  } else if (source === 'message') {
    score += 80;
  } else if (source === 'page_url' || source === 'paper_url' || source === 'url') {
    score += 40;
  }
  if (/\.pdf(?:$|[?#])/i.test(url)) {
    score += 100;
  } else if (/\/pdf(?:\/|$)/i.test(url)) {
    score += 80;
  } else if (/[?&](?:format|type)=pdf\b/i.test(url)) {
    score += 70;
  } else if (/[?&]download=(?:1|true)?\b/i.test(url) || /download/i.test(url)) {
    score += 40;
  } else if (looksLikePdfUrl(url)) {
    score += 20;
  }
  return score;
}

function dedupeCandidateUrls(entries = []) {
  const seen = new Set();
  return defaultAsArray(entries)
    .map((entry) => ({
      url: defaultCleanText(entry?.url, 2400),
      source: defaultCleanText(entry?.source, 80)
    }))
    .filter((entry) => entry.url)
    .filter((entry) => {
      const key = entry.url.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function extractPaperDownloadTargets(input = {}) {
  const source = ensureObject(input);
  const pageUrl = resolveAbsoluteUrl(source.page_url || source.pageUrl || source.paper_url || source.paperUrl || '');
  const pageHtml = defaultCleanText(source.page_html || source.pageHtml, 400000);
  const message = defaultCleanText(source.message, 12000);

  const candidates = dedupeCandidateUrls([
    { url: resolveAbsoluteUrl(source.paper_pdf_url || source.paperPdfUrl || '', pageUrl), source: 'paper_pdf_url' },
    { url: resolveAbsoluteUrl(source.pdf_url || source.pdfUrl || '', pageUrl), source: 'pdf_url' },
    { url: resolveAbsoluteUrl(source.url || '', pageUrl), source: 'url' },
    { url: pageUrl, source: 'page_url' },
    ...defaultAsArray(source.candidate_urls).map((url) => ({ url: resolveAbsoluteUrl(url, pageUrl), source: 'candidate_urls' })),
    ...defaultAsArray(source.pdf_urls).map((url) => ({ url: resolveAbsoluteUrl(url, pageUrl), source: 'pdf_urls' })),
    ...extractUrlsFromText(message, pageUrl).map((url) => ({ url, source: 'message' })),
    ...extractUrlsFromHtml(pageHtml, pageUrl).map((url) => ({ url, source: 'page_html' }))
  ]);

  const pdfCandidates = candidates
    .filter((entry) => entry.source === 'paper_pdf_url' || entry.source === 'pdf_url' || looksLikePdfUrl(entry.url))
    .map((entry) => ({
      ...entry,
      score: scoreCandidateUrl(entry)
    }))
    .sort((left, right) => right.score - left.score);

  const selectedPdfUrl = pdfCandidates[0]?.url || '';
  const browserEntryUrl = pageUrl || selectedPdfUrl || candidates[0]?.url || '';
  return {
    ok: true,
    selected_pdf_url: selectedPdfUrl,
    browser_entry_url: browserEntryUrl,
    candidate_pdf_urls: pdfCandidates.map((entry) => entry.url),
    candidate_urls: candidates.map((entry) => entry.url),
    requires_browser_session: !selectedPdfUrl && Boolean(browserEntryUrl),
    summary: selectedPdfUrl
      ? `Resolved ${pdfCandidates.length} PDF candidate URL${pdfCandidates.length === 1 ? '' : 's'}.`
      : (browserEntryUrl
        ? 'No direct PDF URL was found; a browser-assisted download may be required.'
        : 'No paper download URL was found.')
  };
}

function parseContentDispositionFileName(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const utf8Match = text.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = text.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ? plainMatch[1] : '';
}

function inferPdfFileName(input = {}, responseUrl = '', headers = null) {
  const source = ensureObject(input);
  const directName = defaultCleanText(source.file_name || source.fileName || source.paper_file_name || source.paperFileName, 240);
  if (directName) {
    return ensurePdfFileName(directName);
  }

  const contentDisposition = typeof headers?.get === 'function'
    ? parseContentDispositionFileName(headers.get('content-disposition'))
    : '';
  if (contentDisposition) {
    return ensurePdfFileName(contentDisposition);
  }

  const title = defaultCleanText(source.paper_title || source.paperTitle || source.title, 240);
  if (title) {
    return ensurePdfFileName(`${title}.pdf`);
  }

  try {
    const parsed = new URL(responseUrl || source.paper_pdf_url || source.pdf_url || source.page_url || '');
    const baseName = path.basename(parsed.pathname || '') || 'paper.pdf';
    return ensurePdfFileName(baseName);
  } catch {
    return 'paper.pdf';
  }
}

function normalizeHeadersObject(headers) {
  const source = ensureObject(headers);
  const normalized = {};
  Object.entries(source).forEach(([key, value]) => {
    const name = defaultCleanText(key, 120);
    const headerValue = defaultCleanText(value, 2000);
    if (name && headerValue) {
      normalized[name] = headerValue;
    }
  });
  return normalized;
}

function createDownloadError(message, extra = {}) {
  const error = new Error(defaultCleanText(message, 1200) || 'Paper download failed.');
  Object.assign(error, extra);
  return error;
}

function isExplicitFalse(value) {
  return value === false || String(value || '').trim().toLowerCase() === 'false';
}

function bufferLooksLikePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    return false;
  }
  return buffer.subarray(0, 5).toString('utf8') === '%PDF-';
}

async function readResponseText(response) {
  if (typeof response?.text === 'function') {
    return String(await response.text());
  }
  if (typeof response?.arrayBuffer === 'function') {
    return Buffer.from(await response.arrayBuffer()).toString('utf8');
  }
  if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of response.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  return '';
}

async function readResponseBuffer(response, onChunk) {
  if (Buffer.isBuffer(response?.body)) {
    const chunk = response.body;
    await onChunk(chunk);
    return chunk;
  }

  if (typeof response?.arrayBuffer === 'function' && !response?.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    await onChunk(buffer);
    return buffer;
  }

  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      chunks.push(chunk);
      await onChunk(chunk);
    }
    return Buffer.concat(chunks);
  }

  if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const value of response.body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      chunks.push(chunk);
      await onChunk(chunk);
    }
    return Buffer.concat(chunks);
  }

  if (typeof response?.arrayBuffer === 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    await onChunk(buffer);
    return buffer;
  }

  throw createDownloadError('Response body was not readable.');
}

function buildRelativePath(rootPath, targetPath) {
  return path.relative(path.resolve(rootPath), path.resolve(targetPath)).split(path.sep).join('/');
}

function createPaperDownloadRuntime(deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
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
  const BrowserWindow = typeof deps.BrowserWindow === 'function'
    ? deps.BrowserWindow
    : (typeof deps.electron?.BrowserWindow === 'function' ? deps.electron.BrowserWindow : null);

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

    const linkedName = cleanText(source.linked_name || source.linkedName, 220);
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

  async function startDefaultBrowserDownloadSession(options = {}) {
    if (providedBrowserSession) {
      return providedBrowserSession(options);
    }
    if (!BrowserWindow) {
      throw createDownloadError('Automated download was blocked and no browser download session is configured.', {
        retry_with_browser: true,
        browser_required: true
      });
    }

    const {
      downloadId,
      browserEntryUrl,
      selectedPdfUrl,
      targetFilePath,
      storagePath,
      simulateOneClick,
      timeoutMs,
      updateProgress
    } = options;

    const sessionId = `paper-browser-${downloadId}`;
    const browserWindow = new BrowserWindow({
      width: 1220,
      height: 900,
      autoHideMenuBar: true,
      show: true,
      title: 'Paper Download',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: sessionId
      }
    });

    return new Promise(async (resolve) => {
      let settled = false;
      const webContents = browserWindow.webContents;
      const sessionObject = webContents?.session;

      async function finalize(result) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        try {
          if (sessionObject?.removeListener && willDownloadListener) {
            sessionObject.removeListener('will-download', willDownloadListener);
          }
        } catch {
          // Ignore listener cleanup errors.
        }
        try {
          if (!browserWindow.isDestroyed()) {
            browserWindow.close();
          }
        } catch {
          // Ignore window cleanup errors.
        }
        if (sessionId && terminateBrowserDownloadSession) {
          await Promise.resolve(terminateBrowserDownloadSession({
            session_id: sessionId,
            download_id: downloadId
          })).catch(() => {});
        }
        resolve(result);
      }

      const timer = setTimeout(() => {
        finalize({
          ok: false,
          session_id: sessionId,
          error: 'Browser download timed out before completion.'
        });
      }, Math.max(5000, Number(timeoutMs) || 60000));

      let willDownloadListener = null;
      willDownloadListener = (_event, item) => {
        try {
          if (typeof item?.setSavePath === 'function') {
            item.setSavePath(targetFilePath);
          }
        } catch {
          // Ignore save-path assignment failure.
        }
        updateProgress({
          status: 'browser_downloading',
          method: 'browser',
          browser_session_active: true,
          browser_session_id: sessionId,
          total_bytes: Number(item?.getTotalBytes?.()) || 0,
          received_bytes: Number(item?.getReceivedBytes?.()) || 0
        });

        item?.on?.('updated', () => {
          updateProgress({
            status: 'browser_downloading',
            method: 'browser',
            browser_session_active: true,
            browser_session_id: sessionId,
            total_bytes: Number(item?.getTotalBytes?.()) || 0,
            received_bytes: Number(item?.getReceivedBytes?.()) || 0
          });
        });

        item?.once?.('done', async (_doneEvent, state) => {
          if (state === 'completed') {
            const receivedBytes = Number(item?.getReceivedBytes?.()) || 0;
            const totalBytes = Number(item?.getTotalBytes?.()) || receivedBytes;
            await finalize({
              ok: true,
              session_id: sessionId,
              file_path: targetFilePath,
              file_name: path.basename(targetFilePath),
              relative_path: buildRelativePath(storagePath, targetFilePath),
              received_bytes: receivedBytes,
              total_bytes: totalBytes,
              summary: 'Paper downloaded through the browser session.'
            });
            return;
          }
          await finalize({
            ok: false,
            session_id: sessionId,
            error: `Browser download ${state || 'failed'}.`
          });
        });
      };

      sessionObject?.on?.('will-download', willDownloadListener);
      browserWindow.on('closed', () => {
        finalize({
          ok: false,
          session_id: sessionId,
          error: 'Browser session closed before download completed.'
        });
      });

      try {
        await browserWindow.loadURL(browserEntryUrl || selectedPdfUrl || 'about:blank');
        updateProgress({
          status: 'awaiting_browser_click',
          method: 'browser',
          browser_session_active: true,
          browser_session_id: sessionId
        });
        if (simulateOneClick && selectedPdfUrl && typeof webContents?.downloadURL === 'function') {
          webContents.downloadURL(selectedPdfUrl);
        }
      } catch (error) {
        await finalize({
          ok: false,
          session_id: sessionId,
          error: cleanText(error?.message, 600) || 'Failed to open browser session for paper download.'
        });
      }
    });
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
        return await performDirectDownload({
          input,
          extraction,
          target,
          downloadId
        });
      }
      if (extraction.browser_entry_url) {
        return await performBrowserFallback({
          input,
          extraction,
          target,
          downloadId
        });
      }
      throw createDownloadError('No paper download URL was found.');
    } catch (error) {
      const shouldUseBrowser = error?.retry_with_browser === true
        || error?.browser_required === true
        || (!extraction.selected_pdf_url && Boolean(extraction.browser_entry_url));
      if (shouldUseBrowser && !isExplicitFalse(ensureObject(input).use_browser_fallback) && extraction.browser_entry_url) {
        try {
          return await performBrowserFallback({
            input,
            extraction,
            target,
            downloadId
          });
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
      linked_name: cleanText(source.linked_name || source.linkedName, 220),
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
