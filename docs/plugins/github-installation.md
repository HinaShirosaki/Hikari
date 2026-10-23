# Publish a plugin for installation from GitHub

Hikari can clone a GitHub repository and install it directly from **Settings →
Plugins → Install from GitHub**. Put a complete, ready-to-run plugin at the
repository root on its default branch. Users only need the repository URL and
Git installed on their computer.

This guide describes the repository that the installer accepts. For building
the plugin itself, start with [the quickstart](quickstart.md); for host data,
storage, and other capabilities, see [the plugin API](plugin-api.md).

## Repository layout

A local workspace plugin needs two files at the repository root:

```text
my-plugin-repo/               # GitHub repository root
├── plugin.json               # Required: plugin identity and capabilities
└── index.html                # Required: the runnable entry page
```

The entry filename is fixed: `main` or `entry` fields cannot redirect the
installer to `dist/index.html`. A `package.json` does not replace `plugin.json`.

A typical repository separates scripts, styles, and assets:

```text
my-plugin-repo/
├── plugin.json
├── index.html
├── main.js
├── style.css
├── hikari.js                 # Optional: client for the Hikari host API
├── icon.svg                  # Optional: declare with "icon" in plugin.json
├── assets/
│   └── logo.svg
├── README.md
└── LICENSE
```

The GitHub repository name can differ from the manifest `id`. For example,
`https://github.com/your-org/hikari-my-plugin` can declare `"id": "my-plugin"`.
Hikari names the installed folder `my-plugin` automatically. If developers
use **Add Plugin Folder** for local testing, that selected folder must already
be named `my-plugin`.

Each repository URL installs one plugin. These layouts do **not** install
directly because the manifest or entry page is nested:

```text
repo/                         repo/
└── plugins/                  ├── plugin.json
    └── my-plugin/            └── dist/
        ├── plugin.json           └── index.html
        └── index.html
```

Use a dedicated repository, or publish a default branch whose root contains
the installable files.

## Minimal working example

Commit these two files to your repository's default branch.

`plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A small workspace installed from GitHub.",
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
    <h1>My Plugin</h1>
    <p>This plugin was installed from GitHub.</p>
    <button type="button" id="count">Clicked 0 times</button>
    <script>
      let count = 0;
      document.getElementById('count').addEventListener('click', (event) => {
        count += 1;
        event.currentTarget.textContent = `Clicked ${count} times`;
      });
    </script>
  </body>
</html>
```

This example needs no host permissions, dependencies, build step, or
`package.json`. A plugin that calls Hikari APIs should also ship the
[copyable `hikari.js` client](../../examples/plugins/notebook-results/hikari.js)
and declare the permissions required by those calls.

## Manifest requirements

A GitHub install applies the same manifest rules as **Add Plugin Folder**:
[`plugin.json` fields](plugin-system.md#14-pluginjson),
[validation rules](plugin-system.md#13-validation-rules), and
[permissions](plugin-system.md#15-permissions). Two rules are specific to
GitHub installs:

- `plugin.json` must be at most 64 KiB.
- The `id` is checked before validation, because it names the installed
  folder. Keep it unchanged across releases: it is the installation identity
  and the key for the plugin's data and preferences.

If the plugin requests any permission, it installs turned off and the user
turns it on after reviewing its host access, so list only the permissions it
needs.

## Ship the files that actually run

The installer shallow-clones the default branch, validates the plugin, and
adds its Settings entry. An entry that requests permissions starts turned off
until the user reviews its host access. It does not run `npm install`, lifecycle hooks,
build scripts, development servers, or other setup commands.

If you use TypeScript, React, Vue, or a bundler, build before publishing and
commit the generated browser files. Keep the generated entry at the root:

```text
my-plugin-repo/
├── plugin.json
├── index.html                # Generated, runnable HTML
├── assets/                   # Generated JS/CSS and required assets
│   ├── app.js
│   └── app.css
├── src/                      # Optional authoring source
├── package.json              # Optional developer build configuration
└── README.md
```

Use relative references such as `./assets/app.js` and `./assets/app.css` in
the entry page. Bundle browser dependencies or include their actual runtime
files; users should not need `node_modules` or a server on `localhost` to open
the plugin. The page runs in Hikari's sandboxed iframe and does not have
direct Node.js or Electron access. Use the public plugin API for host access.

All required files must be tracked on the default branch. The installer does
not fetch release ZIPs, initialize Git submodules, or download Git LFS asset
contents. Symbolic links are rejected; ship regular files and directories.
For an offline-capable local plugin, include its scripts, styles, fonts, and
other runtime assets rather than depending on a CDN.

## Supported URLs and access

Share a root HTTPS repository URL, with or without `.git`:

```text
https://github.com/your-org/my-plugin-repo
https://github.com/your-org/my-plugin-repo.git
```

The installer does not accept SSH clone addresses, GitHub Enterprise hosts,
GitHub Pages URLs, branch/tag links, subfolder/file links, release links, or
URLs containing credentials, query parameters, or fragments. It always
clones the repository's default branch; it cannot select a release tag or a
different branch from the pasted URL.

Public repositories are the simplest distribution option. A private
repository needs working Git credentials already configured on the user's
computer. Hikari does not prompt for login during installation. Users need
Git available on PATH and internet access to the repository.

## Test and share your plugin

1. Push the manifest and all runnable files to the default branch.
2. Open a Hikari build that includes **Install from GitHub**.
3. Go to **Settings → Plugins**, paste the repository URL, and click
   **Install from GitHub**.
4. Turn the plugin on if it requests permissions (it installs turned off),
   then click **Reload App**. Hikari
   uses its normal save/discard dialog if another workspace has unsaved edits.
5. Open the plugin from navigation, or from **Tools** when `tool` is true.
   Exercise its main features and any requested host capabilities.
6. Test with a fresh checkout or installation so missing generated files and
   untracked local dependencies cannot hide a packaging problem.

You can include this installation text in your repository's README, replacing
the example URL:

```markdown
## Install in Hikari

Requires Git and a Hikari build with GitHub plugin installation.

1. Open **Settings → Plugins**.
2. Paste `https://github.com/your-org/my-plugin-repo` into **GitHub repository URL**.
3. Click **Install from GitHub**, review its host access and turn it on, then
   click **Reload App**.
```

An installation is a snapshot of the cloned default branch. Hikari does not
automatically pull later commits or update a plugin when its `version`
changes. To install a newer snapshot, remove the Settings entry and install
the URL again, then reload. Removing a plugin keeps its previous checkout on
disk. Manifest and permission changes also require removal and reinstallation
because permissions are captured at install time.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| “Enter a GitHub repository URL…” | Paste the root `https://github.com/owner/repo` URL, without a branch, subfolder, query, or fragment. |
| “Git is required…” | Install Git, ensure Hikari can find it on PATH, and restart Hikari. On macOS, accept the Command Line Tools prompt or run `xcode-select --install`. |
| “Could not clone… Git said: …” | Git's own last error line follows, e.g. `repository … not found` for a wrong or private URL. |
| “Could not clone the repository…” | Check the URL, repository access, internet connection, and existing Git credentials for private repositories. |
| “Cloning timed out…” | Cloning has a two-minute timeout. Check the connection and keep the install branch small enough to download promptly. |
| “The repository must contain a valid plugin.json at its root…” | Commit valid JSON at the default branch's root; keep it at most 64 KiB. |
| “Plugin folder does not contain index.html.” | Commit the runnable entry at the root; an entry only under `dist/` is insufficient. |
| “Unknown permission…” | Use capability names from the [plugin API](plugin-api.md). |
| “A plugin named … is already installed.” | Another installed plugin has the same manifest `id`; remove the existing entry to reinstall it. |
| Installation succeeds but the UI is blank or broken | Verify every script, style, asset, and browser dependency is committed and works without a build or development server. |

The implementation contracts live in
[`install-github-plugin.js`](../../src/main/lib/install-github-plugin.js) and
[`inspect-plugin-folder.js`](../../src/main/lib/inspect-plugin-folder.js).
