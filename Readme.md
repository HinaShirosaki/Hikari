<div align="center">

<img src="assets/icon.png" alt="Hikari" width="96" height="96" />

# Hikari

**A local-first lab workspace for the bench — planning, protocols, records, analysis, papers, and AI, all on your machine.**

<p>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-555?style=flat-square" alt="platforms" />
  <img src="https://img.shields.io/badge/Electron-40-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron 40" />
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node 20+" />
  <img src="https://img.shields.io/badge/local--first-no%20backend-7C3AED?style=flat-square" alt="local-first" />
  <img src="https://img.shields.io/badge/version-1.0.0-0EA5E9?style=flat-square" alt="version 1.0.0" />
</p>

<a href="#quick-start">Quick Start</a> ·
<a href="#app-surface">Features</a> ·
<a href="#ai-and-agent-setup">AI Setup</a> ·
<a href="#telegram-bot">Telegram</a> ·
<a href="#data-and-storage">Data</a> ·
<a href="#development">Development</a> ·
<a href="#troubleshooting">Troubleshooting</a>

</div>

![Hikari Home dashboard](docs/screenshots/home.png)

<sub>Home dashboard shown with fictional biology demo data. No private project records are included.</sub>

Hikari is a local-first Electron desktop app for day-to-day lab work. It brings project planning, protocol management, experiment records, assay and gel analysis, paper review, sequence inspection, and optional AI assistance into one desktop workspace — no hosted backend required.

## Highlights

- Local desktop app built with Electron — your data stays on your machine.
- One workspace for `Home`, `Protocols`, `Workflows`, `Biology Notebook` (including projects), `Sample & Inventory`, `Chemicals`, `Assay`, `Gel`, `Papers`, `Agent`, `Sequence Viewer`, `Tools`, and `Settings`.
- Snapshot save/load support for `.json` and `.ena` data files.
- Storage-root-backed files for notebooks, projects, papers, and sequence assets.
- Optional LLM-backed features for `Papers` and `Agent`.
- Optional Telegram bot for simple remote commands and lookups.

## App Surface

### Planning and operations

| Module | What it does |
| --- | --- |
| <img src="assets/icons/home.svg" width="16"/> `Home` | Dashboard with quick navigation, workflow progress, lab timer, and cell-passage reminders. |
| <img src="assets/icons/protocols.svg" width="16"/> `Protocols` | Protocol authoring, import/export, share flows, and notebook placeholders. |
| <img src="assets/icons/workflows.svg" width="16"/> `Workflows` | Graph-based workflow builder with templates and project linkage. |

### Experiment data

| Module | What it does |
| --- | --- |
| <img src="assets/icons/biology-notebook.svg" width="16"/> `Biology Notebook` | Project creation and dashboards plus protocol-linked experiment records, attachments, and PDF export. |
| <img src="assets/icons/sample-inventory.svg" width="16"/> `Sample & Inventory` | Registry for plasmids, cell lines, strains, antibodies, proteins, compounds, primers, and storage locations. |
| <img src="assets/icons/chemicals.svg" width="16"/> `Chemicals` | Shared reagent inventory with searchable records, locations, lots, and activity history. |
| <img src="assets/icons/assay.svg" width="16"/> `Assay` | Plate design, CSV mapping flow, result capture, and analysis views. |
| <img src="assets/icons/gel.svg" width="16"/> `Gel` | Manual gel analysis with lane/band annotation and CSV/JSON export. |

### Research and bench support

| Module | What it does |
| --- | --- |
| <img src="assets/icons/papers.svg" width="16"/> `Papers` | Local PDF library with project linkage, summaries, extracted methods, and project-scoped Q&A. |
| <img src="assets/icons/sequence-viewer.svg" width="16"/> `Sequence Viewer` | FASTA, FASTQ, GenBank, and raw-sequence inspection with annotations and restriction analysis. |
| <img src="assets/icons/tools.svg" width="16"/> `Tools` | Bench calculators: molarity, qPCR, CRISPR, oligo, buffer, peptide, translation, and colony-count workflows. |

### AI and configuration

| Module | What it does |
| --- | --- |
| <img src="assets/icons/agent.svg" width="16"/> `Agent` | Evidence-grounded assistant over app state, papers, workflows, and linked records. |
| <img src="assets/icons/settings.svg" width="16"/> `Settings` | Personal profile, appearance, startup behavior, storage path, Codex model setup, Telegram token, and data file controls. |

## Quick Start

### Prerequisites

- Node.js 20+
- npm

### Install and run

```bash
npm install
npm run start
```

### First launch checklist

1. Open `Settings`.
2. Set a `Storage Folder Path` for notebooks, project-linked files, papers, and sequence assets.
3. Use `Data File` controls to save an initial `.json` or `.ena` file.
4. Choose startup behavior if you want a default module or "remember last opened module".
5. Sign in to the Codex CLI for `Agent`.
6. Optionally add a Telegram bot token.

## AI and Agent Setup

Configure AI features in `Settings > Codex Model & Access`.

The Agent workspace uses:

- `Codex Agent (CLI)`

The model catalog is [`config/codex-models.json`](./config/codex-models.json). All LLM-backed features use the signed-in `codex` CLI; no API endpoint or API key is stored by the app.

### Codex Agent Setup

1. Install the `codex` CLI and make sure it is available on `PATH`.
2. Run `codex login`.
3. In `Settings > Codex Model & Access`, optionally choose a model and reasoning effort.

## Telegram Bot

You can configure the Telegram bot in either of these places:

- `Settings > Telegram Bot`
- environment variable `TELEGRAM_BOT_TOKEN`

Saved token location:

- `<userData>/telegram-bot.json`

Common commands:

- `/help`
- `/modules`
- `/open <module>`
- `/search <scope> <query>`
- `/inventory <query>`
- `/samples <query>`
- `/assay <query>`
- `/gel <query>`
- `/status`

<details>
<summary><strong>More commands</strong></summary>

- quick logging: `/log`, `/note`, `/use`
- protocol-run control: `/start_protocol`, `/next`, `/done`, `/timer`
- draft generation: `/draft_notebook`, `/draft_summary`, `/draft_assay`
- inventory queries: `/expiring`, `/lowstock`

</details>

The canonical command, search-scope, and alias maps live in [`src/main/lib/telegram-bot/config.js`](./src/main/lib/telegram-bot/config.js).

## Data and Storage

Hikari keeps state in a few layers:

- Fast local UI state in browser storage under `localStorage` key `hikari_state_v1`
- Snapshot save/load through `Settings > Data File`
- Storage-root-backed files for notebook attachments, project assets, paper uploads, and sequence-library data

Data file notes:

- Supported save/load extensions include `.json` and `.ena`
- The default filename is `hikari-data.json`
- Auto-save can be enabled for the current data file from `Settings`

Backup suggestions:

1. Keep auto-save enabled for your main working file.
2. Periodically save dated snapshots.
3. Back up the storage folder you configured in `Settings`, not just the snapshot file.

## Development

Generated files are part of the normal workflow. Do not hand-edit `index.html`, `styles.css`, or generated config modules unless you also update their source inputs.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run build:ui` | Generates `index.html`, `styles.css`, and generated provider/app-registry modules from `ui/` and `config/`. |
| `npm run check:dom-ids` | Verifies `document.getElementById(...)` calls against generated `index.html`. |
| `npm run report:modules` | Reports module relationships for the codebase. |
| `npm run start` | Builds the UI, then starts Electron in development mode. |
| `npm test` | Builds the UI, runs DOM ID checks, and executes `node test.js`. |
| `npm run package:app` | Creates packaged app artifacts with Electron Forge. |
| `npm run dist` | Builds installer/distribution artifacts with Electron Forge. |

Packaging notes:

- macOS builds produce a zip package
- Windows builds use Squirrel
- Linux builds use `deb` and `rpm`
- Build artifacts are written under `out/`

### Tests

- `test.js` is the main test entrypoint.
- `tests/suites/core/` covers app modules, contracts, and agent flows.
- `tests/suites/edge/` covers regression-style and edge-case suites.

## Project Layout

- `src/main/main.js`: Electron main process, window lifecycle, IPC wiring, LLM integration, and Telegram lifecycle.
- `src/main/storage/`: storage-bundle import/export, persistence, and sequence-library summary logic.
- `src/main/data/`: primary snapshot and data-helper utilities.
- `src/main/agent/`: Codex integration, MCP contracts, tool adapters, context, and agent runtime support.
- `src/main/lib/`: process-level integrations and shared utilities (Telegram bot, Codex agent launcher, LLM runtime, app-paths).
- `src/renderer/`: renderer shell, feature modules, shared state, and service layer.
- `ui/html/` and `ui/css/`: source fragments used to generate the shipped `index.html` and `styles.css`.
- `ui/config/`: source-of-truth ordering and app-registry config for generated UI assets.
- `config/codex-models.json`: Codex model catalog used to generate renderer and main-process model metadata modules.
- `docs/`: internal walkthroughs for renderer, main helpers, and the agent backend.

## Internal Docs

If you are onboarding to the codebase, start with the docs index and then the area you need:

- [`docs/README.md`](./docs/README.md) — internal docs index and architecture overview
- [`docs/renderer/README.md`](./docs/renderer/README.md)
- [`docs/main-platform/README.md`](./docs/main-platform/README.md)
- [`docs/agent/README.md`](./docs/agent/README.md)
- [`docs/module-development/README.md`](./docs/module-development/README.md) — how to add a new module
- [`tests/README.md`](./tests/README.md)

## Troubleshooting

<details>
<summary><strong>The app opens but my data is missing</strong></summary>

- Open `Settings > Data File` and load the correct `.json` or `.ena` file.
- Verify that auto-load is pointing at the file you expect.

</details>

<details>
<summary><strong>Papers or Agent says Codex is unavailable</strong></summary>

- Sign in with `codex login` and reopen `Settings > Codex Model & Access` to refresh the status.

</details>

<details>
<summary><strong>Codex mode is selected but nothing responds</strong></summary>

- Confirm `codex` is installed and available on `PATH`.
- Run `codex login`.

</details>

<details>
<summary><strong>File imports or paper uploads fail with path-related errors</strong></summary>

- Make sure `Storage Folder Path` is set in `Settings`.
- Re-open the relevant module after saving the path.

</details>

<details>
<summary><strong>Packaging fails</strong></summary>

- Re-run `npm install`.
- Confirm Electron Forge dependencies are present for your platform.

</details>
