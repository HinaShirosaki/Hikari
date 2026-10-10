# Internal plugins

Plugins in this folder are part of Hikari's source and application package.
Users do not select or install them from Settings. They still run through the
ordinary plugin runtime: a sandboxed iframe, a manifest-declared permission
set, and the permission-gated `postMessage` API.

Use an internal plugin when Hikari should own and ship a workspace, but the
workspace should remain isolated from renderer internals. Use
[`examples/plugins/`](../../examples/plugins/) for plugins that developers copy
or users install from a folder.

## How an internal plugin loads

1. [`bundled-plugins.js`](../renderer/lib/bundled-plugins.js) restores its
   immutable runtime definition into app state. The saved path is a private
   token such as `@bundled/gel`, never an application or developer path.
2. The main process resolves that token to `src/plugins/<id>` inside the
   application package. A token can resolve only for the same plugin id.
3. The normal plugin loader mounts the workspace. Every folder plugin, bundled
   or installed, is served on its own loopback origin (`serve: true` is a
   compatibility no-op).
4. The normal bridge identifies the iframe by its actual `contentWindow` and
   gates every host call against the definition's permissions.

This keeps internal distribution separate from runtime trust. Moving a plugin
here does not give it renderer imports, preload access, filesystem access, or a
special unsandboxed UI path.

## Adding or changing one

- Keep the complete workspace in `src/plugins/<id>/`, including `plugin.json`
  and `index.html`. The directory name and manifest id must match.
- Add or update its immutable definition in
  [`bundled-plugins.js`](../renderer/lib/bundled-plugins.js). Keep identity,
  version, description, permissions, and `serve` synchronized with the
  manifest. A source-owned plugin may also provide trusted `iconMarkup`; never
  accept host SVG markup from an installable plugin manifest.
- Add its package-relative resolver in
  [`main-services.js`](../main/core/main-services.js). Never put the resolved
  path in renderer state; keep using `@bundled/<id>`.
- Use only the public API documented in
  [`docs/plugins/plugin-api.md`](../../docs/plugins/plugin-api.md). An
  identity-locked verb (`internal: true` plus `bundledPluginId` in
  [`plugin-bridge/verbs.js`](../renderer/app/plugin-bridge/verbs.js)) is
  acceptable only for a one-time move of data previously owned by Hikari
  (`migration.importLegacyGel`) or a host handoff the public API cannot express
  (`gel.takeNotebookLink`, pulled after the data-less `gel.notebookLink`
  event). Such verbs are not public plugin API: they are left out of
  `PLUGIN_BRIDGE_VERBS` and answer `Unknown verb` to every other frame.
- Keep plugin UI code self-contained. Do not import renderer DOM, state, or
  controllers across the iframe boundary.
- A plugin-owned left rail can mirror normal module sizing without crossing the
  iframe boundary: read `app.info.layout.leftRail`, apply `app.context` layout
  updates, resize locally, and call `app.setLeftRailWidth` once on pointer-up.
- Cover the manifest, bundled definition, source location, critical UI states,
  and core behavior with tests. Package the app and open the shipped plugin
  before considering a path or loader change complete.

For user-installable plugin development, start with
[`docs/plugins/quickstart.md`](../../docs/plugins/quickstart.md).
