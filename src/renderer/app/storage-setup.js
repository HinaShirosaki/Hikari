import { createPresentation } from "../lib/i18n/presentation.js";
import "../lib/i18n/shell.js";
const i18nUi = createPresentation("shell");
import { setShellText } from '../lib/i18n/shell.js';

export function createStorageSetup({ documentObject, windowObject, state, openStorageRoot, onComplete }) {
  const page = documentObject.getElementById('storage-setup-page');
  const appShell = documentObject.querySelector('.app-shell');
  const chooseButton = documentObject.getElementById('storage-setup-choose');
  const status = documentObject.getElementById('storage-setup-status');
  const currentPath = documentObject.getElementById('storage-setup-path');
  let busy = false;

  // Launch with no workspace, or one that could not be reopened (e.g. macOS
  // denied the folder): a clean start page. The reopen failure is already in the
  // error notice/log; a stale path and raw EPERM text here only confuse.
  function show() {
    appShell.hidden = true;
    appShell.inert = true;
    page.hidden = false;
    i18nUi.setText(currentPath, '');
    currentPath.hidden = true;
    i18nUi.setText(status, '');
    status.dataset.error = 'false';
    chooseButton.focus();
  }

  async function chooseFolder() {
    if (busy) return;
    busy = true;
    chooseButton.disabled = true;
    page.setAttribute('aria-busy', 'true');
    i18nUi.setText(status, '');
    status.dataset.error = 'false';
    try {
      const api = windowObject.hikariApi;
      if (typeof api?.pickStorageDirectory !== 'function') {
        throw new Error('The folder picker is unavailable. Restart Hikari and try again.');
      }
      const selected = await api.pickStorageDirectory(state.settings?.storagePath || '');
      if (selected?.canceled) return;
      if (!selected?.ok || !selected.path) {
        throw new Error(selected?.error || 'Could not select the folder. Please try again.');
      }
      i18nUi.setText(currentPath, selected.path);
      currentPath.hidden = false;
      i18nUi.setText(status, i18nUi.message("Opening your workspace…"));
      setShellText(chooseButton, 'setup.opening');
      const result = await openStorageRoot(selected.path);
      if (!result?.ok) throw new Error(result?.error || 'Could not open this folder. Choose another folder or try again.');
      page.hidden = true;
      appShell.hidden = false;
      appShell.inert = false;
      onComplete();
      documentObject.getElementById('topbar-search-toggle')?.focus();
    } catch (error) {
      page.hidden = false;
      appShell.hidden = true;
      appShell.inert = true;
      i18nUi.setText(status, String(error?.message || error));
      status.dataset.error = 'true';
    } finally {
      busy = false;
      chooseButton.disabled = false;
      setShellText(chooseButton, 'setup.choose');
      page.setAttribute('aria-busy', 'false');
      if (!page.hidden) chooseButton.focus();
    }
  }

  chooseButton.addEventListener('click', chooseFolder);
  return { show };
}
