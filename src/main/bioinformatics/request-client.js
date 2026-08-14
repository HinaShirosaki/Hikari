'use strict';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const DEFAULT_USER_AGENT = 'Hikari/1.0';

class BioinformaticsServiceError extends Error {
  constructor(message, options = {}) {
    super(String(message || 'Bioinformatics request failed.'));
    this.name = 'BioinformaticsServiceError';
    this.code = String(options.code || 'BIOINFORMATICS_ERROR');
    this.status = options.status !== null
      && options.status !== undefined
      && Number.isFinite(Number(options.status))
      ? Number(options.status)
      : null;
    this.retryAfterMs = options.retryAfterMs !== null
      && options.retryAfterMs !== undefined
      && Number.isFinite(Number(options.retryAfterMs))
      ? Math.max(0, Number(options.retryAfterMs))
      : null;
  }
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanText(value, maxLength = 2400) {
  const text = String(value ?? '').trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function responseHeader(response, name) {
  return cleanText(response?.headers?.get?.(name), 4000);
}

// NCBI streams BLAST results chunked with no content-length, so the declared-length
// pre-check cannot be the only guard. Consume the body a chunk at a time and bail as
// soon as the cap is passed, rather than buffering the whole payload in the main
// process and measuring it afterwards. `makeError` also aborts the in-flight request.
async function readBoundedBody(response, maxResponseBytes, makeError) {
  const body = response?.body;
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let total = 0;
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxResponseBytes) {
        throw makeError();
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  // Stub/polyfill responses with no readable body: measure after the fact.
  const text = typeof response?.text === 'function'
    ? String(await response.text())
    : JSON.stringify(await response?.json?.() || {});
  if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) {
    throw makeError();
  }
  return text;
}

function parseRetryAfterMs(response, now = () => Date.now()) {
  const value = responseHeader(response, 'retry-after');
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now()) : null;
}

function summarizeResponseBody(value) {
  return cleanText(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), 320);
}

function createBioinformaticsRequestClient(deps = {}) {
  const fetchImpl = typeof deps.fetch === 'function'
    ? deps.fetch
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const timeoutMs = clampInteger(deps.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 120_000);
  const maxResponseBytes = clampInteger(
    deps.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    1024,
    100 * 1024 * 1024
  );
  const userAgent = cleanText(deps.userAgent || DEFAULT_USER_AGENT, 160);
  const now = typeof deps.now === 'function' ? deps.now : (() => Date.now());
  const activeControllers = new Set();
  let stopped = false;

  async function requestText(url, options = {}, sourceName = 'Bioinformatics') {
    if (stopped) {
      throw new BioinformaticsServiceError('The bioinformatics service has stopped.', {
        code: 'SERVICE_STOPPED'
      });
    }
    if (typeof fetchImpl !== 'function') {
      throw new BioinformaticsServiceError('Fetch is unavailable in this Electron runtime.', {
        code: 'FETCH_UNAVAILABLE'
      });
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) {
      activeControllers.add(controller);
    }
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    timeout?.unref?.();

    try {
      const response = await fetchImpl(url, {
        ...options,
        headers: {
          'User-Agent': userAgent,
          ...(ensureObject(options.headers))
        },
        signal: controller?.signal
      });
      const declaredLength = Number(responseHeader(response, 'content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        throw new BioinformaticsServiceError(`${sourceName} response is too large.`, {
          code: 'RESPONSE_TOO_LARGE',
          status: response?.status
        });
      }
      const text = await readBoundedBody(response, maxResponseBytes, () => {
        controller?.abort();
        return new BioinformaticsServiceError(`${sourceName} response is too large.`, {
          code: 'RESPONSE_TOO_LARGE',
          status: response?.status
        });
      });
      if (response?.ok === false || Number(response?.status) >= 400) {
        const retryAfterMs = parseRetryAfterMs(response, now);
        const detail = summarizeResponseBody(text);
        throw new BioinformaticsServiceError(
          `${sourceName} request failed with HTTP ${Number(response?.status) || 'unknown'}${detail ? `: ${detail}` : '.'}`,
          {
            code: 'REMOTE_HTTP_ERROR',
            status: response?.status,
            retryAfterMs
          }
        );
      }
      return { response, text };
    } catch (error) {
      if (error instanceof BioinformaticsServiceError) {
        throw error;
      }
      const timedOut = error?.name === 'AbortError';
      throw new BioinformaticsServiceError(
        timedOut ? `${sourceName} request timed out.` : `${sourceName} request failed: ${cleanText(error?.message || error, 600)}`,
        { code: timedOut ? 'REQUEST_TIMEOUT' : 'REMOTE_REQUEST_FAILED' }
      );
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (controller) {
        activeControllers.delete(controller);
      }
    }
  }

  function stop() {
    stopped = true;
    activeControllers.forEach((controller) => controller.abort());
    activeControllers.clear();
  }

  return { requestText, stop };
}

module.exports = {
  BioinformaticsServiceError,
  clampInteger,
  cleanText,
  createBioinformaticsRequestClient,
  ensureObject,
  responseHeader
};
