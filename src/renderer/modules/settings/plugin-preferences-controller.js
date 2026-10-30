import { settingsMessage, settingsAttributes, setSettingsText } from './localization.js';
import { getPluginSettingsSchema } from '../../../shared/plugin-settings.mjs';
import { PLUGIN_SETTINGS_CHANGED, readPluginSettings, writePluginSettings } from '../../lib/plugin-settings.js';

// Drafts survive the parent plugin list being refreshed. A plugin API update
// merges untouched fields while preserving edits the user has not saved yet.
export function createPluginPreferencesController({ state, persist, windowObject, escapeHtml }) {
  const entries = new Map();
  const rawValues = (schema, values) => Object.fromEntries(schema.map(field => [field.key,
    field.type === 'boolean' ? values[field.key] : String(values[field.key])
  ]));

  function refresh(entry) {
    const latest = rawValues(entry.schema, readPluginSettings(state, entry.plugin));
    for (const field of entry.schema) {
      if (entry.draft[field.key] === entry.baseline[field.key]) entry.draft[field.key] = latest[field.key];
    }
    entry.baseline = latest;
  }

  function dirty(entry) {
    return entry.schema.some(field => entry.draft[field.key] !== entry.baseline[field.key]);
  }

  function update(entry, message) {
    const form = entry.form;
    if (!form?.isConnected) return;
    form.querySelector('[type="submit"]').disabled = !dirty(entry);
    form.querySelector('[data-plugin-settings-discard]').disabled = !dirty(entry);
    setSettingsText(form.querySelector('[data-plugin-settings-status]'), message?.key || (dirty(entry) ? 'plugins.unsaved' : 'plugins.saved'), message?.params);
  }

  function fill(entry) {
    entry.form?.querySelectorAll('[data-plugin-setting]').forEach(input => {
      const value = entry.draft[input.dataset.pluginSetting];
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
    });
  }

  function markup(plugin) {
    const schema = getPluginSettingsSchema(plugin);
    if (!schema.length) return '';
    let entry = entries.get(plugin.id);
    if (!entry || JSON.stringify(entry.schema) !== JSON.stringify(schema)) {
      const values = rawValues(schema, readPluginSettings(state, plugin));
      entry = { plugin, schema, baseline: values, draft: { ...values }, open: false };
      entries.set(plugin.id, entry);
    } else {
      entry.plugin = plugin;
      refresh(entry);
    }
    const fields = schema.map(field => {
      const id = `plugin-pref-${encodeURIComponent(plugin.id)}--${encodeURIComponent(field.key)}`;
      const descriptionId = `${id}-description`;
      const attrs = `id="${escapeHtml(id)}" data-plugin-setting="${escapeHtml(field.key)}"${field.description ? ` aria-describedby="${escapeHtml(descriptionId)}"` : ''}`;
      const value = entry.draft[field.key];
      let control;
      if (field.type === 'boolean') {
        control = `<input type="checkbox" ${attrs}${value ? ' checked' : ''} />`;
      } else if (field.type === 'select') {
        control = `<select ${attrs}>${field.options.map(option => `<option value="${escapeHtml(option.value)}"${option.value === value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`;
      } else if (field.type === 'number') {
        const bounds = ['min', 'max', 'step'].filter(key => field[key] !== undefined)
          .map(key => ` ${key}="${field[key]}"`).join('');
        control = `<input type="number" ${attrs} value="${escapeHtml(value)}" required${bounds}${field.step === undefined ? ' step="any"' : ''} />`;
      } else {
        control = `<input type="text" ${attrs} value="${escapeHtml(value)}" maxlength="${field.maxLength}" />`;
      }
      return `<div class="settings-row"><div class="settings-row-copy"><label for="${escapeHtml(id)}">${escapeHtml(field.label)}</label>${field.description ? `<p id="${escapeHtml(descriptionId)}">${escapeHtml(field.description)}</p>` : ''}</div>${control}</div>`;
    }).join('');
    return `<details class="settings-disclosure plugin-preferences"${entry.open ? ' open' : ''}>
      <summary>${settingsMessage('plugins.preferences')}</summary>
      <form class="settings-preference-form" data-plugin-settings="${escapeHtml(plugin.id)}" ${settingsAttributes({ 'aria-label': 'plugins.preferencesLabel' }, { name: plugin.name })}>
        ${fields}<div class="settings-save-bar"><span class="small-note" data-plugin-settings-status role="status"></span>
          <div class="form-actions"><button type="button" class="ghost-btn" data-plugin-settings-reset>${settingsMessage('plugins.reset')}</button>
            <button type="button" class="ghost-btn" data-plugin-settings-discard>${settingsMessage('plugins.discard')}</button><button type="submit">${settingsMessage('plugins.save')}</button></div>
        </div>
      </form></details>`;
  }

  function bind(container) {
    container.querySelectorAll('[data-plugin-settings]').forEach(form => {
      const entry = entries.get(form.dataset.pluginSettings);
      entry.form = form;
      const details = form.closest('details');
      details.addEventListener('toggle', () => { entry.open = details.open; });
      const capture = () => {
        form.querySelectorAll('[data-plugin-setting]').forEach(input => {
          entry.draft[input.dataset.pluginSetting] = input.type === 'checkbox' ? input.checked : input.value;
        });
        update(entry);
      };
      form.addEventListener('input', capture);
      form.addEventListener('change', capture);
      form.querySelector('[data-plugin-settings-discard]').addEventListener('click', () => {
        entry.baseline = rawValues(entry.schema, readPluginSettings(state, entry.plugin));
        entry.draft = { ...entry.baseline };
        fill(entry);
        update(entry);
      });
      form.querySelector('[data-plugin-settings-reset]').addEventListener('click', () => {
        entry.draft = rawValues(entry.schema, Object.fromEntries(entry.schema.map(field => [field.key, field.default])));
        fill(entry);
        update(entry);
      });
      form.addEventListener('submit', event => {
        event.preventDefault();
        capture();
        if (!form.reportValidity()) return;
        const values = Object.fromEntries(entry.schema.filter(field => entry.draft[field.key] !== entry.baseline[field.key])
          .map(field => [field.key, field.type === 'number' ? Number(entry.draft[field.key]) : entry.draft[field.key]]));
        try {
          writePluginSettings({ state, plugin: entry.plugin, values, persist, windowObject });
          entry.baseline = rawValues(entry.schema, readPluginSettings(state, entry.plugin));
          entry.draft = { ...entry.baseline };
          fill(entry);
          update(entry, { key: 'plugins.saveSuccess' });
        } catch (error) {
          update(entry, { key: 'plugins.saveError', params: { error: error.message } });
        }
      });
      update(entry);
    });
  }

  windowObject?.document?.addEventListener?.(PLUGIN_SETTINGS_CHANGED, event => {
    const entry = entries.get(event.detail?.pluginId);
    if (!entry) return;
    refresh(entry);
    fill(entry);
    update(entry);
  });
  return { markup, bind };
}
