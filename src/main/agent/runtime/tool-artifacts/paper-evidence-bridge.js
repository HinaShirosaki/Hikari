'use strict';

// The model's exec/wait output can be truncated. Deliver the app-owned evidence
// directly to its active chat request, before that model-facing serialization.
const listeners = new Map();

function subscribePaperEvidence(requestId, listener) {
  const key = String(requestId || '').trim();
  if (!key || typeof listener !== 'function') return () => {};
  listeners.set(key, listener);
  return () => { if (listeners.get(key) === listener) listeners.delete(key); };
}

function publishPaperEvidence(requestId, blocks) {
  const listener = listeners.get(String(requestId || '').trim());
  if (!listener || !blocks?.length) return false;
  try { listener(blocks); return true; } catch { return false; }
}

module.exports = { subscribePaperEvidence, publishPaperEvidence };
