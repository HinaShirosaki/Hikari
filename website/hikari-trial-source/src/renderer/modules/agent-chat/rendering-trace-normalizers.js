import { asArray, trimText } from './shared.js';

function normalizeTraceComparableText(value = '') {
  return trimText(value, 2000)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isInternalCodexPromptText(value = '') {
  return /^#\s*Hikari Codex Chat Turn\b/u.test(trimText(value, 200));
}

export function filterGeneratedTraceRows(rows = [], finalText = '') {
  const seen = new Set();
  const finalKey = normalizeTraceComparableText(finalText);
  return asArray(rows)
    .map((row) => trimText(row, 1200))
    .filter((row) => {
      if (!row || isInternalCodexPromptText(row)) {
        return false;
      }
      const key = normalizeTraceComparableText(row);
      if (!key || key === finalKey || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

export function normalizeThinkingTraceRows(rows) {
  const seen = new Set();
  return asArray(rows)
    .map((row) => trimText(row?.text || row, 420))
    .filter((row) => {
      if (!row) {
        return false;
      }
      const key = row.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 32);
}

export function normalizeActivityTraceRows(rows) {
  const seen = new Set();
  return asArray(rows)
    .map((row) => {
      const source = row && typeof row === 'object' ? row : { text: row };
      const text = trimText(source.text, 420);
      if (!text) {
        return '';
      }
      const routingIntent = trimText(source.routing_intent || source.routingIntent, 120);
      if (routingIntent && routingIntent !== 'codex_agent') {
        return '';
      }
      const stage = trimText(source.stage, 80);
      if (stage && ![
        'codex_agent_started',
        'codex_agent_completed',
        'tool_call_started',
        'tool_call_completed',
        'tool_call_failed'
      ].includes(stage)) {
        return '';
      }
      if (text === 'Request received') {
        return '';
      }
      const status = trimText(source.status, 40).toLowerCase();
      if (status === 'failed') {
        return `Failed: ${text}`;
      }
      if (status === 'completed' || status === 'done') {
        return `Done: ${text}`;
      }
      return text;
    })
    .filter((row) => {
      if (!row) {
        return false;
      }
      const key = row.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 32);
}

export function normalizeCodexCliDisplayRows(rows) {
  const seen = new Set();
  return asArray(rows)
    .map((row) => {
      const source = row && typeof row === 'object' ? row : { text: row };
      const text = trimText(
        source.text
          || source.display_text
          || source.displayText
          || source.message,
        1200
      );
      if (!text) {
        return '';
      }
      const routingIntent = trimText(source.routing_intent || source.routingIntent, 120);
      if (routingIntent && routingIntent !== 'codex_agent') {
        return '';
      }
      return text;
    })
    .filter((row) => {
      if (!row) {
        return false;
      }
      const key = row.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(-80);
}
