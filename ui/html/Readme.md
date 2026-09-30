# HTML Sources

`index.html` is generated from the files in this folder by `scripts/build-ui.mjs`.

- `shell/`: `start.html` (head tags, the Content-Security-Policy, the topbar and dock, startup bootstrap hooks) and `end.html` (everything after the last view), named in `ui/config/html-order.json`.
- `views/`: per-view HTML fragments that are stitched into the generated root file, in the `viewOrder` from `ui/config/app-registry.json`. Each must contain a `<section id="<viewId>" class="view">`.

Plugin views are not here: the plugin loader creates their sections at runtime.

Maintenance notes:

- Do not hand-edit the generated root `index.html` unless you are debugging output.
- Prefer moving inline behavior into `src/renderer/bootstrap/` and keeping shell HTML declarative.
- When changing view structure, rebuild the UI so the generated root file stays in sync.
