// Canonical normalizers for JSON-shaped values arriving from storage, the
// hikariApi bridge, or agent tool output. These three bodies were duplicated
// verbatim across renderer modules before being collected here.
//
// The main process keeps its own CommonJS copy at src/main/lib/normalize.js —
// src/main is CommonJS and src/renderer is ESM, so one module cannot serve
// both without a dual-format shim. Keep the two in sync by hand; they are
// twelve lines each.

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// Callers previously split between `fallback` (undefined on failure) and
// `fallback = null`; null won because it is representable in JSON.
export function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}
