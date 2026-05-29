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

module.exports = {
  findCodexSessionTranscriptPath,
  replayCodexSessionProgressFromTranscript
};
