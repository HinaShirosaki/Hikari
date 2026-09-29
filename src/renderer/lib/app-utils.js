import { escapeHtml } from './html.js';

export function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const safeText = escapeHtml;

// Escapes only quotes and backslashes, for values inside a quoted attribute
// selector like [data-id="..."]. Not a general CSS.escape replacement.
export function cssEscape(value) {
  return String(value).replace(/(["\\])/g, '\\$1');
}
