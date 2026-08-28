'use strict';

// Normalize unknown input into a string without trimming or clipping chat fields.
function cleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

// Deep-clone JSON-safe values so stored payloads are detached from live objects.

// Convert arbitrary session identifiers into safe file-name fragments.
function sanitizeFileName(value, fallback = 'chat-session') {
  const clean = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return clean || fallback;
}

// Generate a lightweight unique identifier for chat sessions and messages.
function createDefaultId() {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Use the first non-empty line of user text as a human-friendly session title.
function deriveSessionTitle(text, fallback = 'New Chat') {
  const firstLine = cleanText(String(text || '').split('\n').find((line) => String(line || '').trim()) || '');
  return firstLine || fallback;
}

function normalizeSessionBrief(text, fallback = 'New Chat') {
  const normalized = cleanText(String(text || '').replace(/\s+/g, ' '))
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.!?;,:\s]+$/g, '')
    .trim();
  return normalized || fallback;
}

function slugText(value, fallback = 'option') {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

module.exports = {
  cleanText,
  sanitizeFileName,
  createDefaultId,
  deriveSessionTitle,
  normalizeSessionBrief,
  slugText
};
