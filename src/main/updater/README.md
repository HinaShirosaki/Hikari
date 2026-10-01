# Updater

In-app updates for a build installed from npm. The npm package is source that
`npx @hinashirosaki/hikari` builds into a native app on the user's machine
(`bin/hikari.js`); there are no hosted binaries and builds are ad-hoc signed,
so Electron's `autoUpdater` (Squirrel) cannot be used.

Two kinds of update:

- **App-only** (most releases, Obsidian's model): when the release's
  `devDependencies.electron` range accepts the running Electron, npm installs
  just the release's files and runtime dependencies into
  `<userData>/app-code/<version>/`, its UI is built there, and Hikari relaunches.
  The bundled `main.js` then runs the newest such copy (`app-code.js`). Nothing
  is packaged, copied or swapped, and the app bundle itself is never changed.
- **Full rebuild**: when the release needs another Electron (or the app-only
  install fails), the updater runs the same build as `npx` and swaps the result
  in. To force one for a release, raise the floor of its `electron` range above
  what installed copies run (for example after changing `forge.config.js`).

Files:

- `create-npm-updater-service.js`: the service built in `core/main-services.js`
  and started (best-effort) after the window opens. Flow:
  1. On a packaged build, fetch `https://registry.npmjs.org/@hinashirosaki%2fhikari`
     and compare the `latest` dist-tag with `app.getVersion()`. A few seconds
     after start it also deletes app-code copies older than what runs.
  2. If newer, show **Hikari x.y.z is available** (**Update** / **Later**).
  3. App-only: `npm install @hinashirosaki/hikari@<version> --prefix <staging>
     --omit=dev --ignore-scripts`, then `scripts/build-ui.mjs` in the installed
     package, with the Node that Hikari finds (desktop launches get a minimal
     `PATH`, so it is prepended). The staging folder under `app-code/` gets a
     `hikari-app-code.json` manifest and is renamed to `<version>` when
     complete; `update.log` stays inside it. Then relaunch and quit.
  4. Full rebuild: run `npx --yes @hinashirosaki/hikari@<version>` in a fresh
     temp directory, logging to `update.log` there, and find the build under
     `<temp>/hikari-out/`. Quit (through the unsaved-changes check) and apply it:
     on macOS the running `Hikari.app` is renamed to `.previous` and the new
     bundle renamed (or `ditto`-copied from another drive) into place; on a
     Windows setup install the new `HikariSetup.exe` installs and restarts; on a
     Windows portable copy the new build's `Hikari.exe` swaps itself in
     (`finish-portable-update.js`).
- `app-code.js`: where app-only copies live and which one runs. `main.js` calls
  `loadNewerAppCode()` first (except in swap mode): it picks the newest copy
  that is newer than the bundled code and whose Electron range accepts this
  Electron, sets `app.getVersion()` to its version and requires its `main.js`,
  which then starts the app or the MCP stdio server as usual. A copy that throws
  while loading falls back to the bundled code. Dev runs (`electron .`) never
  load copies.
- `release-metadata.js`: reads the npm metadata (version, release notes, npm
  page URL, Electron range).
- `version.js`: version normalization, comparison and the Electron range check.
- `installer.js`: the `npm`/`npx` invocations per platform (Windows runs npm's
  JS entrypoints with `node.exe`, because `npm.cmd`/`npx.cmd` need a shell) and
  the build lookup.

Tests: `tests/suites/core/npm-updater-suite.js`,
`tests/suites/core/app-only-update-suite.js`.
