// Per-plugin persisted storage (docs/plugins/plugin-api.md §3).
//
// A plugin's blob rides along inside app state, and app state is a single
// localStorage record for the whole app. An oversized blob would therefore
// break *every* later save, not just the plugin's own — which is why the size
// cap is a data-loss guard rather than a preference, and why it is enforced
// twice: on write in plugin-bridge.js, where the plugin gets a usable error,
// and on load here, where an imported or hand-edited state gets the same
// treatment before it can reach localStorage.

// ponytail: one flat cap per plugin, no per-app quota UI. Raise it or move
// blobs to the storage folder if plugins ever need to keep real images.
export const MAX_PLUGIN_STORAGE_CHARS = 1000000;

// Serialized length, in the same UTF-16 units localStorage counts. Throws on
// values JSON cannot represent (cycles), which callers turn into an error.
export function measurePluginStorageValue(value) {
  return JSON.stringify(value ?? null).length;
}

export function normalizePluginStorage(rawStorage) {
  if (!rawStorage || typeof rawStorage !== 'object' || Array.isArray(rawStorage)) {
    return {};
  }
  const normalized = {};
  Object.entries(rawStorage).forEach(([pluginId, value]) => {
    const key = String(pluginId || '').trim();
    if (!key || value === undefined || value === null) {
      return;
    }
    try {
      if (measurePluginStorageValue(value) <= MAX_PLUGIN_STORAGE_CHARS) {
        normalized[key] = value;
      }
    } catch {
      // Unserializable: dropping it is the only option that keeps state saveable.
    }
  });
  return normalized;
}
