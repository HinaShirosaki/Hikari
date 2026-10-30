import { BLOCK_TYPES } from './constants.js';

export function protocolNameById(state, protocolId) {
  const protocol = (state.protocols || []).find((item) => item.id === protocolId);
  return protocol?.name || `Missing protocol (${protocolId})`;
}

export function blockTypeLabel(block, getBlockType) {
  return getBlockType(block) === BLOCK_TYPES.TEXT ? 'Plain Text' : 'Protocol';
}

export function blockTitle(block, options = {}) {
  const getBlockType = options?.getBlockType;
  const protocolNameResolver = options?.protocolNameById;
  if (typeof getBlockType === 'function' && getBlockType(block) === BLOCK_TYPES.TEXT) {
    return String(block?.text || '').trim() || 'Text Block';
  }
  if (typeof protocolNameResolver === 'function') {
    return protocolNameResolver(String(block?.protocolId || '').trim());
  }
  return String(block?.protocolId || '').trim() || 'Protocol Block';
}

export function memberNameById(state, memberId) {
  const member = (state.members || []).find((item) => item.id === memberId);
  return member?.name || '';
}

export function assigneeLabelById(state, memberId) {
  const normalizedId = String(memberId || '').trim();
  if (!normalizedId) {
    return 'Unassigned';
  }
  return memberNameById(state, normalizedId) || `Missing member (${normalizedId})`;
}

export function projectNameById(state, projectId) {
  const project = (state.projects || []).find((item) => item.id === projectId);
  return project?.name || `Missing project (${projectId})`;
}

export function notebookEntryLabel(entry, formatTimestamp) {
  const notebookTypeLabel = entry.notebookType === 'biology' ? 'Biology' : 'Synthesis';
  const protocolLabel = String(entry.protocolName || entry.protocolId || 'Notebook Page').trim();
  const notebookState = String(entry?.notebookState || '').trim().toLowerCase();
  const notebookStateLabel = notebookState === 'suggested' ? 'Suggested' : notebookState === 'planned' ? 'Planned' : 'Executed';
  return `${notebookTypeLabel} | ${notebookStateLabel} | ${protocolLabel} | ${formatTimestamp(entry.updatedAt)}`;
}

export function buildAssigneeOptions(state, safeText, selectedAssigneeId = '') {
  const options = ['<option value="">Unassigned</option>'];
  (state.members || []).forEach((member) => {
    const selectedAttr = member.id === selectedAssigneeId ? ' selected' : '';
    options.push(`<option value="${safeText(member.id)}"${selectedAttr}>${safeText(member.name)}</option>`);
  });
  if (selectedAssigneeId && !(state.members || []).some((member) => member.id === selectedAssigneeId)) {
    options.push(`<option value="${safeText(selectedAssigneeId)}" selected>${safeText(`Missing member (${selectedAssigneeId})`)}</option>`);
  }
  return options.join('');
}

export function buildDirectionMaps(blocks, links) {
  const upstream = new Map();
  const downstream = new Map();

  (Array.isArray(blocks) ? blocks : []).forEach((block) => {
    upstream.set(block.id, []);
    downstream.set(block.id, []);
  });

  (Array.isArray(links) ? links : []).forEach((link) => {
    const fromList = downstream.get(link.fromBlockId);
    const toList = upstream.get(link.toBlockId);
    if (fromList) {
      fromList.push(link.toBlockId);
    }
    if (toList) {
      toList.push(link.fromBlockId);
    }
  });

  return { upstream, downstream };
}

export function blockDisplayLabel(blockId, blocks, getTitle) {
  const block = (Array.isArray(blocks) ? blocks : []).find((item) => item.id === blockId);
  if (!block) {
    return `Missing block (${blockId})`;
  }
  const index = blocks.findIndex((item) => item.id === block.id);
  return `Block ${index + 1}: ${getTitle(block)}`;
}
