// Settings > Plugins panel: add, enable/disable, and remove plugin folders.
// Entries live in state.settings.plugins and are booted by
// src/renderer/app/plugin-loader.js on the next app reload.
export function createPluginsController({
  state,
  persist,
  api,
  statusElement,
  listElement,
  escapeHtml
}) {
  let statusMessage = '';
  let pendingReload = false;

  function getPlugins() {
    if (!Array.isArray(state.settings.plugins)) {
      state.settings.plugins = [];
    }
    return state.settings.plugins;
  }

  function setStatus(message, needsReload = false) {
    statusMessage = String(message || '');
    pendingReload = pendingReload || needsReload;
    render();
  }

  async function onAddPlugin() {
    if (!api?.pickStorageDirectory || !api?.inspectPluginFolder) {
      setStatus('Plugin management is unavailable in this environment.');
      return;
    }
    const picked = await api.pickStorageDirectory('');
    if (!picked?.ok || !picked.path) {
      return;
    }
    const inspected = await api.inspectPluginFolder(picked.path);
    if (!inspected?.ok) {
      setStatus(inspected?.error || 'Selected folder is not a valid plugin.');
      return;
    }
    const plugins = getPlugins();
    if (plugins.some((plugin) => plugin.id === inspected.id)) {
      setStatus(`A plugin named "${inspected.name}" is already installed.`);
      return;
    }
    plugins.push({
      id: inspected.id,
      name: inspected.name,
      version: inspected.version,
      description: inspected.description,
      permissions: Array.isArray(inspected.permissions) ? inspected.permissions : [],
      path: inspected.path,
      entryUrl: inspected.entryUrl,
      embedUrl: inspected.embedUrl || '',
      serve: inspected.serve === true,
      enabled: true
    });
    persist();
    setStatus(`Added "${inspected.name}".`, true);
  }

  function setPluginEnabled(pluginId, enabled) {
    const plugin = getPlugins().find((entry) => entry.id === pluginId);
    if (!plugin) {
      return;
    }
    plugin.enabled = enabled === true;
    persist();
    setStatus(`${plugin.enabled ? 'Enabled' : 'Disabled'} "${plugin.name}".`, true);
  }

  function removePlugin(pluginId) {
    const plugins = getPlugins();
    const index = plugins.findIndex((entry) => entry.id === pluginId);
    if (index < 0) {
      return;
    }
    const [removed] = plugins.splice(index, 1);
    persist();
    setStatus(`Removed "${removed.name}". The plugin folder itself was not deleted.`, true);
  }

  function render() {
    if (!statusElement || !listElement) {
      return;
    }
    const plugins = getPlugins();
    const reloadNote = pendingReload ? ' Reload the app to apply plugin changes.' : '';
    statusElement.textContent = statusMessage
      ? `${statusMessage}${reloadNote}`
      : `${plugins.length} plugin${plugins.length === 1 ? '' : 's'} installed.${reloadNote}`;

    if (!plugins.length) {
      listElement.innerHTML = '<p class="small-note">No plugins installed. Click "Add Plugin Folder" to install one.</p>';
      return;
    }

    listElement.innerHTML = plugins.map((plugin) => `
      <div class="settings-skill-row">
        <div class="settings-skill-main">
          <div class="settings-skill-title">
            <span>${escapeHtml(plugin.name)}${plugin.version ? ` <span class="small-note">v${escapeHtml(plugin.version)}</span>` : ''}</span>
          </div>
          <p class="small-note settings-skill-description">${escapeHtml(plugin.description || 'No description provided.')}</p>
          <p class="small-note settings-skill-permissions">${plugin.permissions?.length
            ? `Host access: ${escapeHtml(plugin.permissions.join(', '))}`
            : 'Host access: none (isolated page)'}</p>
          ${plugin.embedUrl
            ? `<p class="small-note settings-skill-embed">Loads remote code from ${escapeHtml(plugin.embedUrl)} — needs internet, and anything you open in it leaves this machine.</p>`
            : ''}
          <p class="small-note settings-skill-path">${escapeHtml(plugin.path)}</p>
        </div>
        <label class="settings-skill-toggle">
          <input type="checkbox" data-plugin-toggle data-plugin-id="${escapeHtml(plugin.id)}" ${plugin.enabled !== false ? 'checked' : ''} />
          <span>${plugin.enabled !== false ? 'On' : 'Off'}</span>
        </label>
        <button type="button" class="danger-btn" data-plugin-remove data-plugin-id="${escapeHtml(plugin.id)}">Remove</button>
      </div>
    `).join('');

    listElement.querySelectorAll('[data-plugin-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        setPluginEnabled(input.dataset.pluginId, input.checked === true);
      });
    });
    listElement.querySelectorAll('[data-plugin-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        removePlugin(button.dataset.pluginId);
      });
    });
  }

  return { onAddPlugin, render };
}
