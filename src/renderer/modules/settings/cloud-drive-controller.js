export function createCloudDriveController({ document, windowObject, state, runCloudSync, onStoragePathSaved }) {
  const api = windowObject?.hikariApi;
  const element = document?.getElementById('setting-cloud-drives');
  const dialog = document?.getElementById('cloud-drive-sync-dialog');
  if (!element || !api?.getCloudDriveStatus) return { refresh: async () => {} };
  const busy = new Set();
  const choices = new Map();
  const conflicts = new Map();
  const messages = new Map();
  let generation = 0;
  let latestStatus;
  let syncing = false;
  let canApply = () => false;
  const rows = [...element.querySelectorAll('[data-cloud-provider]')];
  const text = (row, selector, value) => { row.querySelector(selector).textContent = value; };

  function render(status) {
    latestStatus = status;
    for (const row of rows) {
      const provider = row.dataset.cloudProvider;
      const item = status.providers?.find(item => item.id === provider);
      if (!item) continue;
      const pending = busy.has(provider);
      row.setAttribute('aria-busy', String(pending || item.phase === 'syncing'));
      text(row, '[data-cloud-account]', item.connected ? `Signed in as ${item.account || item.name}` : 'Not signed in');
      text(row, '[data-cloud-workspace]', item.workspace ? `Cloud workspace: ${item.workspace.name}` : '');
      const select = row.querySelector('select');
      const linkControls = row.querySelector('[data-cloud-link-controls]');
      linkControls.hidden = !item.connected || Boolean(item.workspace);
      const providerChoices = choices.get(provider);
      if (providerChoices && select.dataset.loaded !== providerChoices.key) {
        const selected = select.value;
        select.replaceChildren();
        const newOption = document.createElement('option');
        newOption.value = ''; newOption.textContent = 'Create a new cloud workspace'; select.appendChild(newOption);
        for (const workspace of providerChoices.workspaces) {
          const option = document.createElement('option'); option.value = workspace.id; option.textContent = workspace.name;
          select.appendChild(option);
        }
        if ([...select.options].some(option => option.value === selected)) select.value = selected;
        select.dataset.loaded = providerChoices.key;
      }
      select.disabled = pending || !providerChoices;
      for (const button of row.querySelectorAll('[data-cloud-action]')) {
        const action = button.dataset.cloudAction;
        button.hidden = action === 'connect' ? item.connected || item.signingIn
          : action === 'cancel' ? !item.signingIn
          : action === 'disconnect' ? !item.connected
          : ['sync', 'unlink'].includes(action) ? !item.workspace
          : false;
        button.disabled = action === 'cancel' ? false : pending || item.phase === 'syncing'
          || (action === 'connect' && (!item.configured || !item.secureStorage))
          || (action === 'link' && (!status.storagePath || !providerChoices));
      }
      const conflict = conflicts.get(provider);
      const conflictPanel = row.querySelector('[data-cloud-conflicts]');
      conflictPanel.hidden = !conflict;
      if (conflict) {
        const list = conflictPanel.querySelector('ul');
        list.replaceChildren(...conflict.paths.slice(0, 8).map(file => {
          const item = document.createElement('li'); item.textContent = file; return item;
        }));
        text(row, '[data-cloud-conflict-count]', `${conflict.paths.length} conflicting file${conflict.paths.length === 1 ? '' : 's'}. Choose which changes to keep. Previous cloud versions and replaced local files are retained.`);
      }
      let message = messages.get(provider) || item.error || '';
      if (!message) {
        if (!item.configured) message = `${item.name} sign-in is unavailable in this build.`;
        else if (!item.secureStorage) message = 'The OS credential store must be available to sign in.';
        else if (item.signingIn) message = 'Complete sign-in in your browser.';
        else if (item.phase === 'syncing') message = 'Uploading saved changes…';
        else if (item.phase === 'updates') message = 'Cloud updates are available. Sync now to download them.';
        else if (item.phase === 'conflicts') message = 'Changes on both devices need review. Select Sync now.';
        else if (item.lastSyncedAt) message = `Last synced ${new Date(item.lastSyncedAt).toLocaleString()}`;
        else if (item.workspace) message = 'Ready to sync.';
      }
      text(row, '[data-cloud-status]', message);
    }
  }
  async function refresh() {
    const request = ++generation;
    try {
      const status = await api.getCloudDriveStatus();
      if (request !== generation) return;
      if (!status?.ok) throw new Error(status?.error || 'Could not read cloud drive status.');
      render(status);
    } catch (error) {
      if (request !== generation) return;
      for (const row of rows) text(row, '[data-cloud-status]', error.message);
    }
  }
  async function loadChoices(provider) {
    const result = await api.listCloudWorkspaces(provider);
    if (!result?.ok) throw new Error(result?.error || 'Could not list cloud workspaces.');
    choices.set(provider, { key: String(Date.now()), workspaces: result.workspaces || [] });
  }
  async function sync(provider, resolution = '') {
    if (syncing) return;
    if (typeof runCloudSync !== 'function') throw new Error('Workspace sync is unavailable.');
    syncing = true;
    const root = String(state.settings?.storagePath || '');
    dialog?.showModal();
    try {
      await runCloudSync(async (guard = {}) => {
        canApply = () => guard.canApply?.() === true && String(state.settings?.storagePath || '') === root;
        const result = await api.syncCloudWorkspace({ provider, resolution, conflictId: conflicts.get(provider)?.id || '' });
        if (String(state.settings?.storagePath || '') !== root) throw new Error('Workspace changed during sync. Open the current workspace again.');
        if (result?.conflicts) {
          conflicts.set(provider, { paths: result.conflicts, id: result.conflictId });
          messages.delete(provider);
          return;
        }
        if (result?.downloaded || result?.localFilesChanged) {
          const reloaded = await onStoragePathSaved(root, { resetWorkspace: canApply(), cloudSync: true });
          if (!reloaded?.ok) throw new Error(reloaded?.error || 'Cloud changes were saved. Reopen the workspace to reload them.');
          windowObject.dispatchEvent(new Event('hikari:storage-changed'));
        }
        if (!result?.ok) throw new Error(result?.error || 'Cloud sync failed.');
        conflicts.delete(provider);
        messages.delete(provider);
      });
    } finally { syncing = false; canApply = () => false; dialog?.close(); }
  }
  async function action(provider, operation, row) {
    if (operation === 'cancel') { await api.cancelCloudDriveLogin(provider); return; }
    if (busy.has(provider)) return;
    busy.add(provider);
    messages.delete(provider);
    if (latestStatus) render(latestStatus);
    try {
      let result;
      if (operation === 'connect') {
        messages.set(provider, 'Complete sign-in in your browser.');
        result = await api.connectCloudDrive(provider);
        if (result?.ok) { messages.delete(provider); await loadChoices(provider); }
      } else if (operation === 'disconnect') {
        result = await api.disconnectCloudDrive(provider);
        choices.delete(provider); conflicts.delete(provider);
      } else if (operation === 'refresh') {
        await loadChoices(provider);
      } else if (operation === 'link') {
        result = await api.linkCloudWorkspace({ provider, workspaceId: row.querySelector('select').value });
        if (result?.ok) await sync(provider);
      } else if (operation === 'unlink') {
        result = await api.unlinkCloudWorkspace(provider);
        conflicts.delete(provider);
        await loadChoices(provider);
      } else if (operation === 'sync' || operation === 'keep-local' || operation === 'keep-cloud') {
        await sync(provider, operation === 'keep-local' ? 'local' : operation === 'keep-cloud' ? 'cloud' : '');
      }
      if (result?.ok === false) throw new Error(result.error || 'Cloud drive operation failed.');
    } catch (error) { messages.set(provider, error.message); }
    finally { busy.delete(provider); await refresh(); }
  }
  element.addEventListener('click', event => {
    const button = event.target.closest('[data-cloud-action]');
    const row = button?.closest('[data-cloud-provider]');
    if (!button || !row || button.disabled) return;
    void action(row.dataset.cloudProvider, button.dataset.cloudAction, row);
  });
  dialog?.addEventListener('cancel', event => { if (syncing) event.preventDefault(); });
  api.onCloudDriveChanged?.(() => {
    for (const row of rows) if (!busy.has(row.dataset.cloudProvider)) messages.delete(row.dataset.cloudProvider);
    void refresh();
  });
  api.onCloudDriveSyncCheck?.(request => {
    api.respondToCloudDriveSyncCheck?.({ id: request.id, ready: syncing && canApply() });
  });
  windowObject.addEventListener('hikari:storage-changed', () => {
    conflicts.clear(); messages.clear(); void refresh();
  });
  void refresh().then(async () => {
    for (const item of latestStatus?.providers || []) {
      if (item.connected && !item.workspace) {
        try { await loadChoices(item.id); } catch (error) { messages.set(item.id, error.message); }
      }
    }
    if (latestStatus) render(latestStatus);
  });
  return { refresh };
}
