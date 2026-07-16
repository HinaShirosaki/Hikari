// Boots user-installed plugins at app start. Each enabled plugin from
// state.settings.plugins becomes a normal app view (a `.view` section holding
// a sandboxed iframe) plus an APP_REGISTRY entry, so navigation, search, and
// startup-view handling treat plugins exactly like built-in apps.
//
// Must run before createNavigationShell(), which snapshots `.view` sections
// and APP_REGISTRY. Adding or removing a plugin therefore requires an app
// reload (Settings > Plugins offers a Reload App button).

const PLUGIN_ICON_MARKUP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v4" /><path d="M15 4v4" /><path d="M7 8h10v4a5 5 0 0 1-10 0Z" /><path d="M12 17v3" /></svg>';

export function pluginViewId(pluginId) {
  return `plugin-${pluginId}-view`;
}

export function installPlugins({ state, documentObject, appRegistry }) {
  const plugins = Array.isArray(state?.settings?.plugins) ? state.settings.plugins : [];
  const host = documentObject?.querySelector?.('.workspace-main');
  if (!host || !Array.isArray(appRegistry)) {
    return [];
  }

  const installed = [];
  plugins
    .filter((plugin) => plugin.enabled !== false && plugin.entryUrl)
    .forEach((plugin) => {
      const viewId = pluginViewId(plugin.id);
      if (documentObject.getElementById(viewId)) {
        return;
      }

      const section = documentObject.createElement('section');
      section.id = viewId;
      section.className = 'view plugin-view';
      section.setAttribute('aria-label', plugin.name || plugin.id);

      const frame = documentObject.createElement('iframe');
      frame.className = 'plugin-frame';
      frame.src = plugin.entryUrl;
      frame.title = plugin.name || plugin.id;
      // No allow-same-origin: the plugin runs as an opaque origin with no
      // access to the host DOM, localStorage, or the preload bridge.
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
      section.append(frame);
      host.append(section);

      appRegistry.push({
        id: `plugin-${plugin.id}`,
        viewKey: '',
        label: plugin.name || plugin.id,
        viewId,
        subtitle: plugin.description || '',
        icon: '',
        iconMarkup: PLUGIN_ICON_MARKUP,
        placement: 'more',
        aliases: [],
        searchInputId: '',
        agentChatRail: false,
        hiddenFromNavigation: false
      });
      installed.push(viewId);
    });

  return installed;
}
