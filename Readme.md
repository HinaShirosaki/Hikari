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

<!--
  📸 SCREENSHOTS — these are images Claude cannot capture for you.
  Run the app (`npm run start`), take screenshots, and save them to docs/screenshots/
  using the exact filenames referenced below. They will appear automatically.
  See the "Screenshots" section for the full shot list and capture tips.
-->

<!-- Hero shot: save a full-window screenshot of the Home dashboard here -->
![Hikari Home dashboard](docs/screenshots/home.png)

Hikari is a local-first Electron desktop app for day-to-day lab work. It brings project planning, protocol management, experiment records, assay and gel analysis, paper review, sequence inspection, and optional AI assistance into one desktop workspace — no hosted backend required.

## Highlights

- Local desktop app built with Electron — your data stays on your machine.
- One workspace for `Home`, `Protocols`, `Projects`, `Workflows`, `Biology Notebook`, `Sample & Inventory`, `Chemicals`, `Assay`, `Gel`, `Papers`, `Agent`, `Sequence Viewer`, `Tools`, and `Settings`.
- Snapshot save/load support for `.json` and `.ena` data files.
- Storage-root-backed files for notebooks, projects, papers, and sequence assets.
- Optional LLM-backed features for `Papers` and `Agent`.
- Optional Telegram bot for simple remote commands and lookups.

## Screenshots

> **These images do not exist in the repo yet — you need to add them.** Claude cannot launch the
> desktop app or take screenshots, so this is the one part of the README you must fill in by hand.
>
> **How to add them:**
> 1. Run the app: `npm run start`.
> 2. Open each module and capture the window (macOS: `Cmd+Shift+4` then `Space`, click the window).
> 3. Create the folder `docs/screenshots/` and save each file with the **exact name** listed below.
> 4. The images then render automatically here and in the hero above — no Markdown edits needed.
>
> Keep shots ~1600px wide, PNG, and crop to the app window. Replace any sample data with something
> you're happy to show publicly before capturing.

| File to save (`docs/screenshots/…`) | What to capture |
| --- | --- |
| `home.png` | Home dashboard (also used as the hero image at the top) |
| `workflows.png` | A workflow graph with a few linked steps |
| `notebook.png` | A Biology Notebook record with structured fields |
| `assay.png` | An assay plate layout or analysis view |
| `gel.png` | A gel image with lane/band annotations |
| `papers.png` | The Papers library with a summary open |
| `sequence-viewer.png` | A sequence with annotations / restriction sites |
| `agent.png` | An Agent answer citing app records |

<!-- Drop the matching PNGs in docs/screenshots/ and uncomment any extra shots you want shown inline. -->

## App Surface

### Planning and operations

| Module | What it does |
| --- | --- |
| <img src="assets/icons/home.svg" width="16"/> `Home` | Dashboard with quick navigation, workflow progress, lab timer, and cell-passage reminders. |
| <img src="assets/icons/protocols.svg" width="16"/> `Protocols` | Protocol authoring, import/export, share flows, and notebook placeholders. |
| <img src="assets/icons/folder-2-svgrepo-com.svg" width="16"/> `Projects` | Project registry with linked notebook, assay, gel, and paper context. |
| <img src="assets/icons/workflows.svg" width="16"/> `Workflows` | Graph-based workflow builder with templates and project linkage. |

### Experiment data

| Module | What it does |
| --- | --- |
| <img src="assets/icons/biology-notebook.svg" width="16"/> `Biology Notebook` | Protocol-linked experiment records with structured fields, attachments, and PDF export. |
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
| <img src="assets/icons/settings.svg" width="16"/> `Settings` | Personal profile, appearance, startup behavior, storage path, LLM provider setup, Telegram token, and data file controls. |

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

Configure AI features in `Settings > LLM Model & Access`.

The shipped agent uses:

- `Codex Agent (CLI)`

API-backed agent providers remain available for development builds when
`allowApiAgent` is set to `true` in [`config/llm-providers.json`](./config/llm-providers.json):

- `OpenAI`
- `Gemini`
- `Claude`
- `DeepSeek`

Environment variable fallbacks:

- `HIKARI_LLM_API_KEY`
- `LLM_API_KEY`

Notes:

- `Agent` defaults to Codex and ignores persisted API-agent selections while `allowApiAgent` is `false`.
- Provider defaults come from [`config/llm-providers.json`](./config/llm-providers.json).
- DeepSeek uses the OpenAI-compatible Chat Completions API at `https://api.deepseek.com`.
- Codex Agent mode does not use an API endpoint or API key; it uses the signed-in `codex` CLI plus Hikari MCP tools.

### Codex Agent Setup

1. Install the `codex` CLI and make sure it is available on `PATH`.
2. Run `codex login`.
3. In `Settings > LLM Model & Access`, select `Codex Agent (CLI)`.
4. Optionally choose a model and reasoning effort.

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
- `src/main/agent/`: agent backend, tool execution, runtime orchestration, and deep-research pipeline.
- `src/main/lib/`: process-level integrations and shared utilities (Telegram bot, Codex agent launcher, LLM runtime, app-paths).
- `src/renderer/`: renderer shell, feature modules, shared state, and service layer.
- `ui/html/` and `ui/css/`: source fragments used to generate the shipped `index.html` and `styles.css`.
- `ui/config/`: source-of-truth ordering and app-registry config for generated UI assets.
- `config/llm-providers.json`: provider catalog used to generate renderer and main-process LLM config modules.
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
<summary><strong>Papers or Agent says an API key is missing</strong></summary>

- For OpenAI, Gemini, Claude, or DeepSeek, set the provider, model, endpoint, and key in `Settings > LLM Model & Access`.
- For Codex Agent, sign in with `codex login`; no endpoint or API key is used.
- Or export `HIKARI_LLM_API_KEY` / `LLM_API_KEY` before launching the app.

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
