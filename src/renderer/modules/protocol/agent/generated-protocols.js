import { asArray } from '../../../lib/normalize.js';
import {
  normalizeIsoTimestamp as normalizeSharedIsoTimestamp,
  normalizeProtocolMaterials,
  normalizeProtocolTroubleshooting
} from '../../../../shared/protocol-normalization.mjs';

function trimText(value, limit = 0) {
  const text = String(value || '').trim();
  return limit > 0 ? text.slice(0, limit) : text;
}

function looksLikeProtocol(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value.protocol || value.name || value.title)
    && (Array.isArray(value.steps) || Array.isArray(value.procedure))
  );
}

function normalizeStepEntries(rawSteps = []) {
  return asArray(rawSteps)
    .map((step, index) => {
      if (typeof step === 'string') {
        const text = trimText(step, 2000);
        return text ? { text, placeholders: [] } : null;
      }
      const source = step && typeof step === 'object' && !Array.isArray(step) ? step : {};
      const text = trimText(source.text || source.instruction || source.action || source.description, 2000);
      if (!text) {
        return null;
      }
      return {
        text,
        placeholders: asArray(source.placeholders)
          .map((placeholder, placeholderIndex) => {
            const placeholderSource = placeholder && typeof placeholder === 'object' && !Array.isArray(placeholder)
              ? placeholder
              : {};
            const name = trimText(placeholderSource.name || placeholderSource.label, 160);
            if (!name) {
              return null;
            }
            return {
              id: trimText(placeholderSource.id, 120) || `ph-${index + 1}-${placeholderIndex + 1}`,
              name
            };
          })
          .filter(Boolean)
      };
    })
    .filter(Boolean)
    .slice(0, 160);
}

const normalizeMaterials = (rawMaterials) => normalizeProtocolMaterials(rawMaterials, {
  text: trimText,
  maxItems: 80
});
const normalizeTroubleshooting = (rawTroubleshooting) => normalizeProtocolTroubleshooting(
  rawTroubleshooting,
  { text: trimText }
);

export function normalizeGeneratedProtocol(rawProtocol) {
  const source = rawProtocol && typeof rawProtocol === 'object' && !Array.isArray(rawProtocol)
    ? rawProtocol
    : {};
  const steps = normalizeStepEntries(source.steps || source.procedure);
  const name = trimText(source.name || source.title || source.protocol_name || source.protocolName, 220);
  if (!name || !steps.length) {
    return null;
  }
  return {
    id: trimText(source.id || source.protocol_id || source.protocolId, 220),
    name,
    purpose: trimText(source.purpose || source.description, 1200),
    materials: normalizeMaterials(source.materials),
    steps,
    troubleshooting: normalizeTroubleshooting(source.troubleshooting),
    aliases: asArray(source.aliases).map((alias) => trimText(alias, 120)).filter(Boolean),
    projectId: trimText(source.projectId || source.project_id, 120),
    projectName: trimText(source.projectName || source.project_name, 220),
    createdAt: trimText(source.createdAt, 80),
    updatedAt: trimText(source.updatedAt, 80)
  };
}

function collectProtocolPayloads(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return [];
  }
  const protocols = [];
  const seen = new Set();
  const pushProtocol = (candidate) => {
    const protocol = normalizeGeneratedProtocol(candidate);
    if (!protocol) {
      return;
    }
    const key = [
      trimText(protocol.id, 220),
      trimText(protocol.name, 220).toLowerCase(),
      protocol.steps.map((step) => trimText(step.text, 220)).join('|')
    ].join(':');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    protocols.push(protocol);
  };

  if (Array.isArray(source.protocols)) {
    source.protocols.forEach(pushProtocol);
  }
  if (Array.isArray(source.items)) {
    source.items.forEach((item) => {
      if (looksLikeProtocol(item?.protocol)) {
        pushProtocol(item.protocol);
      } else if (looksLikeProtocol(item)) {
        pushProtocol(item);
      }
    });
  }
  if (looksLikeProtocol(source.protocol)) {
    pushProtocol(source.protocol);
  } else if (looksLikeProtocol(source)) {
    pushProtocol(source);
  }
  return protocols;
}

// Agent chat replies can carry generated protocols under several meta keys
// (snake/camel case, nested under codex_agent). Collect them all, deduped by
// id + name + step text, for the "review and save" card.
export function collectProtocolGenerationPayloads(meta = {}) {
  const sources = [
    meta.protocol_generation,
    meta.protocolGeneration,
    meta.generated_protocol ? { protocol: meta.generated_protocol } : null,
    meta.generatedProtocol ? { protocol: meta.generatedProtocol } : null,
    meta.codex_agent?.protocol_generation,
    meta.codex_agent?.protocolGeneration
  ].filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  return sources.flatMap(collectProtocolPayloads);
}

function buildUniqueProtocolName(baseName = '', protocols = []) {
  const takenNames = new Set(
    asArray(protocols)
      .map((item) => trimText(item?.name, 220).toLowerCase())
      .filter(Boolean)
  );
  const base = trimText(baseName, 220) || 'Generated protocol';
  if (!takenNames.has(base.toLowerCase())) {
    return base;
  }
  const suffixedBase = `${base} (Agent Generated)`;
  let candidate = suffixedBase;
  let suffix = 2;
  while (takenNames.has(candidate.toLowerCase())) {
    candidate = `${suffixedBase} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

const normalizeIsoTimestamp = (rawValue, fallback = '') => (
  normalizeSharedIsoTimestamp(rawValue, fallback, { text: trimText })
);

// Turns an approved agent protocol into a saved record: a colliding id gets a
// fresh one, and a taken name gets an "(Agent Generated)" suffix.
export function buildGeneratedProtocolRecord(protocol, { protocols = [], createId } = {}) {
  const normalizedProtocol = normalizeGeneratedProtocol(protocol);
  if (!normalizedProtocol) {
    return null;
  }
  const nowIso = new Date().toISOString();
  const existingIds = new Set(asArray(protocols).map((item) => trimText(item?.id, 220)).filter(Boolean));
  const requestedId = trimText(normalizedProtocol.id, 220);
  const id = requestedId && !existingIds.has(requestedId)
    ? requestedId
    : trimText(createId?.(), 220) || `agent-protocol-${Date.now().toString(36)}`;
  const createdAt = normalizeIsoTimestamp(normalizedProtocol.createdAt, nowIso) || nowIso;
  const updatedAt = normalizeIsoTimestamp(normalizedProtocol.updatedAt, nowIso) || nowIso;
  return {
    id,
    name: buildUniqueProtocolName(normalizedProtocol.name, protocols),
    createdAt,
    updatedAt,
    purpose: normalizedProtocol.purpose,
    materials: normalizedProtocol.materials,
    steps: normalizedProtocol.steps,
    troubleshooting: normalizedProtocol.troubleshooting,
    ...(normalizedProtocol.aliases.length ? { aliases: normalizedProtocol.aliases } : {}),
    ...(normalizedProtocol.projectId ? { projectId: normalizedProtocol.projectId } : {}),
    ...(normalizedProtocol.projectName ? { projectName: normalizedProtocol.projectName } : {})
  };
}

// What agent-chat uses to show and save generated protocols without importing
// protocol-module internals.
export function createProtocolAgentAdapter({ state, createId, onProtocolsChanged } = {}) {
  return {
    collectReviewProtocols: collectProtocolGenerationPayloads,
    approveGeneratedProtocol(protocol) {
      if (!state || typeof state !== 'object') {
        return null;
      }
      state.protocols = asArray(state.protocols);
      const record = buildGeneratedProtocolRecord(protocol, {
        protocols: state.protocols,
        createId
      });
      if (!record) {
        return null;
      }
      state.protocols.push(record);
      try {
        onProtocolsChanged?.();
      } catch {
        // Domain persistence must remain successful if a downstream view is not mounted.
      }
      return record;
    }
  };
}
