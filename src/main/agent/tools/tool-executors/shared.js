'use strict';

const { ensureObject } = require('../../../lib/normalize.js');

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function resolveToolParserPayload(args = {}, context = {}, extra = {}) {
  const contextParser = context?.parserPayload && typeof context.parserPayload === 'object'
    ? context.parserPayload
    : {};
  const argsParser = args?.parser_payload && typeof args.parser_payload === 'object'
    ? args.parser_payload
    : {};

  return {
    ...contextParser,
    ...argsParser,
    ...(extra && typeof extra === 'object' ? extra : {})
  };
}

function buildToolCitations(cleanText, items = [], source = '', reasonText = '') {
  return (Array.isArray(items) ? items : [])
    .slice(0, 8)
    .map((item, index) => {
      const pointer = [
        cleanText(item?.id || item?.record_id || item?.run_id, 120),
        cleanText(item?.title || item?.name || item?.protocolName, 220)
      ].filter(Boolean).join(' | ');

      return {
        source: cleanText(source, 120),
        pointer: pointer || `${cleanText(source, 40) || 'tool'}:${index + 1}`,
        reason: cleanText(reasonText, 220)
      };
    })
    .filter((citation) => citation.source && citation.pointer);
}

function buildExecutorSummary(cleanText, toolName, items = [], emptyText) {
  const count = Array.isArray(items) ? items.length : 0;
  if (!count) {
    return cleanText(emptyText, 320) || `${cleanText(toolName, 120) || 'Tool'} returned no matches.`;
  }
  if (cleanText(toolName, 120) === 'inventory-lookup') {
    const preview = items
      .slice(0, 2)
      .map((item) => {
        const label = cleanText(item?.name || item?.id, 120);
        const location = cleanText(item?.location, 120);
        return label
          ? (location ? `${label} @ ${location}` : label)
          : '';
      })
      .filter(Boolean)
      .join('; ');
    return cleanText(
      `${cleanText(toolName, 120)} matched ${count} item${count === 1 ? '' : 's'}${preview ? `: ${preview}.` : '.'}`,
      320
    );
  }
  if (cleanText(toolName, 120) === 'notebook-lookup') {
    const preview = items
      .slice(0, 2)
      .map((item) => cleanText(item?.title || item?.protocolName || item?.id, 120))
      .filter(Boolean)
      .join('; ');
    return cleanText(
      `${cleanText(toolName, 120)} matched ${count} item${count === 1 ? '' : 's'}${preview ? `: ${preview}.` : '.'}`,
      320
    );
  }
  return `${cleanText(toolName, 120) || 'Tool'} matched ${count} item${count === 1 ? '' : 's'}.`;
}

function hasOwn(value, key) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
}

function resolveContextProject(args = {}, context = {}) {
  const argsProject = ensureObject(args?.project);
  if (Object.keys(argsProject).length) {
    return argsProject;
  }
  return ensureObject(context?.project);
}

function resolveProjectSelector(cleanText, args = {}, context = {}, parserPayload = {}) {
  const project = resolveContextProject(args, context);
  const entities = ensureObject(parserPayload?.entities);
  return {
    project,
    projectId: cleanText(
      args?.project_id
      || args?.projectId
      || project?.id
      || project?.projectId
      || entities?.project_id
      || entities?.projectId,
      160
    ),
    projectName: cleanText(
      args?.project_name
      || args?.projectName
      || project?.name
      || project?.projectName
      || entities?.project_name
      || entities?.projectName,
      220
    )
  };
}

async function hydrateToolSnapshot({
  snapshot = {},
  context = {},
  cleanText,
  hydrateSnapshotFromBundle,
  getDefaultDataFilePath
} = {}) {
  const sourceSnapshot = ensureObject(snapshot);
  if (typeof hydrateSnapshotFromBundle !== 'function') {
    return sourceSnapshot;
  }
  const defaultDataFilePath = typeof getDefaultDataFilePath === 'function'
    ? cleanText(getDefaultDataFilePath(), 2400)
    : '';
  const dataFilePath = cleanText(
    context?.dataFilePath
      || sourceSnapshot.data_file_path
      || sourceSnapshot.dataFilePath
      || defaultDataFilePath,
    2400
  );
  const fallbackDataFilePath = cleanText(
    context?.fallbackDataFilePath
      || defaultDataFilePath,
    2400
  );
  if (!dataFilePath && !fallbackDataFilePath) {
    return sourceSnapshot;
  }
  try {
    const hydrated = await hydrateSnapshotFromBundle({
      dataFilePath,
      fallbackDataFilePath,
      snapshot: {
        ...sourceSnapshot,
        ...(dataFilePath ? { data_file_path: dataFilePath } : {})
      }
    });
    return ensureObject(hydrated?.snapshot);
  } catch {
    return sourceSnapshot;
  }
}

function resolvePaperDownloadContext(args = {}, context = {}) {
  const snapshot = context?.snapshot && typeof context.snapshot === 'object'
    ? context.snapshot
    : {};
  const project = context?.project && typeof context.project === 'object'
    ? context.project
    : {};
  const message = cleanTextValue(args?.message || context?.message, 12000);
  const projectName = cleanTextValue(project?.name || project?.id, 220);
  const hasProjectContext = Boolean(projectName);
  const collectionName = [
    args?.collection_name,
    args?.collectionName,
    args?.linked_name,
    args?.linkedName
  ].map((value) => cleanTextValue(value, 220)).find(Boolean) || 'Literature Search';
  return {
    storage_path: cleanTextValue(
      args?.storage_path
      || args?.storagePath
      || context?.storagePath
      || snapshot?.settings?.storagePath
      || snapshot?.storagePath,
      2000
    ),
    linked_type: hasProjectContext
      ? 'project'
      : (cleanTextValue(args?.linked_type || args?.linkedType, 80) || 'literature-search'),
    linked_name: hasProjectContext ? projectName : collectionName,
    message
  };
}

function cleanTextValue(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

module.exports = {
  defaultCleanText,
  resolveToolParserPayload,
  buildToolCitations,
  buildExecutorSummary,
  hasOwn,
  resolveContextProject,
  resolveProjectSelector,
  hydrateToolSnapshot,
  resolvePaperDownloadContext,
  cleanTextValue
};
