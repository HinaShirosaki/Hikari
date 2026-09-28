'use strict';

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, number) => String.fromCodePoint(Number(number)));
}

function stripHtml(value) {
  return decodeXmlEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function safeUrl(value, baseUrl = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    return new URL(raw, baseUrl || undefined).toString();
  } catch {
    return '';
  }
}

function safeHttpUrl(value, baseUrl = '') {
  const normalized = safeUrl(value, baseUrl);
  if (!normalized) {
    return '';
  }
  const protocol = new URL(normalized).protocol;
  return protocol === 'http:' || protocol === 'https:' ? normalized : '';
}

function extractSourceDomain(value) {
  const normalized = safeUrl(value);
  if (!normalized) {
    return '';
  }
  try {
    return String(new URL(normalized).hostname || '').toLowerCase();
  } catch {
    return '';
  }
}

async function readResponseText(response) {
  if (typeof response?.text === 'function') {
    return String(await response.text());
  }
  if (typeof response?.json === 'function') {
    return JSON.stringify(await response.json());
  }
  if (typeof response?.arrayBuffer === 'function') {
    return Buffer.from(await response.arrayBuffer()).toString('utf8');
  }
  if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of response.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  return '';
}

module.exports = {
  decodeXmlEntities,
  extractSourceDomain,
  readResponseText,
  safeHttpUrl,
  safeUrl,
  stripHtml
};
