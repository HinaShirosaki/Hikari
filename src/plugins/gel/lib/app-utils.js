import { escapeHtml } from './html.js';

export function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const safeText = escapeHtml;

export function cssEscape(value) {
  return String(value).replace(/(["\\])/g, '\\$1');
}
