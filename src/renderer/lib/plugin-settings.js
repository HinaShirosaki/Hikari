import { getPluginSettingsSchema, isSettingsObject, resolvePluginSettings, validatePluginSettingValue } from '../../shared/plugin-settings.mjs';

export const PLUGIN_SETTINGS_CHANGED = 'hikari:plugin-settings-changed';

export function readPluginSettings(state, plugin) {
  return resolvePluginSettings(getPluginSettingsSchema(plugin), state.settings?.pluginSettings?.[plugin.id]);
}

export function writePluginSettings({ state, plugin, values, persist, windowObject = globalThis.window }) {
  if (plugin.embedUrl || !plugin.permissions?.includes('settings')) throw new Error('Plugin settings permission is required.');
  if (!isSettingsObject(values)) throw new Error('settings.set needs a "values" object.');
  const schema = getPluginSettingsSchema(plugin);
  const fields = new Map(schema.map(field => [field.key, field]));
  for (const [key, value] of Object.entries(values)) {
    if (!fields.has(key)) throw new Error(`Unknown plugin setting "${key}".`);
    validatePluginSettingValue(fields.get(key), value);
  }
  const previous = state.settings;
  const current = readPluginSettings(state, plugin);
  const resolved = { ...current, ...values };
  if (JSON.stringify(current) === JSON.stringify(resolved)) return { values: { ...resolved } };
  // Store overrides only, so a plugin update's new defaults reach untouched fields.
  const saved = previous?.pluginSettings?.[plugin.id];
  const stored = { ...(isSettingsObject(saved) ? saved : {}), ...values };
  schema.forEach(field => { if (stored[field.key] === field.default) delete stored[field.key]; });
  state.settings = { ...previous, pluginSettings: { ...previous?.pluginSettings, [plugin.id]: stored } };
  try {
    persist?.({ barrier: true });
  } catch (error) {
    state.settings = previous;
    throw error;
  }
  // Signal only after persistence succeeds. The bridge resolves the current
  // values itself and forwards them only to this plugin's registered frames.
  if (windowObject?.CustomEvent) {
    windowObject.document?.dispatchEvent?.(new windowObject.CustomEvent(PLUGIN_SETTINGS_CHANGED, {
      detail: { pluginId: plugin.id }
    }));
  }
  return { values: { ...resolved } };
}
