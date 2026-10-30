import { BLOCK_TYPES } from './constants.js';
import { workflowText } from './localization.js';

export function protocolNameById(state, protocolId) {
  const protocol = (state.protocols || []).find((item) => item.id === protocolId);
  return protocol?.name || workflowText('missing.protocol', { id: protocolId });
}

export function blockTypeLabel(block, getBlockType) {
  return workflowText(getBlockType(block) === BLOCK_TYPES.TEXT ? 'type.text' : 'type.protocol');
}

export function blockTitle(block, options = {}) {
  const getBlockType = options?.getBlockType;
  const protocolNameResolver = options?.protocolNameById;
  if (typeof getBlockType === 'function' && getBlockType(block) === BLOCK_TYPES.TEXT) {
    // This title is also used in persisted notebook metadata and folder names.
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
    return workflowText('option.unassigned');
  }
  return memberNameById(state, normalizedId) || workflowText('missing.member', { id: normalizedId });
}

export function projectNameById(state, projectId) {
  const project = (state.projects || []).find((item) => item.id === projectId);
  return project?.name || workflowText('missing.project', { id: projectId });
}

export function notebookEntryLabel(entry, formatTimestamp) {
  const message = notebookEntryDescriptor(entry, formatTimestamp);
  return workflowText(message.key, message.params);
}

export function notebookEntryDescriptor(entry, formatTimestamp) {
  const type = entry.notebookType === 'biology' ? 'biology' : 'synthesis';
  const notebookState = String(entry?.notebookState || '').trim().toLowerCase();
  const status = notebookState === 'suggested' || notebookState === 'planned' ? notebookState : 'executed';
  return { key: `notebook.${type}.${status}`, params: {
    protocol: String(entry.protocolName || entry.protocolId || 'Notebook Page').trim(),
    timestamp: formatTimestamp(entry.updatedAt)
  } };
}

export function buildAssigneeOptions(state, safeText, selectedAssigneeId = '') {
  const options = ['<option value="" data-i18n="workflow.option.unassigned">Unassigned</option>'];
  (state.members || []).forEach((member) => {
    const selectedAttr = member.id === selectedAssigneeId ? ' selected' : '';
    options.push(`<option value="${safeText(member.id)}"${selectedAttr}>${safeText(member.name)}</option>`);
  });
  if (selectedAssigneeId && !(state.members || []).some((member) => member.id === selectedAssigneeId)) {
    options.push(`<option value="${safeText(selectedAssigneeId)}" selected data-i18n="workflow.missing.member" data-i18n-params="${safeText(JSON.stringify({ id: selectedAssigneeId }))}">${safeText(workflowText('missing.member', { id: selectedAssigneeId }))}</option>`);
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
    return workflowText('missing.block', { id: blockId });
  }
  const index = blocks.findIndex((item) => item.id === block.id);
  return workflowText('block.title', { index: index + 1, title: getTitle(block) });
}
