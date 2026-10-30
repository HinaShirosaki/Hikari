import "./localization.js";
import { createPresentation } from "../../lib/i18n/presentation.js";
const i18nUi = createPresentation("settings");
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
        i18nUi.setHtml(element, `<p class="small-note" role="status">${i18nUi.render((result.error || i18nUi.message("Choose a storage folder first.")))}</p>`);
        return;
      }
      i18nUi.setHtml(element, `<h4>${i18nUi.html("Agent file access")}</h4>
        <p class="small-note">${escapeHtml(result.root)}</p>
        <label>${i18nUi.html("Access mode")} <select data-file-mode ${i18nUi.attribute("aria-label", "Agent file access")}>
          <option value="read-only" ${result.mode === 'read-only' ? 'selected' : ''} data-i18n="settings.full.4ccc5fe9">Read only · review changes</option>
          <option value="workspace-write" ${result.mode === 'workspace-write' ? 'selected' : ''} data-i18n="settings.full.5621b4c4">Workspace access</option>
        </select></label>
        <p class="small-note">${i18nUi.html("Workspace access allows ordinary file creation, edits and moves. Deletion needs review unless you allow it for a folder. Hikari records use their existing tools.")}</p>
        <div class="form-actions">
          <button type="button" class="ghost-btn" data-file-add-location>${i18nUi.html("Add another folder")}</button>
          <button type="button" class="ghost-btn" data-file-revoke>${i18nUi.html("Revoke grants")}</button>
        </div>
        ${result.locations.length ? `<p class="small-note">${i18nUi.html("Additional folders use the same mode:")} ${result.locations.map(item => escapeHtml(item.root)).join(', ')}</p>` : ''}
        ${result.folders.length ? `<p class="small-note">${i18nUi.html("Remembered operations:")} ${result.folders.map(item => `${escapeHtml(item.action)} in ${escapeHtml(item.path)}`).join(', ')}</p>` : ''}
        ${result.pending.length ? `<p class="small-note">${result.pending.length} ${i18nUi.html("file")} ${i18nUi.render((result.pending.length === 1 ? i18nUi.message("change is") : i18nUi.message("changes are")))} ${i18nUi.html("waiting for approval in Agent Chat.")}</p>` : ''}
        <p class="small-note" role="status">${escapeHtml(message)}</p>`);
    } catch (error) {
      if (request === revision) i18nUi.setHtml(element, `<p role="status">${escapeHtml(error.message)}</p>`);
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
  });
  api?.onAgentFilesChanged?.(() => { if (!busy) void render(); });
  return { render };
}
