'use strict';

const fs = require('node:fs/promises');
const { asArray, cloneJson, ensureObject } = require('../../lib/normalize.js');
const {
  normalizeIsoTimestamp: normalizeSharedIsoTimestamp,
  normalizeProtocolMaterials,
  normalizeProtocolTroubleshooting
} = require('../../../shared/protocol-normalization.mjs');

// The length argument is ignored on purpose: an upsert writes this over the
// user's protocol, and cutting it there loses their text.
function cleanText(value) {
  return String(value || '').trim();
}

// Fields an agent update may leave out; the stored value then stays. The
// generation step fills every field, so omission is read from the raw input.
const KEPT_WHEN_OMITTED = {
  purpose: ['purpose', 'description'],
  materials: ['materials'],
  troubleshooting: ['troubleshooting', 'notes']
};

function safeParseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function slugText(value = '', fallback = 'protocol') {
  return cleanText(value)
    .slice(0, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

const normalizeIsoTimestamp = (rawValue, fallback = '') => (
  normalizeSharedIsoTimestamp(rawValue, fallback, { text: cleanText })
);

function uniqueProtocolId(baseName = '', existingIds = new Set()) {
  const base = `agent-${slugText(baseName, 'protocol')}`;
  let attempt = 0;
  while (attempt < 5000) {
    const suffix = `${Date.now().toString(36)}-${attempt.toString(36)}`;
    const candidate = `${base}-${suffix}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
    attempt += 1;
  }
  return `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildUniqueProtocolName(baseName = '', protocols = [], suffixLabel = 'Agent Generated') {
  const takenNames = new Set(
    asArray(protocols)
      .map((item) => cleanText(item?.name, 220).toLowerCase())
      .filter(Boolean)
  );
  const base = cleanText(baseName, 220) || 'Generated protocol';
  if (!takenNames.has(base.toLowerCase())) {
    return base;
  }
  const suffixedBase = `${base} (${suffixLabel})`;
  let candidate = suffixedBase;
  let suffix = 2;
  while (takenNames.has(candidate.toLowerCase())) {
    candidate = `${suffixedBase} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function normalizeStepEntries(rawSteps = []) {
  return asArray(rawSteps)
    .map((step, index) => {
      if (typeof step === 'string') {
        const text = cleanText(step, 2000);
        return text ? { text, placeholders: [] } : null;
      }
      const source = ensureObject(step);
      const text = cleanText(source.text || source.instruction || source.action, 2000);
      if (!text) {
        return null;
      }
      return {
        text,
        placeholders: asArray(source.placeholders)
          .map((placeholder, placeholderIndex) => {
            const payload = ensureObject(placeholder);
            const name = cleanText(payload.name, 160);
            if (!name) {
              return null;
            }
            return {
              id: cleanText(payload.id, 120) || `ph-${index + 1}-${placeholderIndex + 1}`,
              name
            };
          })
          .filter(Boolean)
      };
    })
    .filter(Boolean);
}

const normalizeMaterials = (rawMaterials) => normalizeProtocolMaterials(rawMaterials, {
  text: cleanText
});
const normalizeTroubleshooting = (rawTroubleshooting) => normalizeProtocolTroubleshooting(
  rawTroubleshooting,
  { text: cleanText }
);

function normalizeProtocolForSave(rawProtocol = {}, {
  existingProtocols = [],
  overwrite = false,
  upsert = false,
  nowIso = new Date().toISOString(),
  sentProtocol = rawProtocol
} = {}) {
  const source = ensureObject(rawProtocol);
  const steps = normalizeStepEntries(source.steps || source.procedure);
  const existingIds = new Set(
    asArray(existingProtocols)
      .map((item) => cleanText(item?.id, 220))
      .filter(Boolean)
  );
  const requestedId = cleanText(source.id || source.protocol_id || source.protocolId, 220);
  const existingIndexById = requestedId
    ? asArray(existingProtocols).findIndex((item) => cleanText(item?.id, 220) === requestedId)
    : -1;
  const shouldReplace = existingIndexById >= 0 && (overwrite === true || upsert === true);
  const existingProtocol = shouldReplace ? ensureObject(existingProtocols[existingIndexById]) : {};
  const name = shouldReplace
    ? (cleanText(source.name || source.title, 220) || cleanText(existingProtocol.name, 220) || 'Generated protocol')
    : buildUniqueProtocolName(source.name || source.title, existingProtocols);
  const id = shouldReplace
    ? requestedId
    : (requestedId && !existingIds.has(requestedId) ? requestedId : uniqueProtocolId(name, existingIds));
  const createdAt = normalizeIsoTimestamp(
    source.createdAt || existingProtocol.createdAt,
    nowIso
  ) || nowIso;
  const updatedAt = normalizeIsoTimestamp(source.updatedAt, nowIso) || nowIso;

  const normalized = {
    id,
    name,
    createdAt,
    updatedAt,
    purpose: cleanText(source.purpose || source.description),
    materials: normalizeMaterials(source.materials),
    steps,
    troubleshooting: normalizeTroubleshooting(source.troubleshooting),
    ...(Array.isArray(source.aliases) ? { aliases: source.aliases.map((alias) => cleanText(alias)).filter(Boolean) } : {}),
    ...(cleanText(source.projectId || source.project_id)
      ? { projectId: cleanText(source.projectId || source.project_id) }
      : {}),
    ...(cleanText(source.projectName || source.project_name)
      ? { projectName: cleanText(source.projectName || source.project_name) }
      : {})
  };
  // An update rewrites what the agent sent; everything else on the stored
  // protocol (aliases, selection insights, fields it left out) stays.
  const protocol = shouldReplace ? { ...existingProtocol, ...normalized } : normalized;
  if (shouldReplace) {
    const sent = ensureObject(sentProtocol);
    Object.entries(KEPT_WHEN_OMITTED).forEach(([field, keys]) => {
      if (!keys.some((key) => key in sent) && field in existingProtocol) {
        protocol[field] = existingProtocol[field];
      }
    });
  }

  return {
    protocol,
    existingIndex: shouldReplace ? existingIndexById : -1,
    replaced: shouldReplace
  };
}

function createProtocolSaveRuntime(deps = {}) {
  const hydrateSnapshotFromBundle = typeof deps.hydrateSnapshotFromBundle === 'function'
    ? deps.hydrateSnapshotFromBundle
    : (async ({ snapshot = {} } = {}) => ({ snapshot: ensureObject(snapshot), bundlePaths: {}, sidecarPaths: {} }));
  const syncBundleFromSnapshot = typeof deps.syncBundleFromSnapshot === 'function'
    ? deps.syncBundleFromSnapshot
    : (async () => ({ bundlePaths: {}, sidecarPaths: {} }));
  const getDefaultDataFilePath = typeof deps.getDefaultDataFilePath === 'function'
    ? deps.getDefaultDataFilePath
    : (() => '');
  const protocolGenerationRuntime = deps.protocolGenerationRuntime && typeof deps.protocolGenerationRuntime === 'object'
    ? deps.protocolGenerationRuntime
    : null;
  const emitProtocolSaved = typeof deps.emitProtocolSaved === 'function'
    ? deps.emitProtocolSaved
    : (() => {});
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());

  async function loadSnapshotFromDataFile(dataFilePath = '') {
    const target = cleanText(dataFilePath, 2400);
    if (!target) {
      return {};
    }
    try {
      return ensureObject(safeParseJson(await fs.readFile(target, 'utf8'), {}));
    } catch {
      return {};
    }
  }

  async function normalizeWithProtocolGeneration(input = {}) {
    const protocol = ensureObject(input.protocol);
    if (protocolGenerationRuntime && typeof protocolGenerationRuntime.generateProtocol === 'function') {
      const generated = await protocolGenerationRuntime.generateProtocol({
        protocol,
        result_summary: cleanText(input.result_summary || input.resultSummary || input.summary, 320)
      });
      if (generated?.ok === false) {
        return {
          ok: false,
          error: cleanText(generated.error, 1200) || 'Protocol JSON could not be normalized.'
        };
      }
      const generatedProtocol = ensureObject(generated?.protocol);
      const requestedId = cleanText(protocol.id || protocol.protocol_id || protocol.protocolId, 220);
      const projectId = cleanText(protocol.projectId || protocol.project_id, 120);
      const projectName = cleanText(protocol.projectName || protocol.project_name, 220);
      return {
        ok: true,
        protocol: {
          ...generatedProtocol,
          ...(requestedId ? { id: requestedId } : {}),
          ...(projectId ? { projectId } : {}),
          ...(projectName ? { projectName } : {})
        }
      };
    }
    return {
      ok: true,
      protocol
    };
  }

  async function saveProtocol(input = {}, context = {}) {
    const normalized = await normalizeWithProtocolGeneration(input);
    if (!normalized.ok) {
      return {
        ok: false,
        status: 'error',
        error: normalized.error
      };
    }
    const dataFilePath = cleanText(
      context?.dataFilePath
        || context?.data_file_path
        || context?.snapshot?.data_file_path
        || context?.snapshot?.dataFilePath
        || getDefaultDataFilePath(),
      2400
    );
    const fallbackDataFilePath = cleanText(context?.fallbackDataFilePath || getDefaultDataFilePath(), 2400);
    const contextSnapshot = ensureObject(context?.snapshot);
    const loadedSnapshot = Object.keys(contextSnapshot).length
      ? contextSnapshot
      : await loadSnapshotFromDataFile(dataFilePath || fallbackDataFilePath);
    const hydrated = await hydrateSnapshotFromBundle({
      dataFilePath,
      fallbackDataFilePath,
      snapshot: loadedSnapshot
    });
    const snapshot = ensureObject(hydrated?.snapshot || loadedSnapshot);
    const existingProtocols = asArray(snapshot.protocols).map((protocol) => ensureObject(protocol));
    const normalizedSave = normalizeProtocolForSave(normalized.protocol, {
      existingProtocols,
      overwrite: input.overwrite === true,
      upsert: input.upsert === true,
      nowIso: now(),
      sentProtocol: input.protocol
    });
    const protocol = normalizedSave.protocol;

    if (!cleanText(protocol.name, 220) || !protocol.steps.length) {
      return {
        ok: false,
        status: 'invalid_arguments',
        error: 'Protocol save requires a protocol name and at least one step.'
      };
    }

    const nextProtocols = existingProtocols.slice();
    if (normalizedSave.existingIndex >= 0) {
      nextProtocols[normalizedSave.existingIndex] = protocol;
    } else {
      nextProtocols.push(protocol);
    }
    const nextSnapshot = {
      ...snapshot,
      protocols: nextProtocols
    };
    const syncResult = await syncBundleFromSnapshot({
      dataFilePath,
      fallbackDataFilePath,
      snapshot: nextSnapshot
    });
    const persistedProtocol = asArray(syncResult?.markdownRecords?.protocols).find(record => record.id === protocol.id) || protocol;
    const payload = {
      protocol: cloneJson(persistedProtocol, {}),
      dataFilePath,
      storagePath: cleanText(nextSnapshot?.settings?.storagePath || syncResult?.bundlePaths?.storageRootPath, 2400),
      sidecarPaths: cloneJson(syncResult?.sidecarPaths, {}),
      bundlePaths: cloneJson(syncResult?.bundlePaths, {})
    };
    emitProtocolSaved(payload);

    return {
      ok: true,
      status: normalizedSave.replaced ? 'updated' : 'saved',
      protocol: persistedProtocol,
      sidecar_paths: payload.sidecarPaths,
      bundle_paths: payload.bundlePaths,
      summary: `${normalizedSave.replaced ? 'Updated' : 'Saved'} protocol "${persistedProtocol.name}" in the Protocols module.`
    };
  }

  return {
    normalizeProtocolForSave,
    saveProtocol
  };
}

module.exports = {
  createProtocolSaveRuntime,
  normalizeProtocolForSave
};
