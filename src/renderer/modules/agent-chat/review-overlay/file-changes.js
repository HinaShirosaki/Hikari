import "../localization.js";
import { agentMessage, agentUi } from '../localization.js';

export function renderFileChangePreview(item, safeText) {
  const change = item.change;
  const preview = change.preview;
  const folder = change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : '';
  const labels = { create: 'file.create', write: 'file.write', mkdir: 'file.mkdir', move: 'file.move', trash: 'file.trash' };
  const location = agentMessage(change.location_id && change.location_id !== 'workspace' ? 'file.granted' : 'file.workspace');
  const count = Number(preview?.count || 0);
  return `<article class="agent-review-card draft-review-document file-change-approval" data-agent-review-card="${safeText(item.id)}">
    <div class="agent-review-card-header draft-review-heading">
      <span class="agent-review-type draft-review-kind">${agentMessage(labels[change.action] || 'file.change')}</span>
      <h4>${safeText(change.path)}</h4>
      ${change.destination ? `<p>${agentMessage('file.to', { path: change.destination })}</p>` : ''}
      <p>${location}${count > 1 ? ` · ${agentMessage('file.items', { count })}` : ''}</p>
    </div>
    <div class="agent-review-actions draft-review-actions">
      <button type="button" class="ghost-btn" data-file-decision="deny" data-file-id="${safeText(change.id)}">${agentMessage('file.deny')}</button>
      ${folder ? `<button type="button" class="ghost-btn" data-file-decision="folder" data-file-id="${safeText(change.id)}">${agentMessage('file.allowFolder')}</button>` : ''}
      <button type="button" class="primary-btn" data-file-decision="once" data-file-id="${safeText(change.id)}">${agentMessage('file.allowOnce')}</button>
    </div>
  </article>`;
}

export function fileDecisionMessage(decision) {
  return agentUi(decision === 'deny' ? 'notice.fileDenied' : 'notice.fileApplied');
}

export async function decideFileChange(api, rootId, id, decision) {
  return api.agentFilesReview({ root_id: rootId, id, decision });
}
