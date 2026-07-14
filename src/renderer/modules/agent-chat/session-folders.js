import { asArray, trimText } from './shared.js';

export const GENERAL_CHAT_FOLDER_ID = 'general';
const PROJECT_FOLDER_PREFIX = 'project:';
const CUSTOM_FOLDER_PREFIX = 'custom:';

export function buildProjectChatFolderId(projectId = '') {
  const id = trimText(projectId, 120);
  return id ? `${PROJECT_FOLDER_PREFIX}${id}` : '';
}

export function buildCustomChatFolderId(folderId = '') {
  const id = trimText(folderId, 120);
  return id ? `${CUSTOM_FOLDER_PREFIX}${id}` : '';
}

export function ensureAgentChatFolderState(agentChat = {}) {
  const target = agentChat && typeof agentChat === 'object' ? agentChat : {};
  target.folders = asArray(target.folders)
    .map((folder) => ({
      id: trimText(folder?.id, 120),
      name: trimText(folder?.name, 220),
      createdAt: trimText(folder?.createdAt || folder?.created_at, 80)
    }))
    .filter((folder) => folder.id && folder.name);
  target.sessionFolderIds = target.sessionFolderIds && typeof target.sessionFolderIds === 'object' && !Array.isArray(target.sessionFolderIds)
    ? { ...target.sessionFolderIds }
    : {};
  target.selectedFolderId = trimText(target.selectedFolderId, 180) || GENERAL_CHAT_FOLDER_ID;
  target.expandedFolderIds = asArray(target.expandedFolderIds)
    .map((folderId) => trimText(folderId, 180))
    .filter(Boolean);
  return target;
}

export function getAgentChatFolders(state = {}) {
  const projectFolders = asArray(state.projects)
    .map((project) => ({
      id: buildProjectChatFolderId(project?.id),
      sourceId: trimText(project?.id, 120),
      type: 'project',
      name: trimText(project?.name, 220) || 'Untitled project',
      projectId: trimText(project?.id, 120),
      removable: false
    }))
    .filter((folder) => folder.id)
    .sort((left, right) => left.name.localeCompare(right.name));
  const customFolders = asArray(state.agentChat?.folders)
    .map((folder) => ({
      id: buildCustomChatFolderId(folder?.id),
      sourceId: trimText(folder?.id, 120),
      type: 'custom',
      name: trimText(folder?.name, 220) || 'Untitled folder',
      projectId: '',
      removable: true
    }))
    .filter((folder) => folder.id)
    .sort((left, right) => left.name.localeCompare(right.name));
  return [
    {
      id: GENERAL_CHAT_FOLDER_ID,
      sourceId: GENERAL_CHAT_FOLDER_ID,
      type: 'general',
      name: 'General',
      projectId: '',
      removable: false
    },
    ...projectFolders,
    ...customFolders
  ];
}

export function resolveSessionFolderId(state = {}, session = {}) {
  const agentChat = ensureAgentChatFolderState(state.agentChat || {});
  const sessionId = trimText(session?.id || session?.session_id, 120);
  const folders = getAgentChatFolders(state);
  const validFolderIds = new Set(folders.map((folder) => folder.id));
  const assignedFolderId = trimText(agentChat.sessionFolderIds?.[sessionId], 180);
  if (assignedFolderId && validFolderIds.has(assignedFolderId)) {
    return assignedFolderId;
  }
  const projectFolderId = buildProjectChatFolderId(session?.project_id || session?.projectId);
  return projectFolderId && validFolderIds.has(projectFolderId)
    ? projectFolderId
    : GENERAL_CHAT_FOLDER_ID;
}

export function getFolderById(state = {}, folderId = '') {
  const normalizedId = trimText(folderId, 180);
  return getAgentChatFolders(state).find((folder) => folder.id === normalizedId) || null;
}

export function buildDefaultChatFolderName(state = {}) {
  const existingNames = new Set(
    getAgentChatFolders(state)
      .map((folder) => folder.name.toLowerCase())
      .filter(Boolean)
  );
  let suffix = 1;
  while (true) {
    const candidate = suffix === 1 ? 'New Folder' : `New Folder ${suffix}`;
    if (!existingNames.has(candidate.toLowerCase())) {
      return candidate;
    }
    suffix += 1;
  }
}
