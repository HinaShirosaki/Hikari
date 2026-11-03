// Frame-scoped header registrations; the plugin continues to render its rail.
export const PLUGIN_LEFT_RAIL_HEADER_CHANGED = 'hikari:plugin-left-rail-header-changed';
const controllers = new WeakMap();

export function getActivePluginLeftRailHeader(windowObject, view) {
  return controllers.get(windowObject)?.getActive(view) || null;
}

export function createPluginLeftRailHeader({ windowObject, getRegistration, readLayout, setFolded }) {
  const configurations = new Map();
  const doc = windowObject?.document;
  function notify() {
    if (typeof windowObject?.CustomEvent === 'function') {
      windowObject.dispatchEvent(new windowObject.CustomEvent(PLUGIN_LEFT_RAIL_HEADER_CHANGED));
    }
  }
  const controller = {
    set(params, frame) {
      if (!params || typeof params.available !== 'boolean'
        || Object.keys(params).some(key => key !== 'available')) {
        throw new Error('app.setLeftRail requires a boolean "available".');
      }
      if (!doc?.getElementById?.('topbar-left-rail-toggle')) {
        throw new Error('The header left-rail toggle is unavailable in this host.');
      }
      const registration = getRegistration(frame);
      if (!registration) throw new Error('The plugin frame is not registered.');
      if (params.available) configurations.set(frame, registration);
      else configurations.delete(frame);
      notify();
      return { mounted: params.available, leftRail: readLayout(registration.plugin.id) };
    },
    clear(frame) {
      configurations.delete(frame);
      notify();
    },
    getActive(view) {
      const pluginId = view?.getAttribute?.('data-plugin-id');
      if (!pluginId || view.closest?.('[hidden]')) return null;
      const frameElement = view.querySelector('iframe');
      const frame = frameElement?.contentWindow;
      const registration = configurations.get(frame);
      const plugin = registration?.plugin;
      if (!plugin || plugin.id !== pluginId || getRegistration(frame) !== registration
        || plugin.enabled === false || !plugin.permissions?.includes('layout')) return null;
      return {
        frame: frameElement,
        folded: readLayout(pluginId).folded,
        setFolded: folded => {
          if (getRegistration(frame) !== registration) return;
          setFolded(pluginId, folded);
        }
      };
    }
  };
  if (windowObject) controllers.set(windowObject, controller);
  return controller;
}
