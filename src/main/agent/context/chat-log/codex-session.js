'use strict';

const { cleanText } = require('./text-utils.js');

function resolveCodexSessionSources(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const meta = source.meta && typeof source.meta === 'object' && !Array.isArray(source.meta) ? source.meta : {};
  const codexAgent = source.codex_agent && typeof source.codex_agent === 'object' && !Array.isArray(source.codex_agent)
    ? source.codex_agent
    : (meta.codex_agent && typeof meta.codex_agent === 'object' && !Array.isArray(meta.codex_agent) ? meta.codex_agent : {});
  return { source, meta, codexAgent };
}

function extractCodexSessionId(value = {}) {
  const { source, meta, codexAgent } = resolveCodexSessionSources(value);
  return cleanText(
    source.codex_session_id
      || source.codexSessionId
      || source.codexSessionID
      || meta.codex_session_id
      || meta.codexSessionId
      || codexAgent.codex_session_id
      || codexAgent.codexSessionId);
}

function extractRecoveredFromCodexSessionId(value = {}) {
  const { source, meta, codexAgent } = resolveCodexSessionSources(value);
  return cleanText(
    source.recovered_from_codex_session_id
      || source.recoveredFromCodexSessionId
      || meta.recovered_from_codex_session_id
      || meta.recoveredFromCodexSessionId
      || codexAgent.recovered_from_codex_session_id
      || codexAgent.recoveredFromCodexSessionId);
}

// A recovery row names the Codex session that could not be reopened. Once a turn
// reports that id as dead the stored one must not survive as a fallback, or every
// later turn resumes it, fails, and recovers again.
function mergeCodexSessionId(previousId, row) {
  const nextId = extractCodexSessionId(row);
  const recoveredFrom = extractRecoveredFromCodexSessionId(row);
  if (recoveredFrom && recoveredFrom === previousId) {
    return nextId;
  }
  return nextId || previousId;
}

module.exports = {
  resolveCodexSessionSources,
  extractCodexSessionId,
  extractRecoveredFromCodexSessionId,
  mergeCodexSessionId
};
