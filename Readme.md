# Enana

Enana is a local Electron desktop app for running lab work in one place: members, instruments, protocols, notebooks, inventory, assays, gel analysis, papers, workflows, and an assistant agent.

This README is a hands-on tutorial for using the app end to end.

## Table of Contents

- [1) What You Can Do in Enana](#1-what-you-can-do-in-enana)
- [2) Install and Run](#2-install-and-run)
- [3) First-Time Setup (Inside the App)](#3-first-time-setup-inside-the-app)
- [4) Tutorial: A Full Lab Workflow](#4-tutorial-a-full-lab-workflow)
- [5) Search and Navigation Tips](#5-search-and-navigation-tips)
- [6) Save, Load, and Back Up Data](#6-save-load-and-back-up-data)
- [7) LLM and Agent Setup](#7-llm-and-agent-setup)
- [8) Telegram Bot Setup](#8-telegram-bot-setup)
- [9) Build, Package, and Test](#9-build-package-and-test)
- [10) Project Structure](#10-project-structure)
- [11) Troubleshooting](#11-troubleshooting)

## 1) What You Can Do in Enana

Enana includes these modules in one app:

- `Members`: lab people and contact identities (institution + Enana email)
- `Instruments`: instrument records with reservation calendar
- `Protocols`: protocol authoring, PDF export, and sharing/import
- `Collabrations`: internal Enana-style messaging and protocol imports
- `Synthesis Notebook` and `Biology Notebook`: notebook pages linked to projects/protocols
- `Chemicals`: shared chemical inventory and sync inbox
- `Sample & Inventory`: sample registry + personal container tracking
- `Assay`: plate map setup, CSV import/export, and results analysis
- `Gel`: manual gel lane/band workflow with report export
- `Projects`: project registry and linked notebook pages
- `Workflows`: protocol-block flow editor + reusable templates
- `Papers`: PDF uploads, LLM summary/extraction, project Q&A
- `Agent`: read-first lab assistant with citations and decision records
- `Tools`: bench calculators (molarity, oligo, qPCR, pLannotate, etc.)
- `Setting`: appearance, storage path, LLM/API, Telegram token, and JSON data file controls

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

After launch, open `Setting` and configure these first:

1. `Personal Information`

- Set your name, position, and emails.
- This helps default assignments and collaboration flows.

2. `Storage Folder Path`

- Pick a root folder for notebook-related files.
- Notebook pages can reference files under this path.

3. `Data File (.json)`

- Keep `Auto-save to current .json file` enabled (recommended).
- Click `Save .json` once and choose a location (or use default).

4. Optional: `LLM Model & API`

- Required for Agent and Papers AI features.
- Set model, endpoint, and API key.

5. Optional: `Telegram Bot`

- Paste bot token if you want Telegram remote commands.

## 4) Tutorial: A Full Lab Workflow

Use this sequence for a realistic first project.

### Step A: Add Members

Open `Members`:

- Add each teammate with institution email and Enana email.
- Enana emails are used in collaboration inbox/message flows.

### Step B: Add Instruments and Reservations

Open `Instruments`:

- Create instruments.
- Select one instrument and add reservations by date/time.
- Use Month/Week calendar view to inspect schedule.

### Step C: Create Protocols

Open `Protocols`:

- Create a protocol with purpose, materials, steps, troubleshooting.
- Use `Insert Interactive Bar` for placeholder-style step variables.
- Use `Share` to send protocol payloads or copy share links.

### Step D: Create a Project

Open `Projects`:

- Add a project name and description.
- This project becomes context for notebooks, assays, gel records, papers, and agent scope.

### Step E: Record Notebook Entries

Open `Synthesis Notebook` or `Biology Notebook`:

- Select project and protocol.
- Record results/notes and attach files.
- Save entry; it becomes available to Projects/Assay/Gel/Papers contexts.

Synthesis notebook supports an embedded Ketcher workflow for reaction capture and MW tables.

### Step F: Register Chemicals and Samples

Open `Chemicals`:

- Add shared chemicals with CAS, location, vendor, stock, expiration.

Open `Sample & Inventory`:

- Register samples (plasmid/cell line/compound/etc.).
- Link samples to personal inventory containers/slots.

### Step G: Build and Analyze an Assay

Open `Assay`:

1. In `Create Assay`, choose project, plate type, and axis mode.
2. Fill mappings directly in plate preview or via CSV import.
3. Save assay plate (auto assay numbers like `ASY-000001`).
4. Switch to `View & Results`, load plate, paste/import values.
5. Save results and run analysis method (grouped, EC50/IC50, regression, etc.).

### Step H: Analyze a Gel

Open `Gel`:

1. Upload image and set basic metadata.
2. Optionally crop image.
3. Click `Analyze Gel` and complete manual steps (borders, dividers, ladder, bands).
4. Save analysis and export JSON/CSV if needed.

### Step I: Add Papers and Ask Questions

Open `Papers`:

- Upload PDFs and link to a project or journal club.
- Run summarize/method/reagent extraction (requires LLM config).
- Use `Project Library Q&A` to ask project-scoped literature questions.

### Step J: Plan With Workflows and Agent

Open `Workflows`:

- Create protocol-block workflows.
- Connect blocks in graph editor.
- Save templates for repeatable pipelines.

Open `Agent`:

- Ask scoped lab questions.
- Agent stays read-first, cites retrieved data, and flags write intent as approval-required.

## 5) Search and Navigation Tips

Use top search in header:

- Scoped format: `assay: egfr` or `gel: wb_run_01`
- Also supports: `<scope> <query>` (for example `chemical dmso`)
- View shortcuts: `projects`, `protocols`, `papers`, `members`, etc.

If no scope is provided, Enana scores global records and opens the best-matching module.

## 6) Save, Load, and Back Up Data

Enana persistence layers:

- Browser state: `localStorage` (`enana_state_v1`)
- App JSON save/load: via `Setting > Data File (.json)`
- Auto-save file default: `enana-data.json` under Electron `userData`

Recommended backup routine:

1. Keep auto-save enabled.
2. Periodically click `Save .json` to a dated backup filename.
3. Back up your storage folder path if notebook files are referenced there.

## 7) LLM and Agent Setup

Configure in `Setting > LLM Model & API`.

Environment variable fallbacks:

- `ENANA_LLM_API_KEY` (preferred)
- `LLM_API_KEY`

Default endpoint:

- `https://api.openai.com/v1/responses`

Notes:

- `Papers` AI actions and `Agent` both depend on valid LLM settings.
- Agent responses include confidence, citations, and decision record fields.

## 8) Telegram Bot Setup

Set token in either:

- `Setting > Telegram Bot`, or
- environment variable `TELEGRAM_BOT_TOKEN`

Saved token location:

- `<userData>/telegram-bot.json`

Common Telegram commands:

- `/help`
- `/modules`
- `/open <module>`
- `/search <scope> <query>`
- `/inventory <query>`
- `/samples <query>`
- `/assay <query>`
- `/gel <query>`
- `/status`

## 9) Build, Package, and Test

```bash
npm test
npm run package:app
npm run dist
```

Output is generated under `out/`.

Optional summary PDF utility:

```bash
python3 scripts/generate_enana_summary_pdf.py
```

Generated file:

- `output/pdf/enana-app-summary.pdf`

## 10) Project Structure

- `main.js`: Electron main process, IPC handlers, LLM agent controller, Telegram lifecycle
- `preload.js`: secure bridge (`window.enanaApi`)
- `renderer.js`: app bootstrap, navigation, search routing, cross-module refresh
- `modules/`: feature modules
- `index.html` + `styles.css`: UI shell and styles
- `data/llm-prompts.json`: configurable prompts for papers/agent
- `telegramBot.js`: Telegram command handling

## 11) Troubleshooting

### App launches but data is empty

- Check `Setting > Data File (.json)` and load the correct file.
- Confirm auto-save path did not change unexpectedly.

### Agent or Papers AI says API key missing

- Set API key in `Setting > LLM Model & API`.
- Or export `ENANA_LLM_API_KEY` / `LLM_API_KEY` before launch.

### Telegram bot not running

- Verify token format.
- Check status text in `Setting > Telegram Bot`.
- If saved token is cleared, app falls back to `TELEGRAM_BOT_TOKEN`.

### Notebook file paths not organizing as expected

- Set and save `Storage Folder Path` first.
- Re-open notebook module after changing path.

### Packaging issues

- Re-run `npm install`.
- Ensure Electron Forge dependencies are installed.
