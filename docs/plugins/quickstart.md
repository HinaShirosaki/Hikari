# Build a Hikari plugin

This is the shortest reliable path from an empty folder to a plugin that opens
inside Hikari and can call the host API. Read
[`plugin-system.md`](plugin-system.md) afterward for the security model and
[`plugin-api.md`](plugin-api.md) for every available verb.

## 1. Choose the plugin kind

Use a **local plugin** unless you know you need something else.

| Need | Kind | Manifest setting |
| --- | --- | --- |
| HTML/CSS/JavaScript workspace | Local | none |
| ES modules, IndexedDB, WebAssembly, or browser storage | Served | `"serve": true` |
| Embed an existing HTTPS application | Remote | `"embed": "https://…"` |
| Add a headless file converter | Service | `"service": {…}` |

Local and service plugins run with an opaque origin. Their scripts must be
classic scripts—do not use `type="module"` or relative `import` statements.
Served plugins have their own loopback origin and may use modules.

## 2. Start with four files

Create a folder whose name matches the manifest id:

```text
my-plugin/
├── plugin.json
├── index.html
├── hikari.js
└── main.js
```

Copy [`hikari.js`](../../examples/plugins/notebook-results/hikari.js) without
modification. It is a classic-script client that works in both local and served
plugins.

`plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A small Hikari workspace.",
  "permissions": []
}
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My Plugin</title>
  </head>
  <body>
    <main>
      <h1>My Plugin</h1>
      <button id="refresh" type="button">Connect</button>
      <p id="status" role="status" aria-live="polite"></p>
    </main>
    <script src="./hikari.js"></script>
    <script src="./main.js"></script>
  </body>
</html>
```

`main.js`:

```js
(function startPlugin(root) {
  'use strict';

  const hikari = root.HikariPlugin?.hikari;
  const button = document.getElementById('refresh');
  const status = document.getElementById('status');
  let requestInFlight = false;

  async function connect() {
    if (requestInFlight) return;
    if (!hikari) {
      status.textContent = 'Plugin support files did not load. Check the script paths and reload Hikari.';
      button.disabled = true;
      return;
    }
    requestInFlight = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    status.textContent = 'Connecting…';
    try {
      const info = await hikari.call('app.info');
      status.textContent = `Connected as ${info.pluginId}.`;
    } catch (error) {
      status.textContent = error.message || 'Could not connect to Hikari.';
    } finally {
      requestInFlight = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  button.addEventListener('click', connect);
  connect();
}(window));
```

`app.info` needs no permission. When you add another API call, add its exact
permission to `plugin.json`; permissions are listed in
[`plugin-api.md`](plugin-api.md).

## 3. Install and reload

1. Open **Settings → Plugins → Add Plugin Folder**.
2. Select `my-plugin/`.
3. Check the displayed name, version, and host access.
4. Click **Reload App**.
5. Open the plugin from **More** or topbar search.

Manifest and permission changes require removing and re-adding the plugin
because grants are snapshotted at install time. HTML, CSS, and JavaScript edits
only require a reload.

## 4. Use the API safely

Every call is a promise. Treat success as committed only after it resolves:

```js
try {
  const { path } = await hikari.call('files.write', {
    path: 'results/run-1.json',
    dataBase64
  });
  // Keep the returned path; the host may have de-duplicated the file name.
  await hikari.call('storage.set', {
    value: { latestResultPath: path }
  });
} catch (error) {
  // Keep the user's draft and show a retry action.
  showError(error.message);
}
```

Important contracts:

- `storage.set` requires a `value` property. Use `value: null` only when you
  intentionally want to clear the plugin's storage.
- `files.write` and `downloads.save` require canonical base64 data.
- File paths are relative to the plugin's own folder. Save the path returned by
  `files.write`; do not reconstruct it.
- A rejected call means the operation did not complete. Do not update the UI
  to “saved” before the promise resolves.
- Listen for `app.context` to react when appearance or storage availability
  changes.
- If the plugin draws a left rail, initialize it from
  `app.info.layout.leftRail`, resize locally during pointer movement, and call
  `app.setLeftRailWidth` once when the drag settles. This keeps it aligned with
  the persisted width used by built-in modules.

## 5. Make the UI failure-safe

Before calling a plugin UI finished, check these behaviors:

- Loading, empty, success, and error states are visible and use `role="status"`
  or `aria-live` where appropriate.
- Failed startup and failed refresh actions offer **Try again**.
- Save/import/export buttons disable while their request is running, and a
  second click does not start a duplicate request.
- User or host text is rendered with `textContent`, not interpolated into
  `innerHTML`.
- A failed write keeps the user's draft and does not display a false success.
- Destructive actions ask for confirmation and explain what is and is not
  removed.
- Keyboard focus is visible; dialogs restore focus when they close.
- The layout remains usable at narrow widths and with larger host font sizes.
- Long-running listeners and timers have a cleanup path when the workspace is
  reinitialized.

The installable reference host-API example,
[`notebook-results`](../../examples/plugins/notebook-results/), demonstrates
safe DOM rendering, retryable loading, and an exclusive write action. The
internal bundled [`gel`](../../src/plugins/gel/) plugin demonstrates a larger
served workspace with file persistence, boot recovery, responsive layout, and
unsaved-change protection. Hikari contributors load it from source; users do
not add its folder in Settings.

## 6. Verify before sharing

At minimum:

1. Install the plugin through Settings; do not test only by opening
   `index.html` in a browser.
2. Test with every declared permission and with one permission removed.
3. Test without a configured storage folder if the plugin uses `files`.
4. Force one read and one write failure and verify the UI remains usable.
5. Double-click the primary action and confirm only one operation occurs.
6. Reload Hikari and confirm saved state and files rehydrate.
7. Test keyboard navigation, a narrow window, and a larger font size.

For Hikari contributors changing the host API, run `npm test`; bridge security,
storage, filesystem containment, the copyable client, and the Gel plugin all
have automated coverage.
