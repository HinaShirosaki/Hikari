'use strict';

// Canonical normalizers for JSON-shaped values arriving from disk, IPC, tool
// output, or model responses. These three bodies were duplicated verbatim
// across main-process modules before being collected here.
//
// The renderer keeps its own ESM copy at src/renderer/lib/normalize.js —
// src/main is CommonJS and src/renderer is ESM, so one module cannot serve
// both without a dual-format shim. Keep the two in sync by hand; they are
// twelve lines each.

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// Callers previously split between `fallback` (undefined on failure) and
// `fallback = null`; null won because it is representable in JSON.
function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

module.exports = { asArray, ensureObject, cloneJson };
