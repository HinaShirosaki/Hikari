# Updater

In-app updates for a build installed from npm. The npm package is source that
`npx @hinashirosaki/hikari` builds into a native app on the user's machine
(`bin/hikari.js`); there are no hosted binaries and builds are ad-hoc signed,
so Electron's `autoUpdater` (Squirrel) cannot be used. Instead the updater runs
that same build and swaps the result in.

- `create-npm-updater-service.js`: the service built in `core/main-services.js`
  and started (best-effort) after the window opens. Flow:
  1. On a packaged build, fetch `https://registry.npmjs.org/@hinashirosaki%2fhikari`
     and compare the `latest` dist-tag with `app.getVersion()`.
  2. If newer, show **Hikari x.y.z is available** (**Update** / **Later**).
  3. On **Update**, run `npx --yes @hinashirosaki/hikari@<version>` in a fresh
     temp directory with the Node that Hikari finds (desktop launches get a
     minimal `PATH`, so it is prepended), logging to `update.log` there.
  4. Find the built installer under `<temp>/hikari-out/make/` and prepare it
     while the app is still running (on macOS, `ditto` extracts the `.app` so
     symlinks and the signature survive).
  5. Offer **Restart Now** / **Later**. Later applies the update when Hikari
     quits. On macOS the running `Hikari.app` is renamed to `.previous` and the
     new bundle renamed into place (same volume only; otherwise an error dialog
     gives the built bundle's path). On Windows the new `HikariSetup.exe` is
     launched and Squirrel installs and restarts.
- `release-metadata.js`: reads the npm metadata (version, release notes, npm
  page URL).
- `version.js`: version normalization and comparison.
- `installer.js`: the `npx` invocation per platform (Windows runs npm's
  `npx-cli.js` with `node.exe`, because `npx.cmd` needs a shell) and the
  installer lookup (`*.zip` on macOS, `*Setup.exe` on Windows).

Tests: `tests/suites/core/npm-updater-suite.js`.
