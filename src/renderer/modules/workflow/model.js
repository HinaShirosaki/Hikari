import { BLOCK_TYPES } from './constants.js';

export function createEmptyDraft() {
  return {
    id: '',
    templateId: '',
    name: '',
    description: '',
    projectId: '',
    notebookEntryIds: [],
    blocks: [],
    links: [],
    entries: [],
    createdAt: '',
    updatedAt: ''
  };
}

export function createEmptyWorkflowEntry() {
  return {
    id: '',
    name: '',
    notes: '',
    activeBranchRootIds: [],
    stepStates: {},
    createdAt: '',
    updatedAt: ''
  };
}

export function normalizeIsoTimestamp(rawValue, fallback = '') {
  const candidate = String(rawValue || '').trim();
  if (!candidate) {
    return fallback;
  }
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return new Date(parsed).toISOString();
}

export function parseTimestamp(rawValue) {
  const parsed = Date.parse(String(rawValue || '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatTimestamp(rawValue) {
  const parsed = parseTimestamp(rawValue);
  if (!parsed) {
    return '-';
  }
  return new Date(parsed).toLocaleString();
}

export function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

function normalizeStringMap(rawValue) {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return {};
  }
  return Object.entries(rawValue).reduce((acc, [key, value]) => {
    const normalizedKey = String(key || '').trim();
    const normalizedValue = String(value || '').trim();
    if (!normalizedKey || !normalizedValue) {
      return acc;
    }
    acc[normalizedKey] = normalizedValue;
    return acc;
  }, {});
}

function normalizeImportedFileRecord(rawRecord) {
  if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
    return null;
  }
  const name = String(rawRecord.name || '').trim();
  if (!name) {
    return null;
  }
  return {
    name,
    path: String(rawRecord.path || '').trim(),
    relativePath: String(rawRecord.relativePath || '').trim(),
    size: Number(rawRecord.size) || 0,
    importedAt: normalizeIsoTimestamp(rawRecord.importedAt)
  };
}

export function normalizeWorkflowStepState(rawState = {}) {
  const completedAt = normalizeIsoTimestamp(rawState?.completedAt);
  const updatedAt = normalizeIsoTimestamp(rawState?.updatedAt, completedAt);
  const requestedStatus = String(rawState?.status || '').trim().toLowerCase();
  const status = requestedStatus === 'failed'
    ? 'failed'
    : (requestedStatus === 'pending'
      ? 'pending'
      : (requestedStatus === 'completed' || completedAt ? 'completed' : 'not_done'));
  const resultFileRecords = Array.isArray(rawState?.resultFileRecords)
    ? rawState.resultFileRecords.map((record) => normalizeImportedFileRecord(record)).filter(Boolean)
    : [];
  const derivedResultFiles = resultFileRecords.map((record) => record.name);

  return {
    status,
    values: normalizeStringMap(rawState?.values),
    result: String(rawState?.result || rawState?.notes || '').trim(),
    resultFiles: uniqueStrings([
      ...(Array.isArray(rawState?.resultFiles) ? rawState.resultFiles : []),
      ...derivedResultFiles
    ]),
    resultFileRecords,
    notebookEntryId: String(rawState?.notebookEntryId || '').trim(),
    assayIds: uniqueStrings(rawState?.assayIds),
    gelAnalysisIds: uniqueStrings(rawState?.gelAnalysisIds || rawState?.gelIds),
    completedAt,
    updatedAt
  };
}

export function normalizeWorkflowEntries(rawEntries, blocks, createId) {
  const validBlockIds = new Set((Array.isArray(blocks) ? blocks : []).map((block) => block.id));
  const seen = new Set();
  const entries = [];

  (Array.isArray(rawEntries) ? rawEntries : []).forEach((rawEntry, index) => {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      return;
    }

    let id = String(rawEntry.id || '').trim();
    if (!id || seen.has(id)) {
      id = createId();
    }
    seen.add(id);

    const createdAt = normalizeIsoTimestamp(rawEntry.createdAt);
    const updatedAt = normalizeIsoTimestamp(rawEntry.updatedAt, createdAt);
    const rawStepStates = rawEntry.stepStates && typeof rawEntry.stepStates === 'object' && !Array.isArray(rawEntry.stepStates)
      ? rawEntry.stepStates
      : {};
    const stepStates = Object.entries(rawStepStates).reduce((acc, [blockId, rawState]) => {
      const normalizedBlockId = String(blockId || '').trim();
      if (!normalizedBlockId || !validBlockIds.has(normalizedBlockId)) {
        return acc;
      }
      acc[normalizedBlockId] = normalizeWorkflowStepState(rawState);
      return acc;
    }, {});

    entries.push({
      ...createEmptyWorkflowEntry(),
      id,
      name: String(rawEntry.name || '').trim() || `Entry ${index + 1}`,
      notes: String(rawEntry.notes || '').trim(),
      activeBranchRootIds: uniqueStrings(rawEntry.activeBranchRootIds).filter((blockId) => validBlockIds.has(blockId)),
      stepStates,
      createdAt,
      updatedAt
    });
  });

  return entries;
}

export function normalizePlainTextBlock(rawValue) {
  return String(rawValue || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeBlockType(rawType, protocolId = '', textContent = '') {
  const explicit = String(rawType || '').trim().toLowerCase();
  if (explicit === BLOCK_TYPES.PROTOCOL && protocolId) {
    return BLOCK_TYPES.PROTOCOL;
  }
  if (explicit === BLOCK_TYPES.TEXT && textContent) {
    return BLOCK_TYPES.TEXT;
  }
  if (protocolId) {
    return BLOCK_TYPES.PROTOCOL;
  }
  if (textContent) {
    return BLOCK_TYPES.TEXT;
  }
  return '';
}

export function getBlockType(block) {
  const protocolId = String(block?.protocolId || '').trim();
  const textContent = normalizePlainTextBlock(block?.text);
  const type = normalizeBlockType(block?.type, protocolId, textContent);
  return type || (protocolId ? BLOCK_TYPES.PROTOCOL : BLOCK_TYPES.TEXT);
}

export function suggestedBlockPosition(index) {
  const normalized = Number.isFinite(index) ? Math.max(0, index) : 0;
  const columns = 3;
  const col = normalized % columns;
  const row = Math.floor(normalized / columns);
  return {
    x: 44 + (col * 280),
    y: 36 + (row * 150)
  };
}

export function createWorkflowModel(options = {}) {
  const createId = typeof options?.createId === 'function'
    ? options.createId
    : (() => Math.random().toString(36).slice(2));
  const resolveDefaultAssigneeId = typeof options?.resolveDefaultAssigneeId === 'function'
    ? options.resolveDefaultAssigneeId
    : (() => '');

  function normalizeBlocks(rawBlocks) {
    const seen = new Set();
    const blocks = [];
    const defaultAssigneeId = resolveDefaultAssigneeId();

    (Array.isArray(rawBlocks) ? rawBlocks : []).forEach((rawBlock) => {
      const protocolId = String(rawBlock?.protocolId || '').trim();
      const textContent = normalizePlainTextBlock(rawBlock?.text || rawBlock?.label || '');
      const blockType = normalizeBlockType(rawBlock?.type, protocolId, textContent);
      if (!blockType) {
        return;
      }

      let id = String(rawBlock?.id || '').trim();
      if (!id || seen.has(id)) {
        id = createId();
      }
      seen.add(id);

      const fallbackPosition = suggestedBlockPosition(blocks.length);
      const parsedX = Number(rawBlock?.x);
      const parsedY = Number(rawBlock?.y);

      blocks.push({
        id,
        type: blockType,
        protocolId: blockType === BLOCK_TYPES.PROTOCOL ? protocolId : '',
        text: blockType === BLOCK_TYPES.TEXT ? textContent : '',
        assigneeId: String(rawBlock?.assigneeId || defaultAssigneeId).trim(),
        x: Number.isFinite(parsedX) ? Math.max(20, Math.round(parsedX)) : fallbackPosition.x,
        y: Number.isFinite(parsedY) ? Math.max(20, Math.round(parsedY)) : fallbackPosition.y
      });
    });

    return blocks;
  }

  function normalizeLinks(rawLinks, blocks) {
    const validBlockIds = new Set((Array.isArray(blocks) ? blocks : []).map((block) => block.id));
    const seenPairs = new Set();
    const seenLinkIds = new Set();
    const links = [];

    (Array.isArray(rawLinks) ? rawLinks : []).forEach((rawLink) => {
      const fromBlockId = String(rawLink?.fromBlockId || '').trim();
      const toBlockId = String(rawLink?.toBlockId || '').trim();
      if (!fromBlockId || !toBlockId || fromBlockId === toBlockId) {
        return;
      }
      if (!validBlockIds.has(fromBlockId) || !validBlockIds.has(toBlockId)) {
        return;
      }

      const pairKey = `${fromBlockId}->${toBlockId}`;
      if (seenPairs.has(pairKey)) {
        return;
      }
      seenPairs.add(pairKey);

      let id = String(rawLink?.id || '').trim();
      if (!id || seenLinkIds.has(id)) {
        id = createId();
      }
      seenLinkIds.add(id);

      links.push({ id, fromBlockId, toBlockId });
    });

    return links;
  }

  function normalizeWorkflow(rawWorkflow) {
    const blocks = normalizeBlocks(rawWorkflow?.blocks);
    const links = normalizeLinks(rawWorkflow?.links, blocks);
    const entries = normalizeWorkflowEntries(rawWorkflow?.entries, blocks, createId);
    const createdAt = normalizeIsoTimestamp(rawWorkflow?.createdAt);
    const updatedAt = normalizeIsoTimestamp(rawWorkflow?.updatedAt, createdAt);
    return {
      id: String(rawWorkflow?.id || createId()),
      templateId: String(rawWorkflow?.templateId || '').trim(),
      name: String(rawWorkflow?.name || '').trim(),
      description: String(rawWorkflow?.description || '').trim(),
      projectId: String(rawWorkflow?.projectId || '').trim(),
      notebookEntryIds: uniqueStrings(rawWorkflow?.notebookEntryIds),
      blocks,
      links,
      entries,
      createdAt,
      updatedAt
    };
  }

  function normalizeTemplate(rawTemplate) {
    const blocks = normalizeBlocks(rawTemplate?.blocks);
    const links = normalizeLinks(rawTemplate?.links, blocks);
    const createdAt = normalizeIsoTimestamp(rawTemplate?.createdAt);
    const updatedAt = normalizeIsoTimestamp(rawTemplate?.updatedAt, createdAt);
    return {
      id: String(rawTemplate?.id || createId()),
      name: String(rawTemplate?.name || '').trim(),
      description: String(rawTemplate?.description || '').trim(),
      blocks,
      links,
      createdAt,
      updatedAt
    };
  }

  function instantiateTemplate(template, name) {
    const blockIdMap = new Map();

    const blocks = template.blocks.map((block, index) => {
      const nextId = createId();
      blockIdMap.set(block.id, nextId);

      const parsedX = Number(block.x);
      const parsedY = Number(block.y);
      const fallbackPos = suggestedBlockPosition(index);
      const blockType = getBlockType(block);

      return {
        id: nextId,
        type: blockType,
        protocolId: blockType === BLOCK_TYPES.PROTOCOL ? String(block.protocolId || '').trim() : '',
        text: blockType === BLOCK_TYPES.TEXT ? normalizePlainTextBlock(block.text) : '',
        assigneeId: block.assigneeId || resolveDefaultAssigneeId(),
        x: Number.isFinite(parsedX) ? Math.max(20, Math.round(parsedX)) : fallbackPos.x,
        y: Number.isFinite(parsedY) ? Math.max(20, Math.round(parsedY)) : fallbackPos.y
      };
    });

    const links = template.links
      .map((link) => ({
        id: createId(),
        fromBlockId: blockIdMap.get(link.fromBlockId),
        toBlockId: blockIdMap.get(link.toBlockId)
      }))
      .filter((link) => link.fromBlockId && link.toBlockId);

    return normalizeWorkflow({
      id: createId(),
      templateId: String(template?.id || '').trim(),
      name,
      description: template.description,
      projectId: '',
      notebookEntryIds: [],
      blocks,
      links,
      entries: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  return {
    normalizeBlocks,
    normalizeLinks,
    normalizeWorkflow,
    normalizeTemplate,
    instantiateTemplate
  };
}
