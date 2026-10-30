# Application i18n coverage

Reviewed 2026-10-29. The remaining app-owned UI migration is complete across the
twelve renderer feature families, shared shell/services, the Agent rail, and the
three first-party plugin interfaces. Settings → Appearance → Language now offers
English and Español (preview). Saving applies the preference without reloading,
updates native dialogs and plugin context, and retains it across launches. English
remains the default; untranslated Spanish messages fall back to English.

| Surface | Covered presentation |
| --- | --- |
| Home | Dashboard controls, contribution summaries, timers, paper-finding states/actions |
| Settings | Appearance/storage, account and usage, models, permissions, tools, skills, plugins and updates |
| Notebook | Projects/dashboard, page/experiment dialogs, linked previews, attachments, quick samples, bench tools and spreadsheet controls |
| Plate | Setup/layout/import, analysis/results, grid headers, chart format controls, pickers and tooltips |
| DNA | Library/detail, feature/primer editing, cloning, alignment, protein/vector builders and calculation tools |
| Agent | Composer/session controls, progress/trace presentation, review, sandbox, purchase and clarification cards |
| Papers | Library/viewer, comments, annotations, screenshots and action feedback |
| Samples, Chemicals, Protocols, Workflow, Tools | Editors, imports, validation/status feedback, menus, dialogs and generated controls |
| Shared UI | Search, navigation, quit/reload, storage setup, selection insights, print/export failure feedback |
| Gel, Figura, qPCR | Standalone English catalogs, plugin controls/statuses, generated tables and accessible labels |
| Main process | Application-owned open/save/message-dialog titles, buttons, details and file-filter labels |

## Catalogs and bindings

- Renderer English: each feature's `locales/en.js`, plus shared
  `src/renderer/lib/i18n/{en,shell-en}.js`.
- Plugin English: `locales/en.js` in `src/plugins/gel`,
  `plugins/scientific-illustration`, and `plugins/qpcr-analysis`.
- Native English: `src/main/lib/locales/en.json`.
- Spanish preview: renderer/plugin `locales/es.js`, shared `es.js`/`shell-es.js`,
  and native `src/main/lib/locales/es.json`. QA wrappers in
  `tests/fixtures/i18n/es*.mjs` reuse these product catalogs.

`full.<hash>` entries are deterministic IDs for extracted English source copy.
Existing semantic keys remain supported. New hand-authored features should prefer
semantic keys. Translation values are plain text; HTML and SVG stay in the view.
SVG text uses bound `tspan` leaves, and option labels bind to `option` elements
with explicit, unchanged values.

Text and individual attributes have independent parameters. Composed UI text can
retain several bound messages without rebuilding its controls. Literal data
writers clear stale text bindings. The optional `owned` presenter is used only
at identified UI formatter/status boundaries; it must not receive arbitrary
record names, editor text, agent answers, prompts or scientific values.

Plugin app-context events now carry the active display locale. First-party
plugins apply supported local catalogs and use English for unsupported locales;
Figura republishes its host toolbar labels when the locale changes. Locale
propagation does not save records or repeat calculations, inference or imports.
Native dialogs use a separate synchronous English-first catalog and receive
the saved display locale through the narrow `system:set-ui-locale` IPC channel.

## Data and dependency boundaries

Saved names, notes, sequences, formulas, schema keys, enum values, user/imported
column names, external provider errors, agent prompts/answers, bibliography and
scientific identifiers remain literal. Canonical diagnostic payloads, computation/trace formatters and
exported document content retain their data contracts; their UI chrome is bound
separately. OS-owned menu roles and third-party library internals keep their own
localization mechanisms. Website/tutorial translation and translated PDF/PPT/CSV
content are separate from the application UI layer.

Third-party JavaScript bundles contain no application translation helpers. The
Gel cropper and Tabulator bundles were verified byte-for-byte against their
committed upstream versions. The source-owned Gel view and stylesheet reside
beside those dependencies but are audited as application UI.

## Verification

`npm run check:i18n` checks catalog coverage, parameters, fallback behavior, native
message call sites, source UI literals/generated markup, all source HTML fragments,
and vendor boundaries. The coverage guard is also part of the normal selfchecks.
It catches literal-copy regressions; it is not a claim that every data-dependent
state has been rendered in every language.

`tests/i18n-electron.cjs` boots the real renderer with isolated workspace IPC and
exercises language changes, draft/focus/selection preservation, save/undo, stable
enums, clipboard/import/export continuity, cloned controls, independent attribute
parameters, chart option labels and composed messages. New catalog bindings are
also exercised with a marked QA locale, so English fallbacks cannot hide bypasses.
Renderer captures are under `artifacts/i18n-es/`.

`tests/i18n-plugins-electron.cjs` covers all three plugin interfaces with English
and Spanish fixtures, preserved drafts/controls/options, escaped translations and
1300/800px captures in `artifacts/i18n-plugins/`. The qPCR workflow fixture verifies
actual calculations, storage, append and export. The Gel workspace fixture checks
cropping/rotation, tables/charts, exports, editing and window bounds at four sizes.
Native and plugin-context selfchecks exercise regional fallback and propagation.

The repository tests, UI build, lint, import/layout, DOM-ID and CSS checks provide
additional regression coverage. This is source/isolated-renderer verification;
it does not install, restart, package or update the user's running app.

Final source verification on 2026-10-29: 1,372/1,372 repository tests; 7,303
renderer language checks (892 preboot labels and 13 initialized controllers);
213 plugin language checks; 710 Figura host checks; 17 qPCR unit checks and
13 qPCR browser workflow checks. The Gel floating-workspace fixture also passed.
The coverage guard checked 901 files, 17 namespaces and 19 HTML fragments.

Language-setting follow-up: `tests/i18n-settings-electron.cjs` exercises actual
product catalogs, Save changes / Discard, persistence across reloads, unchanged
record data and other form/editor drafts, native locale synchronization, and
1300/800/600px captures under `artifacts/i18n-language-setting/`.
`tests/i18n-settings-ipc-selfcheck.cjs` checks the preload/main route, native
Spanish messages and unsupported-value fallback.

Language-setting verification on 2026-10-29: 1,373/1,373 repository tests,
7,315 renderer language checks, 21 language-setting checks and 213 plugin
language checks passed. UI build, lint, DOM-ID checks and the i18n source guard
also passed. The installed app was not updated or restarted.
