# Enana

Enana is an Electron desktop app for lab workflow management. It combines lab records, notebooks, inventory, assay/gel workflows, papers, and an agent chat interface in one local app.

## What It Includes

- Member and role tracking
- Instrument scheduling and reservations
- Protocol management and sharing links
- Synthesis and biology notebooks
- Chemical + personal inventory management
- Sample registry
- Assay and gel analysis workflows
- JS-based plasmid annotation tool (pLannotate port subset)
- Project and workflow management
- Papers management with LLM-assisted extraction
- Agent chat with optional project-scoped context
- Optional Telegram bot controls

## Tech Stack

- Electron (main process + renderer)
- Vanilla JavaScript modules under `modules/`
- Local state persistence (`localStorage`) plus JSON/`.ena` save/load
- Electron Forge for packaging

## Project Structure

- `main.js`: Electron main process, IPC handlers, file operations, agent calls, Telegram lifecycle
- `preload.js`: secure renderer API bridge
- `renderer.js`: boots modules and coordinates cross-module updates
- `modules/`: domain modules (assay, inventory, notebooks, projects, etc.)
- `index.html` + `styles.css`: UI shell and styling
- `telegramBot.js`: Telegram command handling
- `data/llm-prompts.json`: prompt templates for LLM-backed features

## Getting Started (Development)

### Prerequisites

- Node.js 20+ (recommended)
- npm

### Install and Run

```bash
npm install
npm run start
```

### Run Tests

```bash
npm test
```

## Build and Package

```bash
npm run package:app   # package app folder only
npm run dist          # create platform installers/artifacts
```

Build output is generated under `out/`.

## Data and Persistence

- App state is persisted locally and auto-saved by default.
- You can manually save/load data using JSON or `.ena` files from Settings.
- Default auto-save file name is `enana-data.json` in Electron `userData`.

## Optional Integrations

### LLM Features

Configure in **Settings -> LLM Model & API** or environment variables:

- `ENANA_LLM_API_KEY` (preferred)
- `LLM_API_KEY`

Default endpoint:

- `https://api.openai.com/v1/responses`

### Telegram Bot

Configure in **Settings -> Telegram Bot** or environment variable:

- `TELEGRAM_BOT_TOKEN`

If a token is saved in-app, it is stored in Electron `userData` as `telegram-bot.json`.

## Utility Script

Generate a one-page app summary PDF:

```bash
python3 scripts/generate_enana_summary_pdf.py
```

Output:

- `output/pdf/enana-app-summary.pdf`

## Notes

- Packaging uses `asar` and dependency pruning.
- Build/output directories (`out/`, `output/`, `tmp/`) are excluded from packaged artifacts.
