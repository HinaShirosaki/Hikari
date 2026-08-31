'use strict';

const fs = require('node:fs/promises');
const { asArray, cloneJson, ensureObject } = require('../../lib/normalize.js');

function cleanText(value, maxLength = 1200) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function safeParseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function slugText(value = '', fallback = 'protocol') {
  return cleanText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function normalizeIsoTimestamp(rawValue, fallback = '') {
  const candidate = cleanText(rawValue, 120);
  if (!candidate) {
    return fallback;
  }
  const timestamp = Date.parse(candidate);
  if (!Number.isFinite(timestamp)) {
    return fallback;
  }
  return new Date(timestamp).toISOString();
}

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
        return text ? { id: `step-${index + 1}`, text, placeholders: [] } : null;
      }
      const source = ensureObject(step);
      const text = cleanText(source.text || source.instruction || source.action, 2000);
      if (!text) {
        return null;
      }
      return {
        id: cleanText(source.id, 120) || `step-${index + 1}`,
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
    .filter(Boolean)
    .slice(0, 160);
}

function normalizeMaterials(rawMaterials) {
  if (Array.isArray(rawMaterials)) {
    return rawMaterials.map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 80);
  }
  return cleanText(rawMaterials, 6000)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 80);
}

function normalizeTroubleshooting(rawTroubleshooting) {
  if (Array.isArray(rawTroubleshooting)) {
    return rawTroubleshooting
      .map((item) => {
        if (typeof item === 'string') {
          return cleanText(item, 1200);
        }
        const source = ensureObject(item);
        return [
          cleanText(source.problem, 400) ? `Problem: ${cleanText(source.problem, 400)}` : '',
          cleanText(source.possible_cause || source.possibleCause, 400)
            ? `Possible cause: ${cleanText(source.possible_cause || source.possibleCause, 400)}`
            : '',
          cleanText(source.solution, 400) ? `Solution: ${cleanText(source.solution, 400)}` : ''
        ].filter(Boolean).join('; ');
      })
      .filter(Boolean)
      .join('\n');
  }
  return cleanText(rawTroubleshooting, 6000);
}

function normalizeProtocolForSave(rawProtocol = {}, {
  existingProtocols = [],
  overwrite = false,
  upsert = false,
  nowIso = new Date().toISOString()
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

  return {
    protocol: {
      id,
      name,
      createdAt,
      updatedAt,
      purpose: cleanText(source.purpose || source.description, 1200),
      materials: normalizeMaterials(source.materials),
      steps,
      troubleshooting: normalizeTroubleshooting(source.troubleshooting),
      ...(Array.isArray(source.aliases) ? { aliases: source.aliases.map((alias) => cleanText(alias, 120)).filter(Boolean) } : {}),
      ...(cleanText(source.projectId || source.project_id, 120)
        ? { projectId: cleanText(source.projectId || source.project_id, 120) }
        : {}),
      ...(cleanText(source.projectName || source.project_name, 220)
        ? { projectName: cleanText(source.projectName || source.project_name, 220) }
        : {})
    },
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
      nowIso: now()
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
    const payload = {
      protocol: cloneJson(protocol, {}),
      dataFilePath,
      storagePath: cleanText(nextSnapshot?.settings?.storagePath || syncResult?.bundlePaths?.storageRootPath, 2400),
      sidecarPaths: cloneJson(syncResult?.sidecarPaths, {}),
      bundlePaths: cloneJson(syncResult?.bundlePaths, {})
    };
    emitProtocolSaved(payload);

    return {
      ok: true,
      status: normalizedSave.replaced ? 'updated' : 'saved',
      protocol,
      sidecar_paths: payload.sidecarPaths,
      bundle_paths: payload.bundlePaths,
      summary: `${normalizedSave.replaced ? 'Updated' : 'Saved'} protocol "${protocol.name}" in the Protocols module.`
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
