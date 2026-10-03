import { getSharedLeftRailLayout, SHARED_LEFT_RAIL_CHANGED_EVENT } from './shared-left-rail.js';

const FOLD_STORAGE_PREFIX = 'hikari_plugin_left_rail_folded_v1:';
const sessionFolds = new WeakMap();

export function getPluginLeftRailLayout(pluginId, { windowObject = globalThis.window } = {}) {
  let folded = sessionFolds.get(windowObject)?.get(pluginId);
  if (typeof folded !== 'boolean') {
    try {
      const stored = windowObject?.localStorage?.getItem?.(FOLD_STORAGE_PREFIX + pluginId);
      folded = stored === 'true';
    } catch {}
  }
  return {
    ...getSharedLeftRailLayout({ document: windowObject?.document, windowObject }),
    foldable: true,
    folded: folded === true
  };
}

export function setPluginLeftRailFolded(pluginId, folded, { windowObject = globalThis.window } = {}) {
  // The bridge supplies the registered plugin ID. A plugin cannot write another
  // workspace's preference or change the shared expanded width by folding.
  if (windowObject) {
    if (!sessionFolds.has(windowObject)) sessionFolds.set(windowObject, new Map());
    sessionFolds.get(windowObject).set(pluginId, folded);
  }
  try {
    windowObject?.localStorage?.setItem?.(FOLD_STORAGE_PREFIX + pluginId, String(folded));
  } catch {}
  const layout = getPluginLeftRailLayout(pluginId, { windowObject });
  if (typeof windowObject?.dispatchEvent === 'function') {
    const detail = { pluginId, ...layout };
    windowObject.dispatchEvent(typeof windowObject.CustomEvent === 'function'
      ? new windowObject.CustomEvent(SHARED_LEFT_RAIL_CHANGED_EVENT, { detail })
      : { type: SHARED_LEFT_RAIL_CHANGED_EVENT, detail });
  }
  return layout;
}
