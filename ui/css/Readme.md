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

The default light theme is declared on `:root`. Night and Hatsune Miku override
the same contract on `body.theme-night` and `body.theme-miku`. A future theme
should do the same instead of introducing a second vocabulary:

```css
body.theme-example {
  --theme-background: ...;
  --theme-surface: ...;
  --theme-text: ...;
  --theme-accent: ...;
}
```

Modules should use the shared `--theme-*` variables unless a color carries
module-specific meaning. Extra colors belong in a dedicated module palette:

- `views/assay-plate-palette.css` — assay plates and labware previews
- `views/gel-palette.css` — gel charts and quantification
- `views/home-palette.css` — contribution heatmaps
- `views/papers-palette.css` — PDF highlights
- `views/sequence-viewer-palette.css` — biological sequence features
- `views/tool-box-palette.css` — fixed-color scientific canvases
- `views/workflow-palette.css` — workflow graph links and selections

Every palette must be listed in `ui/config/css-order.json` before view styles.
Raw color literals are not allowed in ordinary component/view CSS. Run
`npm run check:css-colors` after changing colors; `npm test` runs this check as
part of the standard verification path.
