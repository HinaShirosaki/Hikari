// Boots user-installed plugins at app start. Each enabled plugin from
// state.settings.plugins becomes a normal app view (a `.view` section holding
// a sandboxed iframe) plus an APP_REGISTRY entry, so navigation, search, and
// startup-view handling treat plugins exactly like built-in apps.
//
// Must run before createNavigationShell(), which snapshots `.view` sections
// and APP_REGISTRY. Adding or removing a plugin therefore requires an app
// reload (Settings > Plugins offers a Reload App button).

import { pluginOrigin } from './plugin-origin.js';

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
// http   -> only 127.0.0.1, which is our own plugin server (plugin-server.js
//           binds there and nowhere else). Non-loopback http is refused so a
//           settings edit cannot point a same-origin frame at a plaintext
//           remote host. `[::1]` is refused with it: index.html's frame-src
//           cannot whitelist an IPv6 literal (CSP host-source has no grammar
//           for one), so such a frame would be blocked by CSP regardless.
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
  return url.protocol === 'http:' && url.hostname === '127.0.0.1';
}

// Asks the main process for a loopback server on this plugin's folder, then
// points the frame at it. Failures are shown in the frame rather than thrown:
// one broken plugin must not take down the rest of the boot.
async function startServedFrame({ frame, plugin, api, showError = true, beforeNavigate = null }) {
  const serve = api?.servePluginFolder;
  if (typeof serve !== 'function') {
    const error = 'Plugin serving is unavailable in this environment.';
    if (showError) {
      frame.srcdoc = `<p style="font:13px system-ui;padding:16px">${error}</p>`;
    }
    return { ok: false, error };
  }
  try {
    const result = await serve(plugin.id, plugin.path);
    if (!result?.ok || !pluginOrigin(result.baseUrl)) {
      throw new Error(result?.error || 'Plugin server returned an unusable address.');
    }
    // about:blank/srcdoc inherits the host origin. Keep the frame opaque until
    // a validated loopback destination is available.
    frame.setAttribute('sandbox', REMOTE_SANDBOX);
    beforeNavigate?.(result.baseUrl);
    frame.src = result.baseUrl;
    return { ok: true, baseUrl: result.baseUrl };
  } catch (error) {
    const message = String(error?.message || error).replace(/[<&]/g, '');
    frame.setAttribute('sandbox', LOCAL_SANDBOX);
    if (showError) {
      frame.srcdoc = `<p style="font:13px system-ui;padding:16px">Could not start this plugin: ${message}</p>`;
    }
    return { ok: false, error: message };
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
function describePlugin(plugin, { isRemote }) {
  const kind = isRemote ? 'Remote plugin' : 'Local plugin';
  const permissions = Array.isArray(plugin.permissions) ? plugin.permissions : [];
  const origin = isRemote && plugin.embedUrl
    ? `loads ${plugin.embedUrl}`
    : 'served locally over 127.0.0.1';
  return [
    `${plugin.name || plugin.id} — ${kind}`,
    origin,
    permissions.length ? `host access: ${permissions.join(', ')}` : 'host access: none'
  ].filter(Boolean).join(', ');
}

// Mounts a service plugin: a hidden loopback-served frame that runs the plugin's
// code with no view, no navigation entry, and no rail. A direct file: frame
// cannot load sibling scripts from an installed folder in packaged Electron,
// so the existing per-plugin loopback server supplies its private origin. The
// frame remains cross-origin from the file: host and may use only manifest-
// declared bridge permissions. It must be in the document to have a
// contentWindow, so it is appended hidden before either registry sees it.
function installServiceFrame({ documentObject, host, plugin, services, bridge, api }) {
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
  host.append(frame);
  const registration = services?.register?.(frame, plugin);
  let serviceNavigationStarted = false;
  frame.addEventListener?.('load', () => {
    // Compatibility for service workers written before `service:ready` was
    // added to the protocol. A document load finishes after classic scripts
    // execute, so its listener is installed by this point.
    if (serviceNavigationStarted) {
      registration?.ready?.();
    }
  });
  void startServedFrame({
    frame,
    plugin,
    api,
    showError: false,
    beforeNavigate: (baseUrl) => {
      registration?.setOrigin?.(baseUrl);
      bridge?.register?.(frame.contentWindow, plugin, baseUrl);
      serviceNavigationStarted = true;
    }
  }).then((result) => {
    if (!result.ok) {
      registration?.fail?.(result.error);
    }
  });
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
        installServiceFrame({ documentObject, host, plugin, services, bridge, api });
        return;
      }

      const viewId = pluginViewId(plugin.id);
      if (documentObject.getElementById(viewId)) {
        return;
      }

      const section = documentObject.createElement('section');
      section.id = viewId;
      section.setAttribute('data-plugin-id', plugin.id);
      section.setAttribute('data-plugin-name', plugin.name || plugin.id);
      section.className = 'view plugin-view';
      section.setAttribute('aria-label', plugin.name || plugin.id);

      // Re-checked here (not just at install) so a hand-edited settings record
      // cannot smuggle a file: URL into a same-origin frame.
      // All folder plugins use loopback delivery regardless of `serve`, which
      // is now a compatibility no-op: file: sandboxed documents cannot load
      // even classic sibling scripts in Electron.
      const isRemote = isSameOriginSafeUrl(plugin.embedUrl);

      const frame = documentObject.createElement('iframe');
      frame.className = 'plugin-frame';
      if (isRemote) {
        frame.src = plugin.embedUrl;
      }
      const summary = describePlugin(plugin, { isRemote });
      frame.title = summary;
      frame.setAttribute('aria-label', summary);
      // Folder frames remain opaque while the server starts. startServedFrame
      // grants their own origin only alongside a validated loopback URL.
      frame.setAttribute('sandbox', isRemote ? REMOTE_SANDBOX : LOCAL_SANDBOX);
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
      if (!isRemote) {
        void startServedFrame({
          frame, plugin, api,
          beforeNavigate: (baseUrl) => bridge?.register?.(frame.contentWindow, plugin, baseUrl)
        });
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
        agentChatRail: !isRemote && Array.isArray(plugin.permissions) && plugin.permissions.includes('agent:chat'),
        hiddenFromNavigation: false
      });
      installed.push(viewId);
    });

  return installed;
}
