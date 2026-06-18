import { createId } from '../modules/utils.js';

function normalizeProtocolStep(step, index) {
  if (typeof step === 'string') {
    const text = step.trim();
    return text ? { id: `step-${index + 1}`, text, placeholders: [] } : null;
  }
  if (!step || typeof step !== 'object') {
    return null;
  }
  const text = String(step.text || step.instruction || step.action || '').trim();
  if (!text) {
    return null;
  }
  return {
    id: String(step.id || `step-${index + 1}`),
    text,
    placeholders: Array.isArray(step.placeholders)
      ? step.placeholders
        .map((placeholder, placeholderIndex) => {
          const placeholderName = String(placeholder?.name || '').trim();
          if (!placeholderName) {
            return null;
          }
          return {
            id: String(placeholder?.id || `ph-${index + 1}-${placeholderIndex + 1}`),
            name: placeholderName
          };
        })
        .filter(Boolean)
      : []
  };
}

function normalizeProtocolMaterials(materials) {
  if (Array.isArray(materials)) {
    return materials.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(materials || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

function normalizeProtocolTimestamp(value, fallback) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

export function normalizeExternalProtocolRecord(protocol, options = {}) {
  if (!protocol || typeof protocol !== 'object' || Array.isArray(protocol)) {
    return null;
  }
  const name = String(protocol.name || protocol.title || '').trim();
  const steps = Array.isArray(protocol.steps)
    ? protocol.steps.map(normalizeProtocolStep).filter(Boolean)
    : [];
  if (!name || !steps.length) {
    return null;
  }
  const createProtocolId = typeof options.createId === 'function'
    ? options.createId
    : createId;
  const nowIso = new Date().toISOString();
  const createdAt = normalizeProtocolTimestamp(protocol.createdAt, nowIso);
  const updatedAt = normalizeProtocolTimestamp(protocol.updatedAt, createdAt);
  return {
    id: String(protocol.id || createProtocolId()),
    name,
    createdAt,
    updatedAt,
    purpose: String(protocol.purpose || protocol.description || '').trim(),
    materials: normalizeProtocolMaterials(protocol.materials),
    steps,
    troubleshooting: String(protocol.troubleshooting || '').trim(),
    ...(Array.isArray(protocol.aliases)
      ? { aliases: protocol.aliases.map((alias) => String(alias || '').trim()).filter(Boolean) }
      : {}),
    ...(String(protocol.projectId || protocol.project_id || '').trim()
      ? { projectId: String(protocol.projectId || protocol.project_id).trim() }
      : {}),
    ...(String(protocol.projectName || protocol.project_name || '').trim()
      ? { projectName: String(protocol.projectName || protocol.project_name).trim() }
      : {})
  };
}

export function upsertProtocolRecord(protocols, protocol) {
  if (!Array.isArray(protocols) || !protocol) {
    return [];
  }
  const existingIndex = protocols.findIndex((item) => String(item?.id || '') === protocol.id);
  if (existingIndex >= 0) {
    protocols[existingIndex] = protocol;
  } else {
    protocols.push(protocol);
  }
  return protocols;
}

export function createProtocolService(registry, deps = {}) {
  const state = deps.state || null;
  const persist = typeof deps.persist === 'function' ? deps.persist : null;
  const createProtocolId = typeof deps.createId === 'function' ? deps.createId : createId;

  function importProtocolsFromJson(rawInput, options = {}) {
    const protocol = registry.get('protocol');
    if (typeof protocol.importProtocolsFromJson !== 'function') {
      return { ok: false, error: 'Protocol import is not ready.' };
    }
    return protocol.importProtocolsFromJson(rawInput, options);
  }

  function handleProtocolsChanged() {
    registry.get('synthesisNotebook').renderProtocolOptions?.();
    registry.get('synthesisNotebook').renderEntries?.();
    registry.get('biologyNotebook').renderProtocolOptions?.();
    registry.get('biologyNotebook').renderEntries?.();
    registry.get('workflowManagement').render?.();
    registry.get('assay').renderNotebookOptions?.();
    registry.get('assay').renderList?.();
    registry.get('gel').renderNotebookOptions?.();
    registry.get('gel').renderList?.();
  }

  function handleProtocolsImported() {
    handleProtocolsChanged();
    registry.get('protocol').renderList?.();
  }

  function handleExternalProtocolRecordSaved(payload = {}) {
    if (!state || typeof state !== 'object') {
      return false;
    }
    const protocol = normalizeExternalProtocolRecord(payload?.protocol, {
      createId: createProtocolId
    });
    if (!protocol) {
      return false;
    }
    if (!Array.isArray(state.protocols)) {
      state.protocols = [];
    }
    upsertProtocolRecord(state.protocols, protocol);
    persist?.();
    handleProtocolsImported();
    return true;
  }

  function openProtocol(itemId) {
    if (!itemId) {
      return false;
    }
    const showView = registry.get('showView');
    const views = registry.get('VIEWS');
    if (typeof showView === 'function' && views?.PROTOCOL_MANAGEMENT) {
      showView(views.PROTOCOL_MANAGEMENT);
    }
    registry.get('protocol').editProtocol?.(itemId);
    return true;
  }

  function createDraftFromPaper({ method, paper }) {
    const protocol = registry.get('protocol');
    const ok = protocol.addDraftFromExtractedMethod?.(method, paper);
    if (ok) {
      const showView = registry.get('showView');
      const views = registry.get('VIEWS');
      if (typeof showView === 'function' && views?.PROTOCOL_MANAGEMENT) {
        showView(views.PROTOCOL_MANAGEMENT);
      }
    }
    return Boolean(ok);
  }

  return {
    importProtocolsFromJson,
    handleProtocolsChanged,
    handleProtocolsImported,
    handleExternalProtocolRecordSaved,
    openProtocol,
    createDraftFromPaper
  };
}
