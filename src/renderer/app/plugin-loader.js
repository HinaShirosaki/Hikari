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

// Builds the host-owned rail shown beside every plugin frame. It carries the
// plugin's identity and, crucially, what it can reach — kind and host access —
// so the user always knows what they are looking at. The frame is isolated and
// cannot contribute here; a plugin that wants its own navigation draws it
// inside its page, in the main pane.
function buildPluginRail(documentObject, plugin, { isRemote, isServed }) {
  const rail = documentObject.createElement('aside');
  rail.className = 'plugin-rail app-left-rail left-rail-template__rail';
  rail.setAttribute('data-sync-left-rail', '');
  rail.setAttribute('aria-label', `${plugin.name || plugin.id} details`);

  const group = documentObject.createElement('div');
  group.className = 'app-left-rail-section plugin-rail__section';

  const addLine = (className, text) => {
    const el = documentObject.createElement('p');
    el.className = className;
    el.textContent = text;
    group.append(el);
  };

  const title = documentObject.createElement('h2');
  title.className = 'plugin-rail__title';
  title.textContent = plugin.name || plugin.id;
  group.append(title);

  const kind = documentObject.createElement('span');
  kind.className = 'plugin-rail__kind';
  kind.textContent = isRemote ? 'Remote plugin' : (isServed ? 'Served plugin' : 'Local plugin');
  group.append(kind);

  if (plugin.description) {
    addLine('plugin-rail__description small-note', plugin.description);
  }

  const permissions = Array.isArray(plugin.permissions) ? plugin.permissions : [];
  addLine(
    'plugin-rail__access small-note',
    permissions.length ? `Host access: ${permissions.join(', ')}` : 'Host access: none'
  );

  if (isRemote && plugin.embedUrl) {
    addLine('plugin-rail__origin small-note', `Loads ${plugin.embedUrl}`);
  } else if (isServed) {
    addLine('plugin-rail__origin small-note', 'Served locally over 127.0.0.1');
  }

  rail.append(group);
  return rail;
}

// Mounts a service plugin: a hidden, opaque-origin frame that runs the
// plugin's code with no view, no navigation entry, and no rail. It exists only
// to answer host->service calls (plugin-services.js). It must be in the
// document to have a contentWindow, so it is appended hidden.
function installServiceFrame({ documentObject, host, plugin, services }) {
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
        installServiceFrame({ documentObject, host, plugin, services });
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
      frame.title = plugin.name || plugin.id;
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

      // Every plugin view carries the shared left-rail shape, so it reads as a
      // real workspace rather than a bare iframe. The rail is host chrome (the
      // sandboxed frame cannot draw into it), so it is drawn here and cannot be
      // opted out of — that is what makes the shape mandatory. `data-sync-left-rail`
      // opts the rail into the app-wide draggable/persisted width, and its
      // presence is what flips `body.has-shared-left-rail-view` for this view.
      const layout = documentObject.createElement('div');
      layout.className = 'plugin-view__layout left-rail-template';
      layout.append(buildPluginRail(documentObject, plugin, { isRemote, isServed }));

      const main = documentObject.createElement('div');
      main.className = 'plugin-view__main left-rail-template__main';
      main.append(frame);
      layout.append(main);

      section.append(layout);
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
