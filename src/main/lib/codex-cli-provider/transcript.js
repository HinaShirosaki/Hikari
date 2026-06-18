'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  getCodexCliCandidateHomeDirectories,
  resolveCodexCliRuntimeHomeDirectory
} = require('./paths');
const {
  buildCodexDisplayEventFromProgress,
  emitCodexCliDisplayEvent
} = require('./event-display');
const { extractCodexJsonEventText } = require('./event-text');
const {
  buildCodexProgressEventKey,
  extractCodexJsonEventProgress
} = require('./event-progress');
const { normalizeCodexSessionId } = require('./session-id');
const { safeParseJson } = require('./utils');

function readTranscriptTimestampMs(event = {}) {
  const rawTimestamp = String(event?.timestamp || event?.payload?.timestamp || '').trim();
  if (!rawTimestamp) {
    return 0;
  }
  const timestampMs = Date.parse(rawTimestamp);
  return Number.isFinite(timestampMs) ? timestampMs : 0;
}

async function findCodexSessionTranscriptPath(sessionId = '', cwd = '') {
  const cleanSessionId = normalizeCodexSessionId(sessionId);
  if (!cleanSessionId) {
    return '';
  }
  const roots = [...new Set([
    resolveCodexCliRuntimeHomeDirectory(cwd),
    ...getCodexCliCandidateHomeDirectories()
  ].map((value) => String(value || '').trim()).filter(Boolean))];
  const queue = roots.map((root) => path.join(root, 'sessions'));
  let visited = 0;
  while (queue.length && visited < 4000) {
    const current = queue.shift();
    visited += 1;
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes(cleanSessionId)) {
        return entryPath;
      }
    }
  }
  return '';
}

async function replayCodexSessionProgressFromTranscript({
  sessionId = '',
  cwd = '',
  onStream = null,
  seenProgressEvents = new Set(),
  seenDisplayEvents = new Set()
} = {}) {
  if (!sessionId || typeof onStream !== 'function') {
    return '';
  }
  const transcriptPath = await findCodexSessionTranscriptPath(sessionId, cwd);
  if (!transcriptPath) {
    return '';
  }
  let raw = '';
  try {
    raw = await fs.readFile(transcriptPath, 'utf8');
  } catch {
    return '';
  }
  raw.split(/\r?\n/u).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const parsed = safeParseJson(trimmed, null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return;
    }
    const extracted = extractCodexJsonEventText(parsed);
    if (extracted) {
      emitCodexCliDisplayEvent(onStream, seenDisplayEvents, {
        text: extracted.deltaText || extracted.fullText,
        kind: 'assistant',
        eventType: extracted.eventType
      });
    }
    extractCodexJsonEventProgress(parsed).forEach((progressEvent) => {
      const key = buildCodexProgressEventKey(progressEvent);
      if (key && seenProgressEvents.has(key)) {
        return;
      }
      if (key) {
        seenProgressEvents.add(key);
      }
      try {
        onStream(progressEvent);
      } catch {
        // Transcript replay is best-effort; the final Codex response still resolves below.
      }
      emitCodexCliDisplayEvent(
        onStream,
        seenDisplayEvents,
        buildCodexDisplayEventFromProgress(progressEvent)
      );
    });
  });
  return transcriptPath;
}

function createCodexSessionTranscriptFollower({
  cwd = '',
  getSessionId = null,
  onJsonEvent = null,
  minTimestampMs = Date.now() - 2000,
  intervalMs = 250
} = {}) {
  if (typeof getSessionId !== 'function' || typeof onJsonEvent !== 'function') {
    return {
      stop: async () => {}
    };
  }

  let transcriptPath = '';
  let readOffset = 0;
  let stopped = false;
  let ticking = false;
  let bufferedLine = '';
  let completedInitialRead = false;

  async function tick() {
    if (stopped || ticking) {
      return;
    }
    ticking = true;
    try {
      const sessionId = normalizeCodexSessionId(getSessionId());
      if (!sessionId) {
        return;
      }
      if (!transcriptPath) {
        transcriptPath = await findCodexSessionTranscriptPath(sessionId, cwd);
        if (!transcriptPath) {
          return;
        }
      }
      const stat = await fs.stat(transcriptPath).catch(() => null);
      if (!stat || !Number.isFinite(Number(stat.size)) || Number(stat.size) <= readOffset) {
        return;
      }
      const file = await fs.open(transcriptPath, 'r');
      try {
        const length = Number(stat.size) - readOffset;
        const buffer = Buffer.alloc(length);
        await file.read(buffer, 0, length, readOffset);
        readOffset = Number(stat.size);
        consumeTranscriptChunk(buffer.toString('utf8'), { initialRead: !completedInitialRead });
        completedInitialRead = true;
      } finally {
        await file.close().catch(() => {});
      }
    } finally {
      ticking = false;
    }
  }

  function consumeTranscriptChunk(chunkText = '', { initialRead = false } = {}) {
    const combined = `${bufferedLine}${String(chunkText || '')}`;
    const lines = combined.split(/\r?\n/u);
    bufferedLine = lines.pop() || '';
    lines.forEach((line) => emitTranscriptLine(line, { initialRead }));
  }

  function emitTranscriptLine(line = '', { initialRead = false } = {}) {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      return;
    }
    const parsed = safeParseJson(trimmed, null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return;
    }
    const timestampMs = readTranscriptTimestampMs(parsed);
    if (timestampMs && timestampMs < minTimestampMs) {
      return;
    }
    if (!timestampMs && initialRead) {
      return;
    }
    try {
      onJsonEvent(parsed);
    } catch {
      // Live transcript following is best-effort; stdout and final replay still run.
    }
  }

  const interval = setInterval(() => {
    void tick();
  }, Math.max(50, Number(intervalMs) || 250));
  void tick();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(interval);
      await tick();
    }
  };
}

module.exports = {
  createCodexSessionTranscriptFollower,
  findCodexSessionTranscriptPath,
  replayCodexSessionProgressFromTranscript
};
