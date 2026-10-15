# qPCR Analysis

An installable Hikari Tool Box plugin with two analyses:

- **Relative expression:** paste one row per biological sample with its group and technical target/reference Ct replicates. Calculates mean Ct, technical Ct SD, ΔCt, ΔΔCt, log₂ fold change, and fold change against the mean ΔCt of the selected calibrator group. Summarizes biological samples by group with geometric mean fold change.
- **Standard curve:** paste starting quantities and technical Ct replicates. Fits mean Ct against log₁₀ quantity and reports slope, intercept, R², amplification efficiency, residuals, and a plot.

Saved inputs rehydrate through the plugin's own `storage` blob. Results can be appended to an existing notebook page or exported as UTF-8 TSV with method metadata and the technical Ct values. Editing inputs invalidates the previous analysis before another append/export. A failed write keeps the draft and offers retry. Host Save also saves the draft.

## Install

1. In Hikari, open **Settings → Plugins → Add Plugin Folder**.
2. Select this `qpcr-analysis` folder.
3. Reload Hikari, then open **Tools → qPCR Analysis**.

No build step or external dependencies. Opening `index.html` directly supports local calculations; persistence, notebook access, and export require Hikari. Manifest permission changes require removing and re-adding the plugin.

## Input format

Paste tab-separated columns from a spreadsheet. Technical Ct values within a cell may be separated by commas, semicolons, or spaces. Headers are optional. Each biological sample must have a unique name. Group matching is case-sensitive.

Relative expression:

```tsv
Sample	Group	Target Ct	Reference Ct
Control 1	Control	25.0, 25.1, 24.9	20.0, 20.1, 19.9
Treated 1	Treated	23.0, 23.1, 22.9	20.0, 20.1, 19.9
```

Select `Control` as the calibrator. This example yields a treated fold change of 4.

Standard curve:

```tsv
Quantity	Ct
100000	18.0, 18.1, 17.9
10000	21.322, 21.422, 21.222
1000	24.644, 24.744, 24.544
100	27.966, 28.066, 27.866
10	31.288, 31.388, 31.188
```

Quantities must be positive and use consistent units. Enter each quantity once, combining its technical wells into that row. The fit gives each concentration mean equal weight. Blank, undetermined, nonnumeric, and zero Ct values are rejected for explicit review; no wells are silently dropped or replaced.

## Methods and boundaries

Technical replicates are averaged independently for target and reference within each biological sample. ΔCt = mean target Ct − mean reference Ct. The calibrator is the arithmetic mean of biological calibrator ΔCt values. ΔΔCt = sample ΔCt − mean calibrator ΔCt, and fold change = 2^(−ΔΔCt). The model assumes approximately equal amplification efficiencies near 100%; use independently validated assays. It does not apply efficiency correction, combine reference genes, or perform significance tests. A single replicate has no SD, displayed as `—`.

The standard curve uses ordinary least squares with log₁₀(quantity) on x and mean Ct on y. Efficiency (%) = (10^(−1/slope) − 1) × 100. Three distinct concentrations are the minimum accepted input, not a claim of assay validation. The tool does not automatically remove outliers or label an assay as passing.

Scientific documentation: [Thermo Fisher comparative Ct method](https://www.thermofisher.com/us/en/home/life-science/pcr/real-time-pcr/real-time-pcr-learning-center/real-time-pcr-basics/essentials-real-time-pcr.html), [Bio-Rad SsoAdvanced guide, PCR efficiency](https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10031339.pdf).

## API basis

The plugin was implemented from the documentation below, without reading Hikari host implementation code or other plugins. The plugin itself imports no host code:

- [Quickstart](../../docs/plugins/quickstart.md): folder/install workflow, accessible states, exclusive writes, safe text rendering.
- [Plugin system §1.3–1.7](../../docs/plugins/plugin-system.md): folder id, manifest, permissions, tool placement.
- [Plugin API §1.1–1.2](../../docs/plugins/plugin-api.md): raw `postMessage` protocol, tool UI and appearance. `hikari.js` independently implements that documented protocol.
- [Plugin API §2–3](../../docs/plugins/plugin-api.md): `app.info`, `app.context`, `storage.get/set`, `app.setUnsaved`, `app.save`, `notebook.list/appendResult`, `downloads.save`.

Permissions are limited to `storage`, `notebook:read`, `notebook:write`, and `downloads`. There are no host DOM references, preload calls, host imports, external libraries, or network requests. Method reference links open only when clicked.

## Verification

```sh
node --test plugins/qpcr-analysis/tests/analysis.test.cjs plugins/qpcr-analysis/tests/client.test.cjs
node node_modules/electron/cli.js plugins/qpcr-analysis/tests/ui-electron.cjs
```

The Electron fixture serves the tool in a sandboxed iframe on a separate loopback origin. Its parent implements only the documented public protocol with disposable data. It checks UI calculations, error/retry, permission removal, save/rehydration, concurrent edits, notebook append, download cancellation, day/night appearance, and narrow/large-font layouts. It does not install into or modify a user's Hikari profile.

Verified on 2026-10-13: 17 calculation/client tests and 13 Electron UI checks passed. A separate integration run booted the documented Hikari source entry point with a temporary profile and workspace, installed this folder through **Settings → Plugins → Add Plugin Folder**, reloaded, and opened its tile in **Tools**. The actual bridge handshake, saved-input recovery, notebook-page listing, result append, and notebook text/table persistence after reload all passed. That integration run used only app UI actions and documented plugin verbs; it did not inspect or patch host sources. Download cancellation and failure/retry handling passed in the public-protocol fixture; the native save dialog was not exercised.
