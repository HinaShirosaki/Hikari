'use strict';

function createPersistedDisplayRowBuilders({ cleanText, asArray } = {}) {
  function buildPersistedActivityTraceRows(events = []) {
    const seen = new Set();
    return asArray(events)
      .map((entry) => {
        const source = entry && typeof entry === 'object' ? entry : {};
        const text = cleanText(source.message, 420);
        if (!text) {
          return null;
        }
        const key = [
          cleanText(source.stage, 80),
          cleanText(source.tool_name || source.toolName, 120),
          text
        ].filter(Boolean).join(':').toLowerCase();
        if (seen.has(key)) {
          return null;
        }
        seen.add(key);
        return {
          key,
          status: cleanText(source.status, 40),
          stage: cleanText(source.stage, 80),
          routing_intent: cleanText(source.routing_intent || source.routingIntent, 120),
          tool_name: cleanText(source.tool_name || source.toolName, 120),
          text
        };
      })
      .filter(Boolean)
      .slice(-32);
  }

  function buildPersistedCodexCliDisplayRows(events = []) {
    const seen = new Set();
    return asArray(events)
      .map((entry) => {
        const source = entry && typeof entry === 'object' ? entry : {};
        const stage = cleanText(source.stage, 80);
        const text = cleanText(
          source.meta?.codex_display_text
            || source.meta?.codexDisplayText
            || source.message,
          1200
        );
        if (stage !== 'codex_cli_display' || !text) {
          return null;
        }
        const key = [
          stage,
          cleanText(source.timestamp, 80),
          cleanText(source.meta?.codex_display_kind || source.meta?.codexDisplayKind, 80),
          text
        ].filter(Boolean).join(':').toLowerCase();
        if (seen.has(key)) {
          return null;
        }
        seen.add(key);
        return {
          key,
          stage,
          routing_intent: cleanText(source.routing_intent || source.routingIntent, 120),
          kind: cleanText(source.meta?.codex_display_kind || source.meta?.codexDisplayKind, 80),
          stream: cleanText(source.meta?.codex_display_stream || source.meta?.codexDisplayStream, 40),
          text
        };
      })
      .filter(Boolean)
      .slice(-80);
  }

  return {
    buildPersistedActivityTraceRows,
    buildPersistedCodexCliDisplayRows
  };
}

module.exports = {
  createPersistedDisplayRowBuilders
};
