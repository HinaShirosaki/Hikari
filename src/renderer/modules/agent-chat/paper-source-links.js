import { mergePaperEvidence } from '../../../shared/paper-evidence.mjs';

function cleanPath(value) {
  const path = String(value || '').trim().replace(/\\/g, '/');
  if (!path || /[\u0000-\u001f]/.test(path) || path.split('/').some(part => part === '.' || part === '..')) return '';
  return path;
}

function paperRelativePath(value) {
  return cleanPath(value).match(/(?:^|\/)(KnowledgeBase\/papers\.md\/.+\.md)$/)?.[1] || '';
}

// Model-authored links are not authority to open files. Only a source already
// returned by the reader can resolve, always against the current storage root.
// Matching the full KB-relative path also repairs older working-directory links.
export function resolvePaperSourceLink(target, blocks, storagePath = '') {
  let value = String(target || '').trim();
  try { value = decodeURIComponent(value); } catch { return null; }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null;
  const match = value.match(/^(.*\.md)(?::([1-9]\d*)(?::[1-9]\d*)?|#L([1-9]\d*)(?:-L?[1-9]\d*)?)?$/i);
  if (!match) return null;
  const relativePath = paperRelativePath(match[1]);
  if (!relativePath) return null;
  const block = mergePaperEvidence(blocks).find(item =>
    paperRelativePath(item.source_path || item.source_absolute_path) === relativePath);
  if (!block) return null;
  const root = cleanPath(storagePath).replace(/\/+$/, '');
  const absolutePath = root && /^(?:\/|[a-z]:\/)/i.test(root)
    ? `${root}/${relativePath}` : cleanPath(block.source_absolute_path);
  if (!/^(?:\/|[a-z]:\/)/i.test(absolutePath) || paperRelativePath(absolutePath) !== relativePath) return null;
  return { path: absolutePath, line: Number(match[2] || match[3]) || 0 };
}

// A follow-up can cite evidence read earlier in this chat without another read.
// Never authorize a source from a later message or a different conversation.
export function getPaperSourceEvidence(message, messages = []) {
  if (!message) return [];
  const index = messages.findIndex(item => item === message || (message.id && item.id === message.id));
  const prior = index < 0 ? [] : messages.slice(0, index)
    .filter(item => item.role === 'assistant')
    .flatMap(item => item.meta?.paper_evidence || []);
  return mergePaperEvidence(prior, message.meta?.paper_evidence);
}

export function createPaperSourceLinkRenderer(message, state, safeText, messages = state.agentChat?.messages || []) {
  let evidence;
  return (target, label) => {
    evidence ||= getPaperSourceEvidence(message, messages);
    const source = resolvePaperSourceLink(target, evidence, state.settings?.storagePath);
    if (!source || !message.id) return '';
    return `<button type="button" class="agent-chat-paper-source" data-agent-paper-source="${safeText(target)}" data-agent-source-message="${safeText(message.id)}" title="${safeText(source.path)}">${label}</button>`;
  };
}
