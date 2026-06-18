# 2. Universal HTML and CSS

The renderer ships a single generated `index.html` and a single `styles.css`. Both are stitched at build time from per-view source files. As a module author you write **only** the per-view fragment and the per-view stylesheet — everything else is inherited.

## What the universal shell already gives you

`ui/html/shell/start.html` and `ui/html/shell/end.html` wrap every view fragment. After concatenation, the body contains:

```
<body>
  <script type="module" src="src/renderer/bootstrap/index-shell.js"></script>
  <div id="app-loading-cover" ...>...</div>
  <main class="app-shell">
    <header class="topbar">
      <div class="topbar-brand">...page-title, page-subtitle, view-actions...</div>
      <nav class="app-dock">
        <div id="app-dock-nav"></div>     <!-- filled by navigation-shell.js -->
        <button id="app-more-btn">…</button>
        <div id="app-more-menu"></div>
      </nav>
      <div class="topbar-tools">
        <input id="topbar-search" />
      </div>
    </header>
    <div class="workspace-shell">
      <section class="workspace-main">
        <!-- every <section id="...-view" class="view"> goes here -->
      </section>
    </div>
  </main>
  ...vendor scripts + src/renderer/renderer.js...
</body>
```

So a module's HTML lives entirely inside `<section class="workspace-main">` as a sibling of all other views.

## View fragment template

Every view fragment in `ui/html/views/<id>-view.html` must:

- be a single top-level `<section>` whose `id` matches the `viewId` in `ui/config/app-registry.json`,
- carry `class="view"` (the `is-active` class is toggled by the navigation shell),
- contain only that view's markup.

Minimal skeleton:

```html
<section id="my-feature-view" class="view">
  <div class="panel">
    <h2>My Feature</h2>
    <p class="small-note">One-line description for the page.</p>
    <!-- your content -->
  </div>
</section>
```

A few rules from `scripts/build-ui.mjs`:

- Build aborts if `<section id="<id>"` is not present.
- Build aborts on any duplicate `id="..."` attribute across the whole concatenated `index.html`. Namespace your IDs to your module (e.g. `my-feature-list`, not `list`).

## Two-pane layout: `left-rail-template`

Most workspaces use a left rail for navigation/filters and a main content area. Use the universal layout from [ui/css/overrides/left-rail-template.css](../../ui/css/overrides/left-rail-template.css):

```html
<section id="my-feature-view" class="view">
  <div class="my-feature-layout left-rail-template">
    <aside
      class="my-feature-rail app-left-rail left-rail-template__rail"
      data-sync-left-rail
      aria-label="My Feature navigation"
    >
      <!-- rail content: lists, filters, toolbars -->
    </aside>
    <div class="my-feature-content left-rail-template__main">
      <!-- main content -->
    </div>
  </div>
</section>
```

What this buys you for free:

- Resizable rail width persisted across views, driven by `src/renderer/shared-left-rail.js`. Add `data-sync-left-rail` on the `<aside>` to participate.
- Consistent rail/main borders, scrollbar gutters, padding tokens.
- Per-view `body.has-shared-left-rail-view` toggling for shell chrome alignment, handled by `navigation-shell.js`.

If your view is a single column (e.g. Home or a dashboard), drop the wrapper and put `panel`/`tile` blocks directly inside the `<section>`.

## Universal CSS layers

`ui/config/css-order.json` supplies the shared prefix and suffix around view styles discovered from `app-registry.json`. Higher-numbered layers can override lower ones.

| # | Layer | Purpose |
| --- | --- | --- |
| 1 | `ui/css/base/core.css` | design tokens, typography, primitive elements (`button`, `input`, `.panel`, `.tile`, `.primary-btn`, `.small-note`, `.list-row`, …) |
| 2 | `ui/css/themes/modes.css` | day / night theme variables |
| 3..N | `ui/css/views/*-view.css` | per-view styles (one file per module) |
| last | `ui/css/overrides/*.css` | universal layouts and corrective rules: `cross-view-fixes`, `shell-first-remake`, `left-rail-template`, `universal-menus`, `universal-left-rail-lists` |

Tokens you should reuse rather than redefine:

```
--bg, --surface, --surface-subtle, --surface-elevated
--text, --strong, --muted
--line, --line-soft
--accent, --focus, --danger
--app-font-size
--shared-left-rail-width, --shared-left-rail-min, --shared-left-rail-max
```

Common utility classes (defined in `core.css`):

- Containers: `.panel`, `.card`, `.tile`
- Buttons: `.primary-btn`, `.ghost-btn`, `.danger-btn`
- Layout: `.form-grid`, `.stack-form`, `.form-actions`, `.inline-row`, `.cards`, `.grid`
- Lists: `.list-table`, `.list-row`, `.list-row-header`, `.list-main-btn`, `.list-actions`, `.text-list-btn`
- Text: `.small-note`, `.sr-only`

When in doubt, grep an existing `*-view.css` for the closest neighbor and lean on the same primitives.

## Per-view stylesheet conventions

Create `ui/css/views/<id>-view.css`. Scope every selector under your view's id:

```css
#my-feature-view .my-feature-rail {
  display: grid;
  gap: 14px;
}

#my-feature-view .my-feature-card {
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
}
```

Why scope under `#my-feature-view`?

- The whole app is a single document. Class names are not module-private. Scoping under your view id is the only thing keeping styles from leaking.
- `core.css` already styles `button`, `.tile`, `.panel`, `.list-row` globally. Without scoping, your `.list-row { ... }` rule will rewrite every list across the app.

Exception: if your styles are general enough to belong everywhere (rare), put them in an `ui/css/overrides/*.css` file with a clear name and document the intent at the top of the file.

## Hooking into the build

Once your two files exist, add the app entry and its `viewKey` to `ui/config/app-registry.json`, then place the key in `viewOrder`. The build resolves:

- `ui/html/views/<viewId>.html`
- `ui/css/views/<viewId>.css`

Run `npm run build:ui`. The script regenerates `index.html`, `styles.css`, `views.js`, and the generated config modules.

If the build fails:

- *"View file ... does not contain expected section id"* — your `<section>` id doesn't match the config entry.
- *"Duplicate HTML id attributes detected"* — two elements (your view or another) share an `id`. Namespace.
- *"Duplicate CSS input entry"* — a shared prefix/suffix path or generated view stylesheet appears twice.

`npm test` additionally runs `scripts/check-dom-ids.mjs`, which catches IDs that the renderer code references but the DOM never emits, and vice versa. Treat its output as part of the build.

## Icons

Dock icons live in `ui/assets/icons/<icon>.svg`. The build script reads the SVG file referenced by `app.icon` in `app-registry.json` and inlines it into `app-registry.generated.js` as `iconMarkup`. Keep them as 24x24 viewBox single-color line icons, mirroring the existing set.

You don't need to wire the icon into HTML or CSS — `navigation-shell.js` builds the dock buttons by injecting `iconMarkup` into `<span class="app-nav-icon">`.

## Quick sanity test

After adding HTML/CSS but before adding any JS:

1. `npm run build:ui`
2. `npm start`
3. Click the new dock button (it will appear once you've also done step 3 in [04-adding-a-new-module.md](./04-adding-a-new-module.md)). The empty view should render with the topbar title set to `app.label` and the subtitle to `TITLES[viewId]`.

Layout right? Move on to wiring up logic.
