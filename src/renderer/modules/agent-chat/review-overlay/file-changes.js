function textDiff(before = '', after = '') {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start += 1;
  let end = 0;
  while (end < oldLines.length - start && end < newLines.length - start
    && oldLines[oldLines.length - 1 - end] === newLines[newLines.length - 1 - end]) end += 1;
  return [
    ...oldLines.slice(Math.max(0, start - 2), start).map(line => `  ${line}`),
    ...oldLines.slice(start, oldLines.length - end).map(line => `− ${line}`),
    ...newLines.slice(start, newLines.length - end).map(line => `+ ${line}`),
    ...newLines.slice(newLines.length - end, newLines.length - end + 2).map(line => `  ${line}`)
  ].join('\n');
}

export function renderFileChangePreview(item, safeText) {
  const change = item.change;
  const preview = change.preview;
  const pending = Boolean(preview);
  const recoverable = !change.status || change.status === 'completed';
  const location = change.locationRoot || change.root;
  const folder = change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : '';
  return `<article class="agent-review-card draft-review-document" data-agent-review-card="${safeText(item.id)}">
    <div class="agent-review-card-header draft-review-heading">
      <span class="agent-review-type draft-review-kind">File change · ${safeText(change.action)}</span>
      <h4>${safeText(change.path)}</h4>
      <p>${safeText(location)}${change.destination ? ` → ${safeText(change.destination)}` : ''}</p>
    </div>
    <div class="agent-review-content">
      ${pending ? `<p>${change.action === 'trash' ? `Move ${Number(preview.count)} entries to recoverable trash.` : 'Review this proposed change.'}</p>
        ${preview.binary ? '<p class="small-note">Binary file: text preview unavailable.</p>' : ''}
        ${preview.before || preview.after ? `<pre class="agent-file-diff">${safeText(textDiff(preview.before, preview.after))}</pre>` : ''}
        ${preview.truncated ? '<p class="small-note">Preview shortened. The approval applies to the complete proposed file.</p>' : ''}
        ${preview.count > 1 ? `<ul>${preview.entries.map(entry => `<li>${safeText(entry)}</li>`).join('')}</ul>` : ''}
        ${folder ? `<p class="small-note">Allow in folder remembers only the ${safeText(change.action)} operation for ordinary files below ${safeText(folder)}.</p>` : ''}`
        : `<p>${change.undone ? 'Restored.' : recoverable ? 'Completed. Undo is available if these files have not changed since.'
          : change.status === 'not-applied' ? 'Not applied. The original files are unchanged.'
            : 'Interrupted. Automatic undo is unavailable because the current files do not match the saved change. Inspect the recovery snapshot before restoring manually.'}</p>
          ${!recoverable ? `<p class="small-note">Recovery ID: ${safeText(change.id)}${change.error ? ` · ${safeText(change.error)}` : ''}</p>` : ''}`}
    </div>
    <div class="agent-review-actions draft-review-actions">
      ${pending ? `<button type="button" class="ghost-btn" data-file-decision="deny" data-file-id="${safeText(change.id)}">Deny</button>
        ${folder ? `<button type="button" class="ghost-btn" data-file-decision="folder" data-file-id="${safeText(change.id)}">Allow in folder</button>` : ''}
        <button type="button" class="primary-btn" data-file-decision="once" data-file-id="${safeText(change.id)}">Allow once</button>`
        : change.undone || !recoverable ? '' : `<button type="button" class="ghost-btn" data-file-decision="undo" data-file-id="${safeText(change.id)}">Undo</button>`}
    </div>
  </article>`;
}

export async function decideFileChange(api, rootId, id, decision) {
  return decision === 'undo'
    ? api.agentFilesUndo({ root_id: rootId, id })
    : api.agentFilesReview({ root_id: rootId, id, decision });
}
