# HTML Sources

`index.html` is generated from the files in this folder by `scripts/build-ui.mjs`.

- `shell/`: global document wrapper pieces such as head tags and startup bootstrap hooks.
- `views/`: per-view HTML fragments that are stitched into the generated root file.
- `templates/`: reusable HTML fragments shared by the shell/view assembly.

Maintenance notes:

- Do not hand-edit the generated root `index.html` unless you are debugging output.
- Prefer moving inline behavior into `src/renderer/bootstrap/` and keeping shell HTML declarative.
- When changing view structure, rebuild the UI so the generated root file stays in sync.
