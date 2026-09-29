import { renderFileChangePreview, decideFileChange } from '../agent-chat/review-overlay/file-changes.js';

export function createFileAccessSettings({ api, element, escapeHtml }) {
  let snapshot = null;
  let revision = 0;
  let busy = false;
  let message = '';
  async function render() {
    if (!element || !api?.agentFilesStatus) return;
    const request = ++revision;
    try {
      const result = await api.agentFilesStatus();
      if (request !== revision) return;
      snapshot = result;
      if (!result.ok) {
        element.innerHTML = `<p class="small-note" role="status">${escapeHtml(result.error || 'Choose a storage folder first.')}</p>`;
        return;
      }
      element.innerHTML = `<h4>Agent file access</h4>
        <p class="small-note">${escapeHtml(result.root)}</p>
        <label>Access mode <select data-file-mode aria-label="Agent file access">
          <option value="read-only" ${result.mode === 'read-only' ? 'selected' : ''}>Read only · review changes</option>
          <option value="workspace-write" ${result.mode === 'workspace-write' ? 'selected' : ''}>Workspace access</option>
        </select></label>
        <p class="small-note">Workspace access allows ordinary file creation, edits and moves. Deletion needs review unless you allow it for a folder. Hikari records use their existing tools.</p>
        <div class="form-actions">
          <button type="button" class="ghost-btn" data-file-add-location>Add another folder</button>
          <button type="button" class="ghost-btn" data-file-revoke>Revoke grants</button>
        </div>
        ${result.locations.length ? `<p class="small-note">Additional folders use the same mode: ${result.locations.map(item => escapeHtml(item.root)).join(', ')}</p>` : ''}
        ${result.folders.length ? `<p class="small-note">Remembered operations: ${result.folders.map(item => `${escapeHtml(item.action)} in ${escapeHtml(item.path)}`).join(', ')}</p>` : ''}
        <p class="small-note" role="status">${escapeHtml(message)}</p>
        <details ${result.pending.length ? 'open' : ''}><summary>File changes · ${result.pending.length} pending</summary>
          <p class="small-note">Recent 50 changes. Recovery snapshots: ${escapeHtml(result.recovery_directory)}</p>
          ${[...result.pending, ...result.history].map(change => renderFileChangePreview({ id: change.id, change }, escapeHtml)).join('') || '<p class="small-note">No file changes yet.</p>'}
        </details>`;
    } catch (error) {
      if (request === revision) element.innerHTML = `<p role="status">${escapeHtml(error.message)}</p>`;
    }
  }
  async function act(action) {
    if (busy || !snapshot?.ok) return;
    busy = true;
    element.querySelectorAll('button, select').forEach(control => { control.disabled = true; });
    try {
      const result = await action(snapshot.root_id);
      message = result?.ok === false ? result.error : result?.cancelled ? '' : result?.warning || 'Updated. New permissions apply to the next agent turn.';
    } catch (error) { message = error.message; }
    finally { busy = false; await render(); }
  }
  element?.addEventListener('change', event => {
    if (event.target?.matches?.('[data-file-mode]')) {
      const mode = event.target.value;
      void act(rootId => api.agentFilesSettings({ root_id: rootId, action: 'mode', mode }));
    }
  });
  element?.addEventListener('click', event => {
    const button = event.target?.closest?.('button');
    if (!button) return;
    if (button.hasAttribute('data-file-revoke')) void act(rootId => api.agentFilesSettings({ root_id: rootId, action: 'revoke' }));
    else if (button.hasAttribute('data-file-add-location')) void act(rootId => api.agentFilesAddLocation({ root_id: rootId }));
    else if (button.dataset.fileDecision) void act(rootId => decideFileChange(api, rootId, button.dataset.fileId, button.dataset.fileDecision));
  });
  api?.onAgentFilesChanged?.(() => { if (!busy) void render(); });
  return { render };
}
