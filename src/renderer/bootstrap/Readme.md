# Renderer Bootstrap

Small renderer bootstrap scripts live here.

- `index-shell.js`: runs before the main renderer module to restore shell appearance state for the generated `index.html`.

Maintenance notes:

- Keep bootstrap files tiny and side-effect focused.
- Prefer moving inline HTML startup logic here instead of growing `ui/html/shell/start.html`.
- Avoid importing large renderer modules from bootstrap files.
