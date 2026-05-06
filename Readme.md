# Enana

Enana is a local-first Electron desktop app for day-to-day lab work. It brings project planning, protocol management, experiment records, assay and gel analysis, paper review, sequence inspection, and optional AI assistance into one desktop workspace without requiring a hosted backend.

## Highlights

- Local desktop app built with Electron.
- One workspace for `Home`, `Instruments`, `Protocols`, `Projects`, `Workflows`, `Biology Notebook`, `Sample & Inventory`, `Chemicals`, `Assay`, `Gel`, `Papers`, `Agent`, `Sequence Viewer`, `Tools`, and `Settings`.
- Snapshot save/load support for `.json` and `.ena` data files.
- Storage-root-backed files for notebooks, projects, papers, and sequence assets.
- Optional LLM-backed features for `Papers` and `Agent`.
- Optional Telegram bot for simple remote commands and lookups.

## App Surface

### Planning and operations

- `Home`: dashboard with quick navigation, workflow progress, lab timer, and cell-passage reminders.
- `Instruments`: instrument calendar and reservation management.
- `Protocols`: protocol authoring, import/export, share flows, and notebook placeholders.
- `Projects`: project registry with linked notebook, assay, gel, and paper context.
- `Workflows`: graph-based workflow builder with templates and project linkage.

### Experiment data

- `Biology Notebook`: protocol-linked experiment records with structured fields, attachments, and PDF export.
- `Sample & Inventory`: sample registry for plasmids, cell lines, strains, antibodies, proteins, compounds, primers, and storage locations.
- `Chemicals`: shared reagent inventory with searchable records, locations, lots, and activity history.
- `Assay`: plate design, CSV mapping flow, result capture, and analysis views.
- `Gel`: manual gel analysis with lane/band annotation and CSV/JSON export.

### Research and bench support

- `Papers`: local PDF library with project linkage, summaries, extracted methods, and project-scoped Q&A.
- `Sequence Viewer`: FASTA, FASTQ, GenBank, and raw-sequence inspection with annotations and restriction analysis.
- `Tools`: bench calculators and utilities including molarity, qPCR, CRISPR, oligo, buffer, peptide, translation, and colony-count workflows.

### AI and configuration

- `Agent`: evidence-grounded assistant over app state, papers, workflows, and linked records.
- `Settings`: personal profile, appearance, startup behavior, storage path, LLM provider setup, Telegram token, and data file controls.

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
5. Optionally configure an LLM provider for `Papers` and `Agent`.
6. Optionally add a Telegram bot token.

## AI and Agent Setup

Configure AI features in `Settings > LLM Model & Access`.

Supported providers:

- `OpenAI`
- `Gemini`
- `Claude`
- `Codex Agent (CLI)`

Environment variable fallbacks:

- `ENANA_LLM_API_KEY`
- `LLM_API_KEY`

Notes:

- `Papers` and `Agent` require valid LLM settings.
- Provider defaults come from [`config/llm-providers.json`](./config/llm-providers.json).
- Codex Agent mode does not use an API endpoint or API key; it uses the signed-in `codex` CLI plus Enana MCP tools.

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

## Data and Storage

Enana keeps state in a few layers:

- Fast local UI state in browser storage under `localStorage` key `enana_state_v1`
- Snapshot save/load through `Settings > Data File`
- Storage-root-backed files for notebook attachments, project assets, paper uploads, and sequence-library data

Data file notes:

- Supported save/load extensions include `.json` and `.ena`
- The default filename is `enana-data.json`
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
- `src/main/helpers/main/`: persistence, storage-bundle import/export, sequence-library logic, and main-process IPC registrars.
- `src/main/helpers/agent/`: agent backend, tool execution, runtime orchestration, and deep-research pipeline.
- `src/main/lib/`: process-level integrations such as the Telegram bot and Codex agent launcher.
- `src/renderer/`: renderer shell, feature modules, shared state, and service layer.
- `ui/html/` and `ui/css/`: source fragments used to generate the shipped `index.html` and `styles.css`.
- `ui/config/`: source-of-truth ordering and app-registry config for generated UI assets.
- `config/llm-providers.json`: provider catalog used to generate renderer and main-process LLM config modules.
- `docs/`: internal walkthroughs for renderer, main helpers, and the agent backend.

## Internal Docs

If you are onboarding to the codebase, these are the best starting points:

- [`docs/renderer/README.md`](./docs/renderer/README.md)
- [`docs/main-helpers/README.md`](./docs/main-helpers/README.md)
- [`docs/agent/README.md`](./docs/agent/README.md)
- [`tests/README.md`](./tests/README.md)

## Troubleshooting

### The app opens but my data is missing

- Open `Settings > Data File` and load the correct `.json` or `.ena` file.
- Verify that auto-load is pointing at the file you expect.

### Papers or Agent says an API key is missing

- For OpenAI, Gemini, or Claude, set the provider, model, endpoint, and key in `Settings > LLM Model & Access`.
- For Codex Agent, sign in with `codex login`; no endpoint or API key is used.
- Or export `ENANA_LLM_API_KEY` / `LLM_API_KEY` before launching the app.

### Codex mode is selected but nothing responds

- Confirm `codex` is installed and available on `PATH`.
- Run `codex login`.

### File imports or paper uploads fail with path-related errors

- Make sure `Storage Folder Path` is set in `Settings`.
- Re-open the relevant module after saving the path.

### Packaging fails

- Re-run `npm install`.
- Confirm Electron Forge dependencies are present for your platform.
