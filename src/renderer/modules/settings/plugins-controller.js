import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("settings");
import { settingsText, settingsMessage, setSettingsText } from './localization.js';
// Settings > Plugins panel: install from folders/GitHub, enable, and remove.
// Entries live in state.settings.plugins and are booted by
// src/renderer/app/plugin-loader.js on the next app reload.
import { showTransientNotice } from '../../lib/notify.js';
import { createPluginPreferencesController } from './plugin-preferences-controller.js';

export function createPluginsController({
  state,
  persist,
  api,
  statusElement,
  listElement,
  githubUrlInput,
  githubInstallButton,
  addButton,
  reloadButton,
  escapeHtml,
  windowObject = globalThis.window
}) {
  let statusMessage = null;
  let installing = false;
  const preferences = createPluginPreferencesController({ state, persist, windowObject, escapeHtml });

  function getPlugins() {
    if (!Array.isArray(state.settings.plugins)) {
      state.settings.plugins = [];
    }
    return state.settings.plugins;
  }

  function setStatus(message) {
    statusMessage = message || null;
    render();
  }

  // A failed add leaves the panel list unchanged, so the inline line is the only
  // thing that moves — raise the app notice too.
  function setErrorStatus(message) {
    showTransientNotice(message?.key ? settingsText(message.key, message.params) : String(message), {
      type: 'error', ...(message?.key ? { i18nKey: `settings.${message.key}`, i18nParams: message.params } : {})
    });
    setStatus(message);
  }

  async function onAddPlugin() {
    if (installing) return;
    if (!api?.pickStorageDirectory || !api?.inspectPluginFolder) {
      setErrorStatus({ key: 'plugins.unavailable' });
      return;
    }
    const picked = await api.pickStorageDirectory('');
    if (!picked?.ok || !picked.path) {
      return;
    }
    const inspected = await api.inspectPluginFolder(picked.path);
    if (!inspected?.ok) {
      setErrorStatus(inspected?.error || { key: 'plugins.invalid' });
      return;
    }
    registerPlugin(inspected);
  }

  function registerPlugin(inspected) {
    const plugins = getPlugins();
    if (plugins.some((plugin) => plugin.id === inspected.id)) {
      setErrorStatus({ key: 'plugins.duplicate', params: { name: inspected.name } });
      return false;
    }
    plugins.push({
      id: inspected.id,
      name: inspected.name,
      version: inspected.version,
      description: inspected.description,
      permissions: Array.isArray(inspected.permissions) ? inspected.permissions : [],
      settings: inspected.settings || [],
      path: inspected.path,
      entryUrl: inspected.entryUrl,
      embedUrl: inspected.embedUrl || '',
      serve: inspected.serve === true,
      service: inspected.service || null,
      tool: inspected.tool === true,
      // A pasted URL is code the user has not read: its host access starts
      // off until they review the row and turn it on.
      enabled: !inspected.repositoryUrl || !inspected.permissions?.length
    });
    persist();
    setStatus('');
    return true;
  }

  async function onInstallFromGitHub() {
    if (installing) return;
    const url = githubUrlInput?.value.trim() || '';
    if (!url) {
      setErrorStatus({ key: 'plugins.urlRequired' });
      githubUrlInput?.focus();
      return;
    }
    if (!api?.installPluginFromGitHub) {
      setErrorStatus({ key: 'plugins.githubUnavailable' });
      return;
    }
    installing = true;
    setStatus({ key: 'plugins.cloning' });
    try {
      const inspected = await api.installPluginFromGitHub(url, getPlugins().map((plugin) => plugin.id));
      if (!inspected?.ok) {
        setErrorStatus(inspected?.error || { key: 'plugins.installError' });
        return;
      }
      if (registerPlugin(inspected)) {
        githubUrlInput.value = '';
        setStatus(inspected.permissions?.length
          ? { key: 'plugins.installedOff', params: { name: inspected.name } }
          : { key: 'plugins.installed', params: { name: inspected.name } });
      }
    } catch (error) {
      setErrorStatus(error?.message || { key: 'plugins.installError' });
    } finally {
      installing = false;
      render();
    }
  }

  function setPluginEnabled(pluginId, enabled) {
    const plugin = getPlugins().find((entry) => entry.id === pluginId);
    if (!plugin) {
      return;
    }
    plugin.enabled = enabled === true;
    persist();
    setStatus({ key: plugin.enabled ? 'plugins.enabled' : 'plugins.disabled', params: { name: plugin.name } });
  }

  function removePlugin(pluginId) {
    const plugins = getPlugins();
    const index = plugins.findIndex((entry) => entry.id === pluginId);
    if (index < 0) {
      return;
    }
    if (plugins[index].bundled) {
      setStatus({ key: 'plugins.bundledStatus', params: { name: plugins[index].name } });
      return;
    }
    const [removed] = plugins.splice(index, 1);
    persist();
    setStatus({ key: 'plugins.removed', params: { name: removed.name } });
  }

  function render() {
    if (githubUrlInput) githubUrlInput.disabled = installing;
    if (githubInstallButton) {
      githubInstallButton.disabled = installing;
      setSettingsText(githubInstallButton, installing ? 'plugins.installing' : 'plugins.install');
    }
    if (addButton) addButton.disabled = installing;
    if (reloadButton) reloadButton.disabled = installing;
    if (!statusElement || !listElement) {
      return;
    }
    const plugins = getPlugins();
    if (statusMessage?.key) setSettingsText(statusElement, statusMessage.key, statusMessage.params);
    else if (statusMessage) {
      statusElement.removeAttribute?.('data-i18n');
      statusElement.removeAttribute?.('data-i18n-params');
      i18nUi.setOwnedText(statusElement, statusMessage);
    } else setSettingsText(statusElement, 'plugins.count', { count: plugins.length });

    if (!plugins.length) {
      i18nUi.setHtml(listElement, `<p class="small-note">${settingsMessage('plugins.empty')}</p>`);
      return;
    }

    i18nUi.setHtml(listElement, plugins.map((plugin) => `
      <div class="settings-skill-row">
        <div class="settings-skill-main">
          <div class="settings-skill-title">
            <span>${escapeHtml(plugin.name)}${plugin.version ? ` <span class="small-note">v${escapeHtml(plugin.version)}</span>` : ''}</span>
          </div>
          <p class="small-note settings-skill-description">${plugin.description ? escapeHtml(plugin.description) : settingsMessage('plugins.noDescription')}</p>
          <p class="small-note settings-skill-permissions">${plugin.permissions?.length
            ? settingsMessage('plugins.hostAccess', { permissions: plugin.permissions.join(', ') })
            : settingsMessage('plugins.isolated')}</p>
          ${plugin.embedUrl
            ? `<p class="small-note settings-skill-embed">${settingsMessage('plugins.remote', { url: plugin.embedUrl })}</p>`
            : ''}
          ${plugin.tool ? `<p class="small-note settings-skill-tool">${settingsMessage('plugins.tool')}</p>` : ''}
          <p class="small-note settings-skill-path">${plugin.bundled ? settingsMessage('plugins.bundled') : escapeHtml(plugin.path)}</p>
        </div>
        <label class="settings-skill-toggle">
          <input type="checkbox" data-plugin-toggle data-plugin-id="${escapeHtml(plugin.id)}" ${plugin.enabled !== false ? 'checked' : ''} />
          <span>${settingsMessage(plugin.enabled !== false ? 'plugins.on' : 'plugins.off')}</span>
        </label>
        ${plugin.bundled ? '' : `<button type="button" class="danger-btn" data-plugin-remove data-plugin-id="${escapeHtml(plugin.id)}">${settingsMessage('plugins.remove')}</button>`}
        ${preferences.markup(plugin)}
      </div>
    `).join(''));
    preferences.bind(listElement);

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

  return { onAddPlugin, onInstallFromGitHub, render };
}
