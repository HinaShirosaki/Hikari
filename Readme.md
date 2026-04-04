# Enana

Enana is a local Electron desktop app for managing lab operations in one place: members, instruments, protocols, notebooks, inventory, assays, gel analysis, papers, workflows, and an assistant agent.

This README is a practical guide for running the app, configuring optional integrations, and understanding the project layout.

## Table of Contents

- [1) Feature Overview](#1-feature-overview)
- [2) Install and Run](#2-install-and-run)
- [3) First-Time Setup (Inside the App)](#3-first-time-setup-inside-the-app)
- [4) Typical Lab Workflow](#4-typical-lab-workflow)
- [5) LLM and Agent Setup](#5-llm-and-agent-setup)
- [6) Telegram Bot Setup](#6-telegram-bot-setup)
- [7) Data Save, Load, and Backup](#7-data-save-load-and-backup)
- [8) Scripts and Commands](#8-scripts-and-commands)
- [9) Test Suite Structure](#9-test-suite-structure)
- [10) Project Structure](#10-project-structure)
- [11) Troubleshooting](#11-troubleshooting)
- [12) Detailed Module Reference](#12-detailed-module-reference)

## 1) Feature Overview

Enana includes the following modules:

- `Members`: manage lab people and identities.
- `Instruments`: track instruments and reservations.
- `Protocols`: create protocol records and share/import protocol data.
- `Collabrations`: collaboration inbox and protocol exchange (label follows current UI spelling).
- `Synthesis Notebook` and `Biology Notebook`: notebook entries linked to projects/protocols.
- `Chemicals`: shared chemical inventory.
- `Sample & Inventory`: sample registry and personal container tracking.
- `Assay`: plate setup, CSV flow, result analysis.
- `Gel`: lane/band analysis workflow and exports.
- `Projects`: project registry and linked experimental context.
- `Workflows`: block-based protocol flow editor and templates.
- `Papers`: PDF uploads, extraction/summarization, project-scoped Q&A.
- `Agent`: read-first lab assistant with citations and decision records.
- `Sequence Viewer`: FASTA/FASTQ/GenBank inspection and sequence library support.
- `Tools`: bench calculators and utilities (molarity, qPCR, CRISPR, oligo, etc.).
- `Setting`: appearance, startup defaults, storage path, LLM config, Telegram token, and data file controls.

## 2) Install and Run

### Prerequisites

- Node.js 20+
- npm

### Start in development

```bash
npm install
npm run start
```

### Run tests

```bash
npm test
```

## 3) First-Time Setup (Inside the App)

After launching, open `Setting` and configure:

1. `Personal Information`: set name, role, and email identities.
2. `Storage Folder Path`: choose where notebook and project-linked files should live.
3. `Data File`: keep `Auto-save to current .json file` enabled and use `Save .json` once to set your initial save target.
4. Optional `LLM Model & API`: required for `Agent` and `Papers` AI features.
5. Optional `Telegram Bot`: add bot token to enable remote commands.

## 4) Typical Lab Workflow

A common first workflow:

1. Add lab members in `Members`.
2. Register instruments and reservations in `Instruments`.
3. Create or import protocols in `Protocols`.
4. Create a project in `Projects`.
5. Add notebook records in `Synthesis Notebook` or `Biology Notebook`.
6. Register chemicals and samples in `Chemicals` and `Sample & Inventory`.
7. Build assays and analyze results in `Assay`.
8. Run gel analysis in `Gel`.
9. Upload papers in `Papers` and ask project questions.
10. Build repeatable flows in `Workflows`.
11. Use `Agent` for evidence-grounded retrieval and planning support.

## 5) LLM and Agent Setup

Configure in `Setting > LLM Model & API`.

Supported providers:

- OpenAI
- Gemini
- Claude
- OpenAI CLI (Codex)

Environment variable fallbacks:

- `ENANA_LLM_API_KEY` (preferred)
- `LLM_API_KEY`

Default endpoints:

- OpenAI: `https://api.openai.com/v1/responses`
- Gemini: `https://generativelanguage.googleapis.com/v1beta`
- Claude: `https://api.anthropic.com/v1/messages`
- OpenAI CLI (Codex): `codex://cli`

OpenAI CLI (Codex) setup:

1. Install Codex CLI and ensure `codex` is available on `PATH`.
2. Run `codex login` and sign in.
3. In `Setting > LLM Model & API`, select `OpenAI CLI (Codex)`.
4. API key is optional for Codex CLI mode.

Notes:

- `Agent` and `Papers` AI features require valid LLM settings.
- Codex mode checks login state and surfaces an error if the session is not authenticated.

## 6) Telegram Bot Setup

Set token in either:

- `Setting > Telegram Bot`, or
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

## 7) Data Save, Load, and Backup

Persistence layers:

- Browser state: `localStorage` key `enana_state_v1`
- App save/load via `Setting > Data File`
- Default auto-save filename: `enana-data.json`

Supported data-file extensions include `.json` and `.ena` (for example `.ena.json` also works).

Recommended backup routine:

1. Keep auto-save enabled.
2. Periodically save snapshots to dated filenames.
3. Back up your storage folder path if notebook/project files are referenced there.

## 8) Scripts and Commands

| Command | Purpose |
| --- | --- |
| `npm run build:ui` | Build `index.html` and `styles.css` from `ui/html/**` and `ui/css/**`. |
| `npm run check:dom-ids` | Validate `getElementById` usage against generated markup. |
| `npm run start` | Build UI and launch Electron in development mode. |
| `npm test` | Build UI, run DOM ID checks, then run test runner (`node test.js`). |
| `npm run package:app` | Build UI and package app artifacts. |
| `npm run dist` | Build UI and generate installer artifacts (`electron-forge make`). |
| `npm run package` | Alias for packaging. |
| `npm run make` | Alias for distribution build. |

Build output is generated under `out/`.

Optional utility:

```bash
python3 scripts/generate_enana_summary_pdf.py
```

Generated file:

- `output/pdf/enana-app-summary.pdf`

## 9) Test Suite Structure

Entrypoint:

- `test.js`

Suites under `tests/suites/`:

- `core/agent-suite.js`: loader for agent-focused suites under `core/agent-suite/`.
- `core/agent-suite/*.js`: intent parsing, notebook flows, tool calls, science loops, paper flows, runtime state, and deep-research coverage.
- `core/app-modules-suite.js`: loader for renderer module suites under `core/app-modules-suite/`.
- `core/app-modules-suite/*.js`: renderer module behavior coverage.
- `core/contracts-suite.js`: UI/IPC contract and wiring checks.
- `edge/platform-and-regression-suite.js`: regression/static edge checks.
- `edge/bio-tools-and-gel-suite.js`: loader for edge suites under `edge/bio-tools-and-gel-suite/`.
- `edge/bio-tools-and-gel-suite/*.js`: sequence/tools/gel edge coverage.

Suite loaders:

- `tests/suites/core-suite.js`
- `tests/suites/edge-suite.js`

## 10) Project Structure

- `src/main/main.js`: Electron main process, IPC handlers, LLM/agent controller, Telegram lifecycle.
- `src/main/preload.js`: secure renderer bridge (`window.enanaApi`).
- `src/main/helpers/`: main-process helpers (agent + data + sequence library).
- `src/main/lib/`: main-process libraries (`telegramBot`, `codex-cli-provider`, etc.).
- `src/renderer/renderer.js`: renderer bootstrap and module wiring.
- `src/renderer/modules/`: renderer feature modules.
- `ui/html/**` + `ui/css/**`: source partials for generated UI.
- `ui/config/html-order.json`: source-of-truth HTML assembly order.
- `ui/config/css-order.json`: source-of-truth CSS assembly order.
- `scripts/build-ui.mjs`: deterministic generator for `index.html` and `styles.css`.
- `scripts/check-dom-ids.mjs`: static DOM ID consistency validation.
- `tests/README.md`: test maintenance conventions.
- `data/llm-prompts.json`: configurable prompts for papers/agent.
- `data/agent-io-contract.json`: tool contract for LLM-facing agent operations.

## 11) Troubleshooting

### App opens but data is missing

- Open `Setting > Data File` and load the correct file.
- Confirm your current auto-save target path.

### Agent or Papers says API key is missing

- Set key in `Setting > LLM Model & API`, or
- export `ENANA_LLM_API_KEY` / `LLM_API_KEY` before launch.

### Codex provider does not respond

- Ensure `codex` is installed and on `PATH`.
- Run `codex login` in your terminal.

### Telegram bot is not running

- Verify token format.
- Check bot status in `Setting > Telegram Bot`.
- If no saved token exists, app falls back to `TELEGRAM_BOT_TOKEN`.

### Notebook imports or paper uploads fail due to path errors

- Set `Storage Folder Path` in `Setting`.
- Re-open the affected module after saving the new path.

### Packaging fails

- Re-run `npm install`.
- Confirm Electron Forge dependencies are available.

## 12) Detailed Module Reference

### Home Dashboard

- Purpose: landing module for operational awareness and quick navigation.
- Cell passage reminders: reads `cell_line` sample records and surfaces overdue/soon/unconfigured passage schedules.
- Workflow progress: shows the next actionable step from the currently selected workflow.
- Lab timer: built-in countdown timer with presets, custom duration, start/pause/reset, and visual end alert.

### Members

- Purpose: maintain team identity records.
- Data captured: name, institution email, role/position, and Enana email.
- Supports create/edit/delete and card-based review.
- Enana email is reused by collaboration messaging and inventory sync routing.

### Instruments

- Purpose: register instruments and manage reservations.
- Supports month and week calendar views plus week drag-to-select for quick time block drafts.
- Reservation conflict detection blocks overlapping reservations.
- Reservation edit/delete is restricted to the original creator identity.
- Stores reservation metadata (title, date/time range, notes, owner label).

### Protocols

- Purpose: author, manage, share, and import protocols.
- Editor supports purpose/materials/steps/troubleshooting with bullet normalization.
- Step placeholders can be inserted as interactive tokens (for notebook filling).
- Includes protocol JSON import (file or pasted), list sorting, and PDF export.
- Supports two share paths: in-app protocol share messages and portable `enana://protocol-share/...` links.
- Integrates with Papers by accepting extracted-method drafts as new protocol drafts.

### Collabrations

- Purpose: internal Enana-style messaging and protocol exchange.
- Send/receive messages between member Enana emails.
- Inbox is scoped per selected Enana email identity.
- Protocol import supports shared messages, share links, and pasted JSON payloads.
- Accepts token formats such as `enana://protocol-share/...` and `ENANA_PROTOCOL_SHARE:...`.

### Synthesis Notebook

- Purpose: synthesis-focused experiment logging.
- Project-scoped entry workflow with inline placeholder editing.
- Captures outcome metadata: produced compound code, purity, assay usage, and linked references.
- Reference links include instrument, people, chemicals, samples, papers, and reagent lots.
- Built-in chemistry workspace integrates Ketcher, reaction scheme progression, substrate MW table, and procedure text.
- Imported result files are persisted under the configured storage path in project notebook folders.

### Biology Notebook

- Purpose: protocol-driven biology experiment logging.
- Project + protocol selection with protocol search and placeholder-aware step rendering.
- Saves structured values, notes, and attached files per entry.
- Supports editing existing entries and exporting notebook-entry PDFs.
- Uses the same storage-path-backed import pipeline for result files.

### Chemicals

- Purpose: shared chemical inventory with sync workflows.
- Tracks CAS, vendor, catalog, size, stock, pricing, location, expiration, and URL.
- Auto-generates stable location codes (for example `A1`, `A2`) per inventory location.
- Includes searchable/sortable list and a detail panel with linked sample visibility.
- Broadcasts inventory updates to members and supports inbox-based import of unread sync updates.
- Maintains an append-only hash-linked activity log for inventory mutations.

### Sample & Inventory

- Purpose: manage samples and link them to storage/inventory context.
- Supports types: plasmid, cell line, strain, antibody, purified protein, compound, primer.
- Dynamic location forms by storage type (freezer/fridge/desiccator/RT cabinet).
- Links samples to personal inventory containers/slots and related chemical records.
- Cell line mode captures passage schedule fields used by dashboard reminders.
- Compound mode embeds Ketcher and stores captured structure data (SMILES/molfile).

### Assay

- Purpose: design assay plates, capture results, and run analyses.
- Create mode supports multiple plate formats (6/12/24/48/96/384), axis templates, swap axis, and manual well overrides.
- CSV template export/import is supported for mapping workflows.
- Result mode loads saved plates, supports spreadsheet-like paste, and persists results.
- Analysis includes grouped/nested summaries, row/column summaries, regression, EC50/IC50, survival, and standard-curve fitting variants.
- Supports replicate grouping via manual group text and selection-driven group helpers.

### Gel

- Purpose: manual gel analysis and reporting.
- Supports optional crop workflow and image enhancement controls.
- Guided manual sequence includes borders, lane dividers, ladder designation, ladder MW points, and target band boundaries.
- Generates lane-level summaries with quantification and confidence-like interpretation fields.
- Saves analysis records linked to project/notebook context.
- Exports analysis output as JSON or CSV.

### Projects

- Purpose: maintain project registry and connected experiment context.
- Project CRUD with optional auto-directory creation under configured storage path.
- Project notebook page view aggregates associated entries and linked assays/gels.
- Deleting a project cascades removal/detachment across linked notebook entries, assay runs, gel analyses, and workflow bindings.

### Workflows

- Purpose: build repeatable protocol graphs and templates.
- Supports protocol blocks and plain-text blocks, with assignee and metadata fields.
- Includes visual graph editor for block layout, connection, disconnection, and multi-select operations.
- Workflow records can be linked to projects and notebook pages.
- Template system stores reusable graph structures and instantiates new workflows from templates.
- Workflow progress state feeds the Home dashboard next-step widget.

### Papers

- Purpose: manage project/journal-club PDFs and AI-assisted extraction.
- Upload pipeline stores PDFs under the storage path and links them to project or journal club context.
- Auto-ingestion chain: summarize paper, extract methods, extract reagents.
- Maintains ingestion status, readiness markers, and extraction artifacts (methods/reagents/key figures).
- Allows method-to-protocol draft creation and paper-to-experiment linking with notes.
- Project Library Q&A composes project-scoped context from papers, protocols, notebook entries, and links.

### Agent

- Purpose: evidence-grounded assistant over lab state.
- Project-scoped chat with context summary counts (projects, protocols, workflows, notebook entries, assays, gels, papers, inventory).
- Sends thin but structured state snapshots for retrieval-aware agent processing.
- Renders trace metadata including citations, tool traces, staged activity, routing, validation, and provenance summaries.
- Supports notebook-draft auto-save behavior when returned by agent responses.
- Keeps chat history per session and supports chat reset.

### Sequence Viewer

- Purpose: parse, inspect, annotate, and manage sequence records.
- Home workspace manages saved/unsaved sequence library entries and circular previews.
- Detail workspace supports pasted text or file input (FASTA, FASTQ, GenBank, raw sequence text).
- Dual-strand sequence view with feature rail, feature detail panel, and summary metrics.
- Includes NEB restriction-site annotation overlays and parser warning/error surfaces.
- Integrates with storage-backed save/reopen flows.

### Tools

- Purpose: consolidate bench calculators and design utilities.
- Included tools: molarity, peptide properties, buffer preparer, DNA-to-protein, protein-to-DNA reverse translation, protein assembler, oligo properties, extinction coefficient, qPCR efficiency, CRISPR sgRNA designer, colony counter.
- CRISPR tool provides reference-profile-aware guide design and ranked candidate table output.
- Colony counter supports crop, zoom/pan, manual marker placement/removal, and saved count output.

### Setting

- Purpose: global app configuration and integrations.
- Personal info and appearance configuration (font size, accent color, mode, UI style).
- Storage folder path selection used by notebooks, projects, papers, and sequence persistence.
- Startup/data behavior controls (default module, remember last module, auto-load data file).
- Inventory location management used by Chemicals and Sample modules.
- LLM provider/model/endpoint/key configuration with provider-aware defaults.
- Telegram token save/clear and live runtime status display.
- Data file controls for save/load and auto-save toggle.
