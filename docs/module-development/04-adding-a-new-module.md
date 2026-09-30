# 4. Adding a new module: the recipe

This walks through every file you need to touch to add a new view called `My Feature`. Total: 6 files for the smallest module, plus an optional service.

## The plan

| Step | File | What you do |
| --- | --- | --- |
| 1 | `ui/html/views/my-feature-view.html` | create view fragment |
| 2 | `ui/css/views/my-feature-view.css` | create stylesheet |
| 3 | `assets/icons/my-feature.svg` | drop the dock icon |
| 4 | `ui/config/app-registry.json` | declare the view key/id, subtitle, dock entry, label, and aliases, and add the view to `viewOrder` |
| 5 | `src/renderer/modules/my-feature/` | controller |
| 6 | `src/renderer/module-manifests/my-feature.js` | declare init + registry key + render hooks |
| 7 *(optional)* | `src/renderer/services/myFeatureService.js` | only if other modules need to react to your changes |

The build discovers the HTML and CSS files from the declared `viewId`. It generates `views.js`, validates the section ID, and adds the files to `index.html` and `styles.css`.

## Step 1 — view fragment

Create `ui/html/views/my-feature-view.html`:

```html
<section id="my-feature-view" class="view" aria-label="My Feature">
  <div class="my-feature-layout left-rail-template">
    <aside
      class="my-feature-rail app-left-rail left-rail-template__rail"
      data-sync-left-rail
      aria-label="My Feature navigation"
    >
      <div class="app-left-rail-section">
        <button id="my-feature-add-btn" type="button" class="primary-btn">
          Add Item
        </button>
        <p id="my-feature-status" class="small-note"></p>
      </div>
      <div id="my-feature-list" class="app-left-rail-list" aria-live="polite"></div>
    </aside>

    <div class="my-feature-content left-rail-template__main">
      <div class="panel">
        <h2>My Feature</h2>
        <p class="small-note">A short description.</p>
        <div id="my-feature-detail"></div>
      </div>
    </div>
  </div>
</section>
```

Key checks:

- `<section id="my-feature-view" class="view">` — the build script enforces both.
- All inner IDs are namespaced with `my-feature-…`. Build will fail on duplicates with any existing element.

## Step 2 — stylesheet

Create `ui/css/views/my-feature-view.css`:

```css
#my-feature-view .my-feature-rail {
  display: grid;
  gap: 14px;
  align-content: start;
}

#my-feature-view .my-feature-content {
  display: grid;
  gap: 16px;
}

#my-feature-view #my-feature-list {
  display: grid;
  gap: 6px;
}

#my-feature-view .my-feature-row {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  cursor: pointer;
}

#my-feature-view .my-feature-row.is-active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--surface) 70%, var(--surface-subtle));
}
```

Always scope under `#my-feature-view`. Reuse design tokens (`--accent`, `--line`, `--surface`).

## Step 3 — dock icon

Save the SVG at `assets/icons/my-feature.svg`. Use a 24×24 viewBox, `stroke="currentColor"`, no fills, line widths around 1.75 for visual consistency with the existing dock icons.

(The `assets/icons/` path is referenced from `ui/config/app-registry.json` via the `icon` field; the build script reads the SVG file and inlines it into `app-registry.generated.js`.)

## Step 4 — `ui/config/app-registry.json`

Add a new entry to `apps[]`:

```json
{
  "id": "my-feature",
  "viewKey": "MY_FEATURE",
  "label": "My Feature",
  "viewId": "my-feature-view",
  "subtitle": "Short description shown under the page title.",
  "icon": "my-feature.svg",
  "placement": "more",
  "aliases": ["myfeature", "feature"],
  "searchInputId": ""
}
```

Add `"my-feature-view"` to the `viewOrder[]` array too; the build requires every app and supplemental view to appear there exactly once, and uses that order to stitch `index.html`.

Set `"agentChatRail": true` if the view should get the scoped agent chat side rail (Notebook, Plate, and Papers use it).

If you want this in the always-visible dock (not the overflow "More" menu), set `"placement": "dock"` and add the id to `dockOrder[]` at the top of the file. The build asserts `dockOrder.length === count(apps with placement=dock)` and that every dock id is also in `dockOrder`.

`searchInputId` lets the topbar search route a query to a specific input inside your view — leave it empty unless your view has its own search field.

## Generated view constants

Do not edit `src/renderer/modules/views.js` directly. Put the key and subtitle on the app-registry entry:

```json
{
  "id": "my-feature",
  "viewKey": "MY_FEATURE",
  "label": "My Feature",
  "viewId": "my-feature-view",
  "subtitle": "Short description shown under the page title."
}
```

`npm run build:ui` generates `VIEWS.MY_FEATURE` and its `TITLES` entry. Keep the key in `SCREAMING_SNAKE_CASE`; the view ID must match the `<section id="...">`.

If the view should be selectable from `Settings → Startup → Default View`, add the generated `VIEWS` key to `STARTUP_DEFAULT_VIEW_IDS` in `modules/app-state/defaults.js`.

## Controller

Create `src/renderer/modules/my-feature/index.js`:

```js
export function initMyFeature({
  state,
  persist,
  createId,
  safeText,
  onMyFeatureChanged = () => {}
}) {
  const root = document.getElementById('my-feature-view');
  const listElement = document.getElementById('my-feature-list');
  const addBtn = document.getElementById('my-feature-add-btn');
  const statusElement = document.getElementById('my-feature-status');
  const detailElement = document.getElementById('my-feature-detail');

  if (!root || !listElement || !addBtn || !statusElement || !detailElement) {
    return { render: () => {} };
  }

  const uiState = {
    selectedId: ''
  };

  function ensureItems() {
    if (!Array.isArray(state.myFeatureItems)) {
      state.myFeatureItems = [];
    }
    return state.myFeatureItems;
  }

  function renderList() {
    const items = ensureItems();
    listElement.innerHTML = items.map((item) => `
      <button type="button"
              class="my-feature-row${item.id === uiState.selectedId ? ' is-active' : ''}"
              data-id="${safeText(item.id)}">
        <span>${safeText(item.name || 'Untitled')}</span>
      </button>
    `).join('') || '<p class="small-note">No items yet.</p>';
  }

  function renderDetail() {
    const items = ensureItems();
    const item = items.find((entry) => entry.id === uiState.selectedId);
    if (!item) {
      detailElement.innerHTML = '<p class="small-note">Select an item from the rail.</p>';
      return;
    }
    detailElement.innerHTML = `
      <h3>${safeText(item.name)}</h3>
      <p class="small-note">Created ${safeText(item.createdAt)}</p>
    `;
  }

  function render() {
    renderList();
    renderDetail();
    statusElement.textContent = `${ensureItems().length} item(s)`;
  }

  addBtn.addEventListener('click', () => {
    const items = ensureItems();
    const item = {
      id: createId(),
      name: `Item ${items.length + 1}`,
      createdAt: new Date().toISOString()
    };
    items.push(item);
    uiState.selectedId = item.id;
    persist();
    onMyFeatureChanged();
    render();
  });

  listElement.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-id]')
      : null;
    if (!button) return;
    uiState.selectedId = button.dataset.id || '';
    render();
  });

  return {
    render,
    renderList
  };
}
```

## Module manifest

Create one manifest file:

```js
import { initMyFeature } from '../modules/my-feature/index.js';

export const myFeatureManifest = {
  key: 'myFeature',
  init: initMyFeature,
  viewKey: 'MY_FEATURE',
  bootOrder: 130,
  createOptions: ({
    state,
    persist,
    createId,
    safeText,
    rendererServices
  }) => ({
    state,
    persist,
    createId,
    safeText,
    onMyFeatureChanged: rendererServices.notebook.handleNotebookEntriesChanged
  }),
  render: ({ modules }) => modules.myFeature.render()
};
```

The `key` is the registry key other modules will use. `viewKey` points at the matching `VIEWS.<KEY>` entry and lets the runtime add the normal `renderView()` dispatcher. Use `viewIds` when one module owns multiple route ids, and `navigationAliases` when one route should highlight or title itself as another route.

Then add it to [src/renderer/module-manifests/index.js](../../src/renderer/module-manifests/index.js), usually in the group that matches when it should initialize. Each group loads its manifests one at a time through `loadManifests`, so a manifest that fails to import is logged and skipped rather than breaking the renderer:

```js
export const inventoryModuleManifests = await loadManifests([
  // ...
  ['./my-feature.js', 'myFeatureManifest']
]);
```

If you want your module to also render at app boot, add `bootOrder`. The runtime uses `renderAll` when present and otherwise falls back to `render`. For modules that are only event/tool wiring, omit `viewKey`, route render hooks, and `bootOrder`.

## Optional service

Skip unless other modules need to **react** to changes inside your module.

Create `src/renderer/services/myFeatureService.js`:

```js
export function createMyFeatureService(registry) {
  function handleMyFeatureChanged() {
    registry.get('biologyNotebook').renderEntries?.();
    registry.get('homeDashboard').render?.();
  }

  function openMyFeatureItem(itemId) {
    registry.get('myFeature').openEntry?.(itemId);
  }

  return {
    handleMyFeatureChanged,
    openMyFeatureItem
  };
}
```

Wire it in `src/renderer/services/index.js`:

```js
import { createMyFeatureService } from './myFeatureService.js';

// add to the named exports
export { /* ..., */ createMyFeatureService };

// add to the createRendererServices return value
export function createRendererServices(registry) {
  return {
    // ...
    myFeature: createMyFeatureService(registry)
  };
}
```

Then in your module manifest you can pass the service to other modules (`rendererServices.myFeature.handleMyFeatureChanged`) and they call it after their own mutations.

## Build and run

```sh
npm run build:ui
npm start
```

Expected output for `build:ui`:

```
Built src/main/generated/codex-model-catalog.generated.js, src/renderer/modules/codex-model-catalog.generated.js, src/renderer/modules/app-registry.generated.js, src/renderer/modules/views.js, index.html, styles.css
```

(All six paths printed.) If anything is missing, the build aborted; read the `[build-ui] Failed:` line above.

In the running app:

1. Click the new dock button (or open "More" if you used `placement: "more"`).
2. Verify the topbar title is "My Feature" and the subtitle matches `TITLES[VIEWS.MY_FEATURE]`.
3. Verify the rail list, detail panel, and Add button work.
4. Reload the window — the items you added should still be there (state persisted to localStorage).
5. Open DevTools → Application → Local Storage → `hikari_state_v1` and check that `myFeatureItems` is present in the stored JSON.

## Recommended folder layout

Start with `index.js` and add focused files as the feature grows:

```
src/renderer/modules/my-feature/
  index.js          # initMyFeature, DOM lookup, orchestration
  state.js          # ensure/normalize helpers, pure functions on state
  rendering.js      # buildRow(item), buildDetail(item), …
  events.js         # bindEvents({ root, on... })  (optional)
  constants.js      # column labels, status copy
  Readme.md         # short note on layout
```

Import `../modules/my-feature/index.js` from the manifest. Look at [src/renderer/modules/personal-inventory/](../../src/renderer/modules/personal-inventory/) and [src/renderer/module-manifests/personal-inventory.js](../../src/renderer/module-manifests/personal-inventory.js) for a complete example.

## Removing a module

Reverse the steps. Delete the view, stylesheet, icon, and module folder; remove the app and `viewOrder` entry from `app-registry.json`; drop the module manifest export and any service references; then run `npm run build:ui`. Generated `VIEWS`/`TITLES`, HTML, and CSS update automatically.

## Done

You now have a fully wired module that lives in the dock, persists state, and can talk to other modules. Read the next page if you need to talk to other modules in more elaborate ways.
