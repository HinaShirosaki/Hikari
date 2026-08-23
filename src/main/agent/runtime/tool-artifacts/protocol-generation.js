'use strict';

const { asArray, cloneJson, ensureObject } = require('../../../lib/normalize.js');

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function parseJsonObjectFromText(raw = '') {
  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function normalizeProtocolGenerationArtifact(payload = {}, { cleanText: clean = cleanText } = {}) {
  const source = ensureObject(payload);
  const protocol = source.protocol && typeof source.protocol === 'object' && !Array.isArray(source.protocol)
    ? cloneJson(source.protocol, null)
    : null;
  if (!protocol || !Object.keys(protocol).length) {
    return null;
  }
  return {
    ok: source.ok !== false,
    status: clean(source.status, 80) || (source.save_requested === true ? 'awaiting_user_approval' : 'normalized'),
    mcp_tool: clean(source.mcp_tool || source.mcpTool, 120) || 'protocol_generation',
    app_tool: clean(source.app_tool || source.appTool, 120) || 'protocol-generation',
    summary: clean(source.summary || source.result_summary || source.resultSummary, 500),
    save_requested: source.save_requested === true || source.saveRequested === true || source.requires_user_approval === true,
    requires_user_approval: source.requires_user_approval === true || source.requiresUserApproval === true || source.save_requested === true,
    protocol
  };
}

function buildProtocolGenerationAggregate(artifacts = []) {
  const protocols = [];
  const seen = new Set();
  asArray(artifacts).forEach((artifact) => {
    const protocol = artifact?.protocol && typeof artifact.protocol === 'object' ? artifact.protocol : null;
    if (!protocol) {
      return;
    }
    const key = [
      cleanText(protocol.id || protocol.protocol_id || protocol.protocolId, 220),
      cleanText(protocol.name || protocol.title, 220),
      JSON.stringify(asArray(protocol.steps || protocol.procedure).slice(0, 3))
    ].join(':');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    protocols.push(cloneJson(protocol, null));
  });
  if (!protocols.length) {
    return null;
  }
  const lastArtifact = asArray(artifacts).filter(Boolean).at(-1) || {};
  const saveRequested = asArray(artifacts).some((artifact) => (
    artifact?.save_requested === true
    || artifact?.saveRequested === true
    || artifact?.requires_user_approval === true
    || artifact?.requiresUserApproval === true
  ));
  return {
    ok: true,
    status: saveRequested
      ? 'awaiting_user_approval'
      : (cleanText(lastArtifact.status, 80) || 'normalized'),
    mcp_tool: 'protocol_generation',
    app_tool: 'protocol-generation',
    summary: cleanText(lastArtifact.summary, 500),
    save_requested: saveRequested,
    requires_user_approval: saveRequested,
    protocol: protocols[0],
    protocols
  };
}

function textNamesDirectProtocolGenerationTool(rawText = '') {
  const text = String(rawText || '');
  return /\bmcp__[^_\s]+__protocol_generation\b/i.test(text)
    || /\bprotocol_generation\b/i.test(text);
}

function textRequestsProtocolSave(rawText = '') {
  return /\bsave\b\s*(?::|=)?\s*true\b/i.test(String(rawText || ''));
}

function protocolHasSteps(protocol = {}) {
  const source = ensureObject(protocol);
  return asArray(source.steps).length > 0 || asArray(source.procedure).length > 0;
}

function buildDirectProtocolGenerationFallbackArgs(rawMessage = '', { cleanText: clean = cleanText } = {}) {
  if (!textNamesDirectProtocolGenerationTool(rawMessage)) {
    return null;
  }
  const parsed = parseJsonObjectFromText(rawMessage);
  const source = ensureObject(parsed);
  const protocol = ensureObject(source.protocol);
  const candidateProtocol = Object.keys(protocol).length ? protocol : source;
  if (!protocolHasSteps(candidateProtocol)) {
    return null;
  }
  const args = {
    protocol: cloneJson(candidateProtocol, {})
  };
  const resultSummary = clean(source.result_summary || source.resultSummary || source.summary, 320);
  if (resultSummary) {
    args.result_summary = resultSummary;
  }
  if (source.save === true || textRequestsProtocolSave(rawMessage)) {
    args.save = true;
  }
  if (source.overwrite === true) {
    args.overwrite = true;
  }
  if (source.upsert === true) {
    args.upsert = true;
  }
  return args;
}

function looksLikeDirectToolMaterializationFailure(rawText = '') {
  const text = String(rawText || '').toLowerCase();
  if (!text) {
    return false;
  }
  return [
    /not exposed/,
    /not available/,
    /\bunavailable\b/,
    /not visible/,
    /not found/,
    /couldn['’]?t submit/,
    /could not submit/,
    /cannot submit/,
    /couldn['’]?t call/,
    /could not call/,
    /cannot call/,
    /unable to call/,
    /unable to submit/
  ].some((pattern) => pattern.test(text));
}

module.exports = {
  buildDirectProtocolGenerationFallbackArgs,
  buildProtocolGenerationAggregate,
  looksLikeDirectToolMaterializationFailure,
  normalizeProtocolGenerationArtifact
};
