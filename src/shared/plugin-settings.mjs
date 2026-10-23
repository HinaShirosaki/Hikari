// Declarative plugin preferences shared by manifest inspection and the host UI.
export const MAX_PLUGIN_SETTING_FIELDS = 40;
export const MAX_PLUGIN_SETTING_TEXT = 4000;
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const TYPES = new Set(['boolean', 'string', 'number', 'select']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export const isSettingsObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function label(value, name, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new Error(`${name} must be non-empty text of at most ${limit} characters.`);
  }
  return value.trim();
}

export function validatePluginSettingValue(field, value) {
  let valid = false;
  if (field.type === 'boolean') valid = typeof value === 'boolean';
  if (field.type === 'string') valid = typeof value === 'string' && value.length <= field.maxLength;
  if (field.type === 'select') valid = typeof value === 'string' && field.options.some(option => option.value === value);
  if (field.type === 'number') {
    valid = typeof value === 'number' && Number.isFinite(value)
      && (field.min === undefined || value >= field.min)
      && (field.max === undefined || value <= field.max);
    if (valid && field.step !== undefined) {
      const steps = (value - (field.min ?? 0)) / field.step;
      valid = Number.isFinite(steps) && Math.abs(steps - Math.round(steps)) < 1e-8;
    }
  }
  if (!valid) throw new Error(`Invalid value for plugin setting "${field.key}" (${field.type}).`);
  return value;
}

export function normalizePluginSettingsSchema(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_PLUGIN_SETTING_FIELDS) {
    throw new Error(`"settings" must be an array of at most ${MAX_PLUGIN_SETTING_FIELDS} fields.`);
  }
  const keys = new Set();
  return raw.map(entry => {
    if (!isSettingsObject(entry) || typeof entry.key !== 'string'
      || !KEY_PATTERN.test(entry.key) || RESERVED_KEYS.has(entry.key) || keys.has(entry.key)) {
      throw new Error('Plugin settings need unique keys: a letter followed by letters, numbers, underscores or hyphens (max 64).');
    }
    keys.add(entry.key);
    if (!TYPES.has(entry.type)) throw new Error(`Unknown plugin setting type "${String(entry.type)}".`);
    const field = { key: entry.key, type: entry.type, label: label(entry.label, 'Setting label', 120) };
    if (entry.description !== undefined) field.description = label(entry.description, 'Setting description', 400);
    if (entry.type === 'string') {
      field.maxLength = entry.maxLength === undefined ? MAX_PLUGIN_SETTING_TEXT : entry.maxLength;
      if (!Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > MAX_PLUGIN_SETTING_TEXT) {
        throw new Error(`Setting "${entry.key}" maxLength must be an integer from 1 to ${MAX_PLUGIN_SETTING_TEXT}.`);
      }
    }
    if (entry.type === 'number') {
      for (const key of ['min', 'max', 'step']) {
        if (entry[key] === undefined) continue;
        if (typeof entry[key] !== 'number' || !Number.isFinite(entry[key]) || (key === 'step' && entry[key] <= 0)) {
          throw new Error(`Setting "${entry.key}" needs a finite ${key}${key === 'step' ? ' greater than zero' : ''}.`);
        }
        field[key] = entry[key];
      }
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        throw new Error(`Setting "${entry.key}" min cannot exceed max.`);
      }
    }
    if (entry.type === 'select') {
      if (!Array.isArray(entry.options) || !entry.options.length || entry.options.length > 100) {
        throw new Error(`Setting "${entry.key}" needs 1–100 options.`);
      }
      const values = new Set();
      field.options = entry.options.map(option => {
        if (!isSettingsObject(option) || typeof option.value !== 'string' || option.value.length > 120 || values.has(option.value)) {
          throw new Error(`Setting "${entry.key}" needs unique string option values of at most 120 characters.`);
        }
        values.add(option.value);
        return { value: option.value, label: label(option.label, 'Option label', 120) };
      });
    }
    if (!own(entry, 'default')) throw new Error(`Setting "${entry.key}" needs a default value.`);
    field.default = validatePluginSettingValue(field, entry.default);
    return field;
  });
}

// Imported state is untrusted. Drop invalid schemas instead of rendering them.
export function getPluginSettingsSchema(plugin) {
  if (plugin?.embedUrl || !Array.isArray(plugin?.permissions) || !plugin.permissions.includes('settings')) return [];
  try { return normalizePluginSettingsSchema(plugin.settings); } catch { return []; }
}

export function resolvePluginSettings(schema, raw) {
  const saved = isSettingsObject(raw) ? raw : {};
  return Object.fromEntries(schema.map(field => {
    let value = field.default;
    if (own(saved, field.key)) {
      try { value = validatePluginSettingValue(field, saved[field.key]); } catch { /* Use the declared default. */ }
    }
    return [field.key, value];
  }));
}

// Also retain preferences of removed plugins, so reinstalling can restore them.
export function normalizePluginSettingsStore(raw) {
  if (!isSettingsObject(raw)) return {};
  return Object.fromEntries(Object.entries(raw).flatMap(([id, values]) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !isSettingsObject(values)) return [];
    const fields = Object.entries(values).filter(([key, value]) => KEY_PATTERN.test(key) && !RESERVED_KEYS.has(key)
      && (typeof value === 'boolean' || (typeof value === 'string' && value.length <= MAX_PLUGIN_SETTING_TEXT)
        || (typeof value === 'number' && Number.isFinite(value))));
    return fields.length <= MAX_PLUGIN_SETTING_FIELDS ? [[id, Object.fromEntries(fields)]] : [];
  }));
}
