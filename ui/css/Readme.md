# CSS color architecture

`base/palette.css` is the application theme contract. It contains only
easy-to-read, product-wide semantic variables such as:

- `--theme-background`
- `--theme-surface-elevated`
- `--theme-border`
- `--theme-text-muted`
- `--theme-accent`
- `--theme-success`
- `--theme-danger`

The default light theme is declared on `:root`. Night overrides the same
contract on `body.theme-night`. A future theme
should do the same instead of introducing a second vocabulary:

```css
body.theme-example {
  --theme-background: ...;
  --theme-surface: ...;
  --theme-text: ...;
  --theme-accent: ...;
}
```

Filled `input`, `textarea`, and `select` elements use the
`--theme-control-background` contract. The default day theme intentionally
aliases that token to `--theme-surface` to preserve its near-white fields;
night and other themes may override the control fill independently.

Modules should use the shared `--theme-*` variables unless a color carries
module-specific meaning. Washes, tinted borders and status inks come from the
tint steps at the end of `base/palette.css` (`--theme-fill`, `--theme-*-wash`,
`-soft`, `-line`, `-ink`, `--theme-heat-*`); do not mint a new `color-mix()`
percentage in a view. Extra colors belong in a dedicated module palette:

- `views/assay-plate-palette.css` — assay plates and labware previews
- `views/papers-palette.css` — PDF highlights
- `views/sequence-viewer-palette.css` — biological sequence features
- `views/tool-box-palette.css` — fixed-color scientific canvases

(The gel palette moved into the Gel plugin, `src/plugins/gel/vendor/css/views/gel-palette.css`, when Gel stopped being a renderer module.)

A custom property that reads a `--theme-*` token must **not** be declared on
`:root`. Substitution happens where a property is *declared*, so
`--app-left-rail-surface: color-mix(..., var(--theme-surface-elevated) ...)` on
`:root` freezes the day value and inherits that light color into night mode —
this is what once painted the left rail near-white behind light text. Declare it
on `body` instead: the theme class lives there, so one declaration resolves
correctly in every theme. Re-declaring the property in each theme block works
too, and is what `base/palette.css` does for the contract itself.

`tests/night-palette-selfcheck.mjs` enforces this across every stylesheet, along
with the night ramp's ordering and its text/border contrast minimums.

Every palette must be listed in `ui/config/css-order.json` before view styles.
Raw color literals are not allowed in ordinary component/view CSS. Run
`npm run check:css-colors` after changing colors; `npm test` runs this check as
part of the standard verification path.

## Folder layout

- `base/`: `palette.css` (the theme contract) and `core.css` (primitives).
- `themes/modes.css`: day/night mode switches.
- `views/`: one stylesheet per view (discovered from `app-registry.json`), plus module palettes and late `*-shell-overrides.css`.
- `components/`: shared components used by several views — the first-launch storage setup page, foldable sections, the spreadsheet fill handle, plugin frames, draft review cards, and the agent rail composer.
- `overrides/`: shared layouts and corrective rules (rail templates, menus, dialogs, rail lists, cross-view fixes).

The load order is `ui/config/css-order.json`: palettes and base first, view styles in the middle, components and overrides last.

## Shared rail templates

`overrides/left-rail-template.css` owns the structural rail/main workspace.
`overrides/folder-tree-template.css` owns recursive folder rows inside a rail:

- `.folder-tree-template` is the tree root.
- `.folder-tree-template__node` and `.folder-tree-template__children` may nest to any depth; `.folder-tree-template__leaf` connects a non-folder item to the same branch.
- `.folder-tree-template__row` contains the disclosure control, main folder button, and optional action.
- `.folder-tree-template__disclosure` wraps the CSS-drawn chevron; do not use text `>` characters.
- `.folder-tree-template__rename-input` styles the input `startInlineRename` swaps in for a row control while it is being renamed.
- `.folder-tree-template__hover-card` is the box `attachRailHoverCard` shows beside a row, e.g. the full text of a clipped name.

Modules keep ownership of their data, labels, and commands. Folder-based rails
use `src/renderer/lib/folder-tree.js` for consistent node/leaf markup and
expanded/collapsed state. The shared renderer deliberately accepts module-owned
attributes and content so Papers, Biology Notebook, Sequence Viewer, Agent Chat,
and Personal Inventory can keep their selection, rename, drag/drop, and domain
actions without forking the tree structure. Physical Inventory containers retain
their module-owned box, plate, or tube leaf treatment inside the shared branch.
