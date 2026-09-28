import { buildNotebookFolderPath, sanitizeFolderName } from '../../../lib/storage-paths.js';
import { resolveProteinBuilderCloningNotebookProtocol } from '../../../services/notebook-record-compat.js';
import { cloneProtocolSnapshot } from '../../../lib/protocol-snapshot.js';

export { buildNotebookFolderPath, sanitizeFolderName };

export const PLACEHOLDER_TOKEN_REGEX = /\{\{ph:([^}]+)\}\}/g;

export function normalizeNotebookState(value) {
  const state = String(value || '').trim().toLowerCase();
  return ['planned', 'suggested'].includes(state) ? state : 'executed';
}

export function notebookStateLabel(entry) {
  return { planned: 'Planned', suggested: 'Suggested', executed: 'Executed' }[normalizeNotebookState(entry?.notebookState)];
}

export function resolveEntryNotebookState(entry) {
  return normalizeNotebookState(entry?.notebookState);
}

export function resolveEntryExecutedAt(entry, fallbackTimestamp = '') {
  if (resolveEntryNotebookState(entry) !== 'executed') {
    return '';
  }
  return String(entry?.executedAt || '').trim()
    || String(entry?.updatedAt || '').trim()
    || String(fallbackTimestamp || '').trim();
}

export function formatEntryTimestamp(rawValue) {
  const date = new Date(String(rawValue || '').trim());
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }
  return date.toLocaleString();
}

export function cloneSelectionInsights(insights) {
  try {
    return Array.isArray(insights)
      ? JSON.parse(JSON.stringify(
        insights.filter((item) => item && typeof item === 'object')
      ))
      : [];
  } catch {
    return [];
  }
}

export { cloneProtocolSnapshot };

export function resolveEntryProject(entry, projects = []) {
  const liveProject = (Array.isArray(projects) ? projects : []).find((item) => item.id === entry?.projectId) || null;
  if (liveProject) {
    return liveProject;
  }
  const fallbackName = String(entry?.projectName || '').trim() || 'Untitled Project';
  return {
    id: String(entry?.projectId || '').trim(),
    name: fallbackName
  };
}

export function resolveEntryProtocol(entry, protocols = []) {
  const generatedCloningProtocol = resolveProteinBuilderCloningNotebookProtocol(entry);
  if (generatedCloningProtocol) {
    return generatedCloningProtocol;
  }
  const snapshot = cloneProtocolSnapshot(entry?.protocolSnapshot);
  if (snapshot) {
    return snapshot;
  }
  const liveProtocol = (Array.isArray(protocols) ? protocols : []).find((item) => item.id === entry?.protocolId) || null;
  if (liveProtocol) {
    return liveProtocol;
  }
  const fallbackName = String(entry?.protocolName || entry?.workflowContext?.workflowBlockTitle || '').trim();
  if (!fallbackName) {
    return null;
  }
  return {
    id: String(entry?.protocolId || entry?.id || '').trim(),
    name: fallbackName,
    steps: []
  };
}

export function resolveEntryExperimentName(entry, fallbackProtocol = null) {
  const experimentName = String(entry?.experimentName || '').trim();
  if (experimentName) {
    return experimentName;
  }
  const protocolName = String(
    fallbackProtocol?.name
    || entry?.protocolName
    || entry?.workflowContext?.workflowBlockTitle
    || ''
  ).trim();
  return protocolName || 'Untitled Page';
}

export function resolveEntryCollectionName(entry, projects = []) {
  const workflowEntryName = String(entry?.workflowContext?.workflowEntryName || '').trim();
  if (workflowEntryName) {
    return workflowEntryName;
  }
  const workflowName = String(entry?.workflowContext?.workflowName || '').trim();
  if (workflowName) {
    return workflowName;
  }
  const liveProject = (Array.isArray(projects) ? projects : []).find((item) => item.id === entry?.projectId) || null;
  if (liveProject?.name) {
    return liveProject.name;
  }
  const projectName = String(entry?.projectName || '').trim();
  if (projectName) {
    return projectName;
  }
  return 'Untitled Project';
}

export function mergeNotebookValues(existingValues, currentValues) {
  const baseValues = existingValues && typeof existingValues === 'object' ? existingValues : {};
  const liveValues = currentValues && typeof currentValues === 'object' ? currentValues : {};
  return {
    ...baseValues,
    ...liveValues
  };
}

export function shouldSyncExperimentNameWithProtocol(currentName, previousProtocolName) {
  const normalizedCurrent = String(currentName || '').trim();
  const normalizedPrevious = String(previousProtocolName || '').trim();
  return !normalizedCurrent || normalizedCurrent === normalizedPrevious;
}

export function collectProtocolPlaceholderKeys(protocol) {
  const allowedKeys = new Set();
  (Array.isArray(protocol?.steps) ? protocol.steps : []).forEach((step) => {
    (Array.isArray(step?.placeholders) ? step.placeholders : []).forEach((placeholder) => {
      const placeholderId = String(placeholder?.id || '').trim();
      if (placeholderId) {
        allowedKeys.add(placeholderId);
      }
    });
  });
  return allowedKeys;
}

export function pruneNotebookValuesForProtocol(values, protocol) {
  const allowedKeys = collectProtocolPlaceholderKeys(protocol);
  const sourceValues = values && typeof values === 'object' ? values : {};
  return Object.entries(sourceValues).reduce((accumulator, [key, rawValue]) => {
    if (!allowedKeys.has(key)) {
      return accumulator;
    }
    accumulator[key] = String(rawValue || '').trim();
    return accumulator;
  }, {});
}

export function matchesNotebookType(entry, notebookType) {
  if (entry?.notebookType) {
    return entry.notebookType === notebookType;
  }
  return notebookType === 'synthesis';
}
