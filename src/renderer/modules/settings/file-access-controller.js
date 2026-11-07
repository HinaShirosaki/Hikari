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
        <p class="small-note">${i18nUi.html("Grant read access to additional folders. Set Codex permissions in Agent chat.")}</p>
        <div class="form-actions">
          <button type="button" class="ghost-btn" data-file-add-location>${i18nUi.html("Add another folder")}</button>
          <button type="button" class="ghost-btn" data-file-revoke>${i18nUi.html("Revoke grants")}</button>
        </div>
        ${result.locations.length ? `<p class="small-note">${result.locations.map(item => escapeHtml(item.root)).join(', ')}</p>` : ''}
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
  element?.addEventListener('click', event => {
    const button = event.target?.closest?.('button');
    if (!button) return;
    if (button.hasAttribute('data-file-revoke')) void act(rootId => api.agentFilesSettings({ root_id: rootId, action: 'revoke' }));
    else if (button.hasAttribute('data-file-add-location')) void act(rootId => api.agentFilesAddLocation({ root_id: rootId }));
  });
  api?.onAgentFilesChanged?.(() => { if (!busy) void render(); });
  return { render };
}
