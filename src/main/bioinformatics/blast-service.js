'use strict';

const {
  BioinformaticsServiceError,
  clampInteger,
  cleanText,
  ensureObject,
  responseHeader
} = require('./request-client');

const BLAST_ENDPOINT = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi';
const BLAST_PROGRAMS = Object.freeze(['blastn', 'blastp', 'blastx', 'tblastn', 'tblastx']);
const BLAST_FORMATS = Object.freeze({
  json: { apiName: 'JSON2_S', contentType: 'application/json' },
  xml: { apiName: 'XML2_S', contentType: 'application/xml' },
  text: { apiName: 'Text', contentType: 'text/plain' }
});
const MAX_QUERY_LENGTH = 1_000_000;
const DEFAULT_REQUEST_SPACING_MS = 10_000;
const DEFAULT_RID_POLL_INTERVAL_MS = 60_000;

function positiveNumber(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function validateEmail(value) {
  const email = cleanText(value, 254);
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function validateRid(value) {
  const rid = cleanText(value, 120);
  if (!/^[A-Za-z0-9_-]{4,120}$/.test(rid)) {
    throw new BioinformaticsServiceError('A valid NCBI BLAST RID is required.', {
      code: 'INVALID_BLAST_RID'
    });
  }
  return rid;
}

function parseBlastSubmission(text) {
  const rid = cleanText(String(text || '').match(/\bRID\s*=\s*([^\s<]+)/i)?.[1], 120);
  const estimatedSeconds = Number.parseInt(
    String(text || '').match(/\bRTOE\s*=\s*(\d+)/i)?.[1] || '',
    10
  );
  if (!rid) {
    const message = cleanText(String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), 320);
    throw new BioinformaticsServiceError(
      `NCBI BLAST did not return a request identifier${message ? `: ${message}` : '.'}`,
      { code: 'BLAST_SUBMISSION_REJECTED' }
    );
  }
  return {
    rid,
    estimatedSeconds: Number.isFinite(estimatedSeconds) && estimatedSeconds >= 0
      ? estimatedSeconds
      : null
  };
}

function parseBlastStatus(text, rid) {
  const rawState = cleanText(String(text || '').match(/\bStatus\s*=\s*([A-Za-z]+)/i)?.[1], 40)
    .toLowerCase();
  const stateMap = {
    waiting: 'waiting',
    ready: 'ready',
    failed: 'failed',
    unknown: 'unknown'
  };
  if (!stateMap[rawState]) {
    throw new BioinformaticsServiceError('NCBI BLAST returned an unreadable job status.', {
      code: 'BLAST_STATUS_INVALID'
    });
  }
  const hitText = cleanText(
    String(text || '').match(/\bThereAreHits\s*=\s*([A-Za-z]+)/i)?.[1],
    20
  ).toLowerCase();
  return {
    rid,
    state: stateMap[rawState],
    hasHits: hitText === 'yes' ? true : (hitText === 'no' ? false : null),
    cached: false,
    retryAfterMs: stateMap[rawState] === 'waiting' ? DEFAULT_RID_POLL_INTERVAL_MS : 0
  };
}

function createBlastService(deps = {}) {
  if (typeof deps.requestText !== 'function') {
    throw new Error('createBlastService requires requestText.');
  }
  const requestText = deps.requestText;
  const now = typeof deps.now === 'function' ? deps.now : (() => Date.now());
  const delay = typeof deps.delay === 'function'
    ? deps.delay
    : ((duration) => new Promise((resolve) => setTimeout(resolve, duration)));
  const defaultNcbiEmail = validateEmail(deps.defaultNcbiEmail);
  const toolName = cleanText(deps.toolName || 'Hikari', 80) || 'Hikari';
  const requestSpacingMs = clampInteger(
    deps.requestSpacingMs,
    DEFAULT_REQUEST_SPACING_MS,
    0,
    60_000
  );
  const ridPollIntervalMs = clampInteger(
    deps.ridPollIntervalMs,
    DEFAULT_RID_POLL_INTERVAL_MS,
    1000,
    10 * 60_000
  );
  const jobs = new Map();
  let lastBlastRequestAt = null;
  let requestQueue = Promise.resolve();

  function scheduleBlastRequest(work) {
    const scheduled = requestQueue.then(async () => {
      if (lastBlastRequestAt !== null) {
        const remaining = requestSpacingMs - (now() - lastBlastRequestAt);
        if (remaining > 0) {
          await delay(remaining);
        }
      }
      try {
        return await work();
      } finally {
        lastBlastRequestAt = now();
      }
    });
    requestQueue = scheduled.catch(() => {});
    return scheduled;
  }

  async function submitBlast(payload = {}) {
    const input = ensureObject(payload);
    const query = cleanText(input.query ?? input.sequence, MAX_QUERY_LENGTH + 1);
    if (!query || query.length > MAX_QUERY_LENGTH) {
      throw new BioinformaticsServiceError(
        `BLAST query must contain between 1 and ${MAX_QUERY_LENGTH.toLocaleString()} characters.`,
        { code: 'INVALID_BLAST_QUERY' }
      );
    }
    const program = cleanText(input.program || 'blastn', 20).toLowerCase();
    if (!BLAST_PROGRAMS.includes(program)) {
      throw new BioinformaticsServiceError(`Unsupported BLAST program: ${program || '(empty)'}.`, {
        code: 'INVALID_BLAST_PROGRAM'
      });
    }
    const database = cleanText(input.database || (program === 'blastn' ? 'core_nt' : 'nr'), 80);
    if (!/^[A-Za-z0-9_.:-]+$/.test(database)) {
      throw new BioinformaticsServiceError('BLAST database contains unsupported characters.', {
        code: 'INVALID_BLAST_DATABASE'
      });
    }
    const email = validateEmail(input.email) || defaultNcbiEmail;
    if (!email) {
      throw new BioinformaticsServiceError(
        'A contact email is required for NCBI BLAST requests. Pass email or set HIKARI_NCBI_EMAIL.',
        { code: 'BLAST_EMAIL_REQUIRED' }
      );
    }

    const form = new URLSearchParams({
      CMD: 'Put',
      QUERY: query,
      PROGRAM: program,
      DATABASE: database,
      EXPECT: String(positiveNumber(input.expect, 10, 1e9)),
      HITLIST_SIZE: String(clampInteger(input.hitlistSize, 50, 1, 100)),
      SHORT_QUERY_ADJUST: input.shortQueryAdjust === true ? 'true' : 'false',
      TOOL: toolName,
      EMAIL: email
    });
    if (program === 'blastn' && input.megablast === true) {
      form.set('MEGABLAST', 'on');
    }

    const { text } = await scheduleBlastRequest(() => requestText(BLAST_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'text/plain, text/html;q=0.9',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: form.toString()
    }, 'NCBI BLAST'));
    const parsed = parseBlastSubmission(text);
    const submittedAt = now();
    const earliestPollAt = submittedAt + Math.max(
      ridPollIntervalMs,
      (parsed.estimatedSeconds || 0) * 1000
    );
    const job = {
      ...parsed,
      program,
      database,
      submittedAt,
      earliestPollAt,
      state: 'waiting'
    };
    jobs.set(parsed.rid, job);
    return { ...job };
  }

  async function getBlastStatus(payload = {}) {
    const rid = validateRid(ensureObject(payload).rid ?? payload);
    const known = jobs.get(rid) || null;
    const currentTime = now();
    if (known?.state === 'waiting' && currentTime < known.earliestPollAt) {
      return {
        rid,
        state: 'waiting',
        hasHits: null,
        cached: true,
        retryAfterMs: known.earliestPollAt - currentTime
      };
    }

    const url = new URL(BLAST_ENDPOINT);
    url.search = new URLSearchParams({
      CMD: 'Get',
      RID: rid,
      FORMAT_OBJECT: 'SearchInfo'
    }).toString();
    const { text } = await scheduleBlastRequest(() => requestText(url.toString(), {
      method: 'GET',
      headers: { Accept: 'text/plain, text/html;q=0.9' }
    }, 'NCBI BLAST'));
    const status = parseBlastStatus(text, rid);
    status.retryAfterMs = status.state === 'waiting' ? ridPollIntervalMs : 0;
    jobs.set(rid, {
      ...(known || { rid }),
      state: status.state,
      hasHits: status.hasHits,
      earliestPollAt: now() + status.retryAfterMs
    });
    return status;
  }

  async function getBlastResults(payload = {}) {
    const input = ensureObject(payload);
    const rid = validateRid(input.rid ?? payload);
    const format = cleanText(input.format || 'json', 20).toLowerCase();
    const formatConfig = BLAST_FORMATS[format];
    if (!formatConfig) {
      throw new BioinformaticsServiceError('BLAST result format must be json, xml, or text.', {
        code: 'INVALID_BLAST_FORMAT'
      });
    }
    const known = jobs.get(rid) || null;
    if (known?.state === 'waiting' && now() < known.earliestPollAt) {
      throw new BioinformaticsServiceError('BLAST results are not ready yet.', {
        code: 'BLAST_NOT_READY',
        retryAfterMs: known.earliestPollAt - now()
      });
    }

    const url = new URL(BLAST_ENDPOINT);
    url.search = new URLSearchParams({
      CMD: 'Get',
      RID: rid,
      FORMAT_TYPE: formatConfig.apiName
    }).toString();
    const { response, text } = await scheduleBlastRequest(() => requestText(url.toString(), {
      method: 'GET',
      headers: { Accept: `${formatConfig.contentType}, text/plain;q=0.8` }
    }, 'NCBI BLAST'));
    if (/\bStatus\s*=\s*WAITING\b/i.test(text)) {
      jobs.set(rid, {
        ...(known || { rid }),
        state: 'waiting',
        hasHits: null,
        earliestPollAt: now() + ridPollIntervalMs
      });
      throw new BioinformaticsServiceError('BLAST results are not ready yet.', {
        code: 'BLAST_NOT_READY',
        retryAfterMs: ridPollIntervalMs
      });
    }
    if (/\bStatus\s*=\s*(FAILED|UNKNOWN)\b/i.test(text)) {
      jobs.set(rid, {
        ...(known || { rid }),
        state: /\bFAILED\b/i.test(text) ? 'failed' : 'unknown',
        earliestPollAt: 0
      });
      throw new BioinformaticsServiceError('NCBI BLAST could not return results for that RID.', {
        code: 'BLAST_RESULTS_UNAVAILABLE'
      });
    }

    let data = text;
    if (format === 'json') {
      try {
        data = JSON.parse(text);
      } catch {
        throw new BioinformaticsServiceError('NCBI BLAST returned invalid JSON results.', {
          code: 'BLAST_RESULT_PARSE_FAILED'
        });
      }
    }
    jobs.set(rid, { ...(known || { rid }), state: 'ready', earliestPollAt: 0 });
    return {
      rid,
      format,
      contentType: responseHeader(response, 'content-type') || formatConfig.contentType,
      data,
      retrievedAt: now()
    };
  }

  return { submitBlast, getBlastStatus, getBlastResults };
}

module.exports = {
  BLAST_ENDPOINT,
  BLAST_PROGRAMS,
  createBlastService,
  parseBlastStatus,
  parseBlastSubmission
};
