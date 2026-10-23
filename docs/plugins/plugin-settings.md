# Plugin preferences in Settings

Local, tool, and service plugins can declare preferences that Hikari renders
under **Settings → Plugins → [plugin] → Preferences**. Hikari owns the form;
the plugin supplies a schema and reads its own values through the bridge.

Add the `settings` permission and a `settings` array to `plugin.json`:

```json
{
  "id": "settings-demo",
  "name": "Settings Demo",
  "version": "1.0.0",
  "permissions": ["settings"],
  "settings": [
    {
      "key": "autoSave", "type": "boolean", "label": "Automatically save",
      "description": "Save completed work automatically.", "default": true
    },
    {
      "key": "author", "type": "string", "label": "Author",
      "default": "", "maxLength": 120
    },
    {
      "key": "resolution", "type": "number", "label": "Export resolution (dpi)",
      "default": 300, "min": 72, "max": 1200, "step": 1
    },
    {
      "key": "defaultFormat", "type": "select", "label": "Default export format",
      "default": "svg",
      "options": [
        { "value": "svg", "label": "SVG" },
        { "value": "png", "label": "PNG" }
      ]
    }
  ]
}
```

Every field requires a unique `key`, `type`, `label`, and valid `default`.
`description` is optional. Supported types:

| Type | Control | Constraints |
| --- | --- | --- |
| `boolean` | Checkbox | Boolean default and values. |
| `string` | Text input | `maxLength`: 1–4000, default 4000. Empty strings are allowed. |
| `number` | Number input | Finite numbers; optional inclusive `min`/`max` and positive `step`. Step is measured from `min`, or zero if omitted. Without `step`, decimals are allowed. |
| `select` | Dropdown | 1–100 `{ value, label }` options with unique string values. The default must match an option. |

A schema has at most 40 fields. Keys start with a letter and contain up to 64
letters, digits, underscores, or hyphens; `constructor`, `prototype`, and
`__proto__` are reserved. Labels are limited to 120 characters, descriptions
to 400, and option values to 120. Labels and descriptions render as plain text.
Invalid schemas are rejected at installation. Schema and permissions are
snapshotted together: remove and re-add an installed plugin after changing
them, then reload Hikari. Existing saved values remain available.

Read, update, and subscribe with the ordinary plugin client:

```js
const { hikari } = window.HikariPlugin;

// Subscribe before loading the initial snapshot.
hikari.on('settings.changed', ({ values }) => applyPreferences(values));
const { values } = await hikari.call('settings.get');
applyPreferences(values);

// Partial patch: other preferences keep their current values.
await hikari.call('settings.set', { values: { defaultFormat: 'png' } });
```

Both calls return `{ values }`, containing all declared preferences with
defaults applied. The host validates every supplied key and value before
saving any of them. Missing `values`, arrays, unknown keys, wrong types, and
out-of-range values are rejected. No value is coerced from a string to a number
or boolean. Only actual changes produce a `settings.changed` event, and only
after persistence succeeds. A failed save keeps the previous values intact.

The Settings form uses **Save** and **Discard**. **Reset defaults** prepares a
draft of the declared defaults; click **Save** to apply it. Drafts survive
navigation and list refreshes. Live changes merge into untouched fields while
preserving the user's edits to other fields.

Preferences persist separately in `state.settings.pluginSettings[pluginId]`.
Only values that differ from the declared default are stored, so a new default
in a plugin update reaches every field the user has not changed. They survive app restarts, removal/reinstallation, and state export/import;
switching the workspace storage folder retains them. `storage.set` cannot
overwrite them. This store holds ordinary JSON preferences, not credentials.
Invalid imported values fall back to the field's declared default.

The `settings` permission grants access only to the calling plugin's schema
and values. It exposes neither Hikari's general settings nor another plugin's
preferences. Remote (`embed`) plugins cannot use it. Headless service plugins
can use the host Settings form without adding a plugin view.

See the runnable [settings-demo](../../examples/plugins/settings-demo/) example.
