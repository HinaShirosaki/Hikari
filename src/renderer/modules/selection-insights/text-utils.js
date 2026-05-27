import { ACTION_WHERE_TO_BUY } from './constants.js';

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function cleanText(value, maxLength = 4000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

export function cloneJson(value, fallback) {
  try {
    if (value == null) {
      return fallback;
    }
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

export function sanitizeFolderName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function isElementNode(value) {
  const ElementCtor = globalThis.Element;
  return Boolean(ElementCtor && value instanceof ElementCtor);
}

export function escapeAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatAnswerText(value) {
  return cleanText(value, 12000)
    .split(/\n{2,}/)
    .map((part) => cleanText(part, 4000))
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

export function normalizeActionLabel(actionType) {
  if (actionType === ACTION_WHERE_TO_BUY) {
    return 'Where to buy it';
  }
  return 'What is it';
}
