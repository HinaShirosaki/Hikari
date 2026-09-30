export function renderFileChangePreview(item, safeText) {
  const change = item.change;
  const preview = change.preview;
  const folder = change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : '';
  const labels = { create: 'Create file', write: 'Edit file', mkdir: 'Create folder', move: 'Move', trash: 'Move to trash' };
  const location = change.location_id && change.location_id !== 'workspace' ? 'Granted folder' : 'Workspace';
  const count = Number(preview?.count || 0);
  return `<article class="agent-review-card draft-review-document file-change-approval" data-agent-review-card="${safeText(item.id)}">
    <div class="agent-review-card-header draft-review-heading">
      <span class="agent-review-type draft-review-kind">${safeText(labels[change.action] || 'File change')}</span>
      <h4>${safeText(change.path)}</h4>
      ${change.destination ? `<p>To ${safeText(change.destination)}</p>` : ''}
      <p>${location}${count > 1 ? ` · ${count} items` : ''}</p>
    </div>
    <div class="agent-review-actions draft-review-actions">
      <button type="button" class="ghost-btn" data-file-decision="deny" data-file-id="${safeText(change.id)}">Deny</button>
      ${folder ? `<button type="button" class="ghost-btn" data-file-decision="folder" data-file-id="${safeText(change.id)}">Allow for folder</button>` : ''}
      <button type="button" class="primary-btn" data-file-decision="once" data-file-id="${safeText(change.id)}">Allow once</button>
    </div>
  </article>`;
}

export function fileDecisionMessage(decision) {
  return decision === 'deny' ? 'File change denied.' : 'File change applied.';
}

export async function decideFileChange(api, rootId, id, decision) {
  return api.agentFilesReview({ root_id: rootId, id, decision });
}
