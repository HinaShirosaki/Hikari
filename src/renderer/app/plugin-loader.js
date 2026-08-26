// Boots user-installed plugins at app start. Each enabled plugin from
// state.settings.plugins becomes a normal app view (a `.view` section holding
// a sandboxed iframe) plus an APP_REGISTRY entry, so navigation, search, and
// startup-view handling treat plugins exactly like built-in apps.
//
// Must run before createNavigationShell(), which snapshots `.view` sections
// and APP_REGISTRY. Adding or removing a plugin therefore requires an app
// reload (Settings > Plugins offers a Reload App button).

const PLUGIN_ICON_MARKUP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v4" /><path d="M15 4v4" /><path d="M7 8h10v4a5 5 0 0 1-10 0Z" /><path d="M12 17v3" /></svg>';

const LOCAL_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups';
const REMOTE_SANDBOX = `${LOCAL_SANDBOX} allow-same-origin`;

export function pluginViewId(pluginId) {
  return `plugin-${pluginId}-view`;
}

// Origins that may be loaded into a frame carrying allow-same-origin.
//
// The rule is not "is it trusted" but "is it definitely NOT the host's own
// origin". The host runs from file://, so any real scheme-host-port origin is
// safe; a file: URL is not, because it would inherit the host's origin and
// hand the frame the host document. See the sandbox comment in installPlugins().
//
// https  -> remote embeds.
// http   -> only loopback, which is our own plugin server (plugin-server.js
//           binds to 127.0.0.1). Non-loopback http is refused so a settings
//           edit cannot point a same-origin frame at a plaintext remote host.
export function isSameOriginSafeUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    return false;
  }
  if (url.protocol === 'https:') {
    return true;
  }
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '[::1]');
}

// Asks the main process for a loopback server on this plugin's folder, then
// points the frame at it. Failures are shown in the frame rather than thrown:
// one broken plugin must not take down the rest of the boot.
async function startServedFrame({ frame, plugin, api }) {
  const serve = api?.servePluginFolder;
  if (typeof serve !== 'function') {
    frame.srcdoc = '<p style="font:13px system-ui;padding:16px">Plugin serving is unavailable in this environment.</p>';
    return;
  }
  try {
    const result = await serve(plugin.id, plugin.path);
    if (!result?.ok || !isSameOriginSafeUrl(result.baseUrl)) {
      throw new Error(result?.error || 'Plugin server returned an unusable address.');
    }
    frame.src = result.baseUrl;
  } catch (error) {
    frame.srcdoc = `<p style="font:13px system-ui;padding:16px">Could not start this plugin: ${
      String(error?.message || error).replace(/[<&]/g, '')
    }</p>`;
  }
}

// One line describing what this plugin is and what it can reach. It used to be
// a host-drawn rail beside every frame, which cost ~280px of workspace to say
// five static things — and a plugin that draws its own rail (any ported
// workspace does) ended up with two rails, the host's empty one outermost.
//
// The identity now rides on the frame and the registry entry instead: the
// plugin's name is already the topbar title and its dock/more entry, and this
// string is the frame's accessible name and its tooltip. The disclosure that
// gates trust was never the rail anyway — it is the permission list on the
// plugin's row in Settings, shown before the plugin is enabled.
function describePlugin(plugin, { isRemote, isServed }) {
  const kind = isRemote ? 'Remote plugin' : (isServed ? 'Served plugin' : 'Local plugin');
  const permissions = Array.isArray(plugin.permissions) ? plugin.permissions : [];
  const origin = isRemote && plugin.embedUrl
    ? `loads ${plugin.embedUrl}`
    : (isServed ? 'served locally over 127.0.0.1' : '');
  return [
    `${plugin.name || plugin.id} — ${kind}`,
    origin,
    permissions.length ? `host access: ${permissions.join(', ')}` : 'host access: none'
  ].filter(Boolean).join(', ');
}

// Mounts a service plugin: a hidden, opaque-origin frame that runs the
// plugin's code with no view, no navigation entry, and no rail. It answers
// host->service calls (plugin-services.js) and may use only the host API
// permissions declared in its manifest. It must be in the document to have a
// contentWindow, so it is appended hidden before either registry sees it.
function installServiceFrame({ documentObject, host, plugin, services, bridge }) {
  const frameId = `plugin-service-${plugin.id}`;
  if (documentObject.getElementById(frameId)) {
    return;
  }
  const frame = documentObject.createElement('iframe');
  frame.id = frameId;
  frame.className = 'plugin-service-frame';
  frame.hidden = true;
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('sandbox', LOCAL_SANDBOX);
  frame.src = plugin.entryUrl;
  host.append(frame);
  if (bridge && frame.contentWindow) {
    bridge.register(frame.contentWindow, plugin);
  }
  services?.register?.(frame, plugin);
}

export function installPlugins({ state, documentObject, appRegistry, bridge = null, api = null, services = null }) {
  const plugins = Array.isArray(state?.settings?.plugins) ? state.settings.plugins : [];
  const host = documentObject?.querySelector?.('.workspace-main');
  if (!host || !Array.isArray(appRegistry)) {
    return [];
  }

  const installed = [];
  plugins
    .filter((plugin) => plugin.enabled !== false && (plugin.entryUrl || plugin.embedUrl || plugin.serve))
    .forEach((plugin) => {
      // A service has no view: it mounts a hidden frame and is done — no
      // section, no registry entry, no rail.
      if (plugin.service && plugin.entryUrl) {
        installServiceFrame({ documentObject, host, plugin, services, bridge });
        return;
      }

      const viewId = pluginViewId(plugin.id);
      if (documentObject.getElementById(viewId)) {
        return;
      }

      const section = documentObject.createElement('section');
      section.id = viewId;
      section.className = 'view plugin-view';
      section.setAttribute('aria-label', plugin.name || plugin.id);

      // Re-checked here (not just at install) so a hand-edited settings record
      // cannot smuggle a file: URL into a same-origin frame.
      const isRemote = isSameOriginSafeUrl(plugin.embedUrl);
      // A served plugin has no URL yet — the loopback server is started
      // asynchronously below and its src is assigned on arrival.
      const isServed = !isRemote && plugin.serve === true;

      const frame = documentObject.createElement('iframe');
      frame.className = 'plugin-frame';
      if (!isServed) {
        frame.src = isRemote ? plugin.embedUrl : plugin.entryUrl;
      }
      const summary = describePlugin(plugin, { isRemote, isServed });
      frame.title = summary;
      frame.setAttribute('aria-label', summary);
      // Plain local plugins get no allow-same-origin, so they run as an opaque
      // origin with no access to the host DOM, localStorage, or the preload
      // bridge — and, as a consequence, no storage of their own either.
      //
      // Remote and served frames do get it, safely, because their origin is
      // then their own (a remote host, or 127.0.0.1:port) and not the host's.
      // Real apps need storage: an opaque origin denies IndexedDB outright, and
      // a WebAssembly runtime cannot start without it. This flag would be
      // catastrophic on a file:// entry, which is why it is gated on the origin
      // check above and never on a manifest field alone.
      frame.setAttribute('sandbox', (isRemote || isServed) ? REMOTE_SANDBOX : LOCAL_SANDBOX);
      if (isRemote) {
        frame.setAttribute('referrerpolicy', 'no-referrer');
      }

      // The frame gets the whole workspace pane, with no host chrome around it.
      //
      // It used to be wrapped in the shared left-rail template with a host-drawn
      // rail, on the theory that a plugin should read as a real workspace rather
      // than a bare iframe. That was backwards for any plugin that *is* a
      // workspace: a ported view brings its own rail, so the host's sat outside
      // it holding five lines of static text, and the real rail — the one with
      // the controls — was pushed 280px inward. Two rails, and the empty one
      // outermost.
      //
      // A plugin lays out its own page, exactly like a built-in view does. What
      // the host owes it is the pane, not a frame around the frame.
      const main = documentObject.createElement('div');
      main.className = 'plugin-view__main';
      main.append(frame);

      section.append(main);
      host.append(section);

      // The section and registry entry must exist synchronously (the shell
      // snapshots both), but the src can arrive later — so the loopback server
      // is started off the critical path.
      if (isServed) {
        startServedFrame({ frame, plugin, api });
      }

      // contentWindow only exists once the frame is in the document. Register
      // it so plugin-bridge.js can map inbound messages back to this record.
      // Remote frames are never registered: third-party code gets no host API.
      if (bridge && !isRemote && frame.contentWindow) {
        bridge.register(frame.contentWindow, plugin);
      }

      appRegistry.push({
        id: `plugin-${plugin.id}`,
        viewKey: '',
        label: plugin.name || plugin.id,
        viewId,
        subtitle: plugin.description || '',
        icon: plugin.bundled === true ? String(plugin.icon || '') : '',
        // Only source-owned bundled definitions may inject host SVG markup.
        // Installed plugin manifests are untrusted and always keep the generic
        // plug icon so an SVG cannot execute in the host document.
        iconMarkup: plugin.bundled === true && String(plugin.iconMarkup || '').trim()
          ? String(plugin.iconMarkup).trim()
          : PLUGIN_ICON_MARKUP,
        placement: plugin.bundled === true && plugin.placement === 'dock' ? 'dock' : 'more',
        aliases: plugin.bundled === true && Array.isArray(plugin.aliases)
          ? [...plugin.aliases]
          : [],
        searchInputId: '',
        agentChatRail: false,
        hiddenFromNavigation: false
      });
      installed.push(viewId);
    });

  return installed;
}
