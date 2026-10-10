# Hikari Guide

The complete feature, setup, and development reference for Hikari. For the short overview, see the top-level [Readme.md](../../Readme.md). New to Hikari? Start with the **[15-minute first experiment tutorial](../getting-started/first-experiment.md)**.

## Contents

- [Install](#install)
- [First launch checklist](#first-launch-checklist)
- [App Surface](#app-surface) — every workspace, one by one
- [Plugins](#plugins)
- [AI and Agent Setup](#ai-and-agent-setup)
- [Data and Storage](#data-and-storage)
- [Development](#development)
- [Project Layout](#project-layout)
- [Internal Docs](#internal-docs)

## Install

### One-line install

**macOS**

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/@hinashirosaki/hikari/install.sh | bash
```

**Windows (PowerShell)**

```powershell
iwr -useb https://cdn.jsdelivr.net/npm/@hinashirosaki/hikari/install.ps1 | iex
```

No Node.js needed: if Node.js 20+ is not on your PATH, the script downloads a private copy to `~/.hikari/node` (macOS) or `%LOCALAPPDATA%\HikariNode` (Windows) and touches nothing system-wide. With Node.js 20+ already installed you can run the same thing directly:

```bash
npx @hinashirosaki/hikari
```

Either way this downloads the source from npm, builds the native app for your OS and CPU on your machine, and writes a single `Hikari.app` to `./hikari-out/Hikari-darwin-<arch>/` on macOS. Move it to Applications and open it. On Windows, `./hikari-out/Hikari-win32-<arch>/` holds a portable `Hikari\Hikari.exe` (move the `Hikari` folder anywhere and run it, no install needed) and `HikariSetup.exe` (installs to `%LOCALAPPDATA%\hikari` with Desktop and Start menu shortcuts). Set `HIKARI_OUT_DIR` to build somewhere else.

### Let a coding agent install it

Paste this into a coding agent that has terminal access:

```text
Install Hikari (https://github.com/HinaShirosaki/Hikari) for me:

1. Confirm Node.js 20 or newer and npm are available. If missing, explain what is needed and ask before installing system software or requesting administrator privileges.
2. Run `npx @hinashirosaki/hikari` in a user-owned folder. It builds the native app for my OS and CPU and writes `Hikari.app` under `hikari-out/Hikari-darwin-<arch>/` on macOS, or a portable `Hikari\Hikari.exe` folder plus `HikariSetup.exe` under `hikari-out/Hikari-win32-<arch>/` on Windows.
3. Install Hikari from that artifact using the normal convention for my operating system. Ask before overwriting an existing installation or making a system-wide change, and do not bypass operating-system security checks.
4. Launch Hikari once and confirm that it opens. Report the build artifact, installed application path, and any step I still need to complete.

Preserve any existing Hikari application data. Do not choose or change the Hikari storage root, and do not sign in to Codex on my behalf.
```

### Prerequisites

- Node.js 20+ to install and build (the installers fetch Node 24 when none is found)
- Node.js 24 to run the test suite, matching CI: the vendored pdf.js uses `Promise.try`, which Node 22 lacks, and `node test.js` stops partway through on older versions
- npm
- macOS or Windows (Linux is not supported)

### Run from source

```bash
git clone https://github.com/HinaShirosaki/Hikari && cd Hikari
npm install
npm run start
```

`npm run dist` builds the same output as `npx @hinashirosaki/hikari`: a single `out/Hikari-darwin-<arch>/Hikari.app` on macOS, or `out/Hikari-win32-<arch>/HikariSetup.exe` plus the portable `out/Hikari-win32-<arch>/Hikari/` folder on Windows. macOS license notices are retained inside the app bundle.

### Install from GitHub Packages

The same package is also published to [GitHub Packages](https://github.com/HinaShirosaki/Hikari/packages). Unlike npmjs, that registry always needs a GitHub token (`read:packages`), so point the `@hinashirosaki` scope at it once and sign in:

```bash
npm config set @hinashirosaki:registry https://npm.pkg.github.com
npm login --scope=@hinashirosaki --auth-type=legacy --registry=https://npm.pkg.github.com
npx @hinashirosaki/hikari
```

## First launch checklist

1. On the welcome page, click **Choose Folder** to create or open a Hikari workspace. Hikari opens your workspace after checking and saving the folder. You can change the root later in `Settings > Storage & data`.
2. In `Settings > Startup`, pick a default module or enable "remember last opened module".
3. In `Settings > Locations & samples`, set your storage locations and sample type names — the inventory modules read these.
4. Sign in to the Codex CLI if you want `Agent`, paper summaries, or protocol generation (see [AI and Agent Setup](#ai-and-agent-setup)). A ChatGPT subscription is enough — you do not need an LLM API key.

## App Surface

Every workspace below is one dock entry. The dock order is the order shown here; plugin workspaces follow it and move behind the **More** button at the end of the dock when space runs out. Two dock labels are shorter than the workspace names used in these docs: **Plate** is the Assay workspace and **DNA** is the Sequence Viewer.

> **Screenshots:** Each workspace below is shown with neutral demonstration data in an isolated browser preview of the app. The example conversation, teaching handout, sequence, assay values, and gel image are synthetic; they are not research results. [Capture notes](../screenshots/README.md).

### Module index

| Module | One-liner |
| --- | --- |
| <img src="../../assets/icons/home.svg" width="16"/> [`Home`](#home) | Bench dashboard: timers, experiment log, notebook notes, activity heatmap, reminders, and paper finder. |
| <img src="../../assets/icons/protocols.svg" width="16"/> [`Protocols`](#protocols) | Protocol library with a structured editor, JSON import/export, and LLM drafting. |
| <img src="../../assets/icons/biology-notebook.svg" width="16"/> [`Notebook`](#notebook) | Projects and protocol-linked experiment records with result tables and PDF export. |
| <img src="../../assets/icons/papers.svg" width="16"/> [`Papers`](#papers) | Local PDF library, anchored comments, summaries, and method extraction. |
| <img src="../../assets/icons/sample-inventory.svg" width="16"/> [`Samples`](#samples) | Sample registry inside physical storage containers, with CSV round-trip. |
| <img src="../../assets/icons/chemicals.svg" width="16"/> [`Chemicals`](#chemicals) | Shared reagent inventory with locations, lots, and activity history. |
| <img src="../../assets/icons/workflows.svg" width="16"/> [`Workflows`](#workflows) | Graph workflow builder with reusable templates and project linkage. |
| <img src="../../assets/icons/agent.svg" width="16"/> [`Agent`](#agent) | Evidence-grounded assistant over app state, with review-before-write drafts. |
| <img src="../../assets/icons/sequence-viewer.svg" width="16"/> [`DNA`](#sequence-viewer) (Sequence Viewer) | Sequence library, annotation, restriction analysis, alignment, and cloning design. |
| <img src="../../assets/icons/assay.svg" width="16"/> [`Plate`](#assay) (Assay) | Plate design, result capture, spreadsheet formulas, and curve-fitting analysis. |
| <img src="../../assets/icons/tools.svg" width="16"/> [`Tools`](#tools) | Eight bench calculators plus an image-based colony counter. |
| <img src="../../assets/icons/settings.svg" width="16"/> [`Settings`](#settings) | Storage root, startup, appearance, Codex access, agent tool access, skills and plugins, and shared vocabularies. |

---

### Home

<img src="../../assets/icons/home.svg" width="20" align="left" /> The launch dashboard. It is a widget board rather than a single view, so most of it is a shortcut into another module.

- **Lab timers** — named countdown timers for incubations, spins, and washes.
- **Experiment log** — type what you did in one box, then either save it as a dated log line (kept in `Dashboard/experiment-log.json` under the storage root) or hand it to the assistant, which opens a **Prepare notebook page** dialog and drafts a notebook page for you to review before anything is saved.
- **Notebook notes** — the six most recently updated notebook pages; append a result note to one of them (optionally clarified by the LLM) without opening `Notebook`.
- **Lab activity** — an 18-week contribution heatmap built from notebook entries, workflow steps, assay analyses, and experiment-log lines.
- **Cell passage** — reminders for upcoming and overdue sub-cultures.
- **Overnight incubation** — named incubators (managed from the widget itself) with an optional reminder date for tomorrow.
- **Paper finder** — results of the scheduled literature sweeps you set up from a Notebook project, against your preferred journals, with a **Find papers now** button and one-click download into the library (see [`Papers`](#papers)).

![Hikari Home dashboard with timers and passage and incubation reminders](../screenshots/home.png)

### Protocols

<img src="../../assets/icons/protocols.svg" width="20" align="left" /> A structured protocol library. Protocols are records, not free text, so `Notebook` can snapshot them into an experiment and keep the version that was actually run.

- **Structured editor** — name, purpose, materials, numbered steps, and troubleshooting notes as separate fields.
- **Interactive bars** — parameterize a step (volume, temperature, time) so the value can be set per run instead of edited into the text.
- **Import / export** — read and write protocol JSON; share a protocol as a file.
- **Generate Protocol** — draft a protocol from a description, pasted methods, notes, images, or a PDF.
- **Polish Protocol** — clean up an existing draft while showing your original input side by side.
- **Notebook placeholders** — leave fields for the experimenter to fill in when the protocol is used in a record.

![Protocols editor with a fictional yeast growth protocol](../screenshots/protocols-editor.png)

### Notebook

<img src="../../assets/icons/biology-notebook.svg" width="20" align="left" /> The wet-lab record, and the home of projects. Everything else in the app can be linked into an entry.

- **Projects** — create projects, pick an active project, and see a per-project dashboard. There is no separate Projects module; project selection lives here and scopes `Papers` and `Agent`.
- **Experiment entries** — start an experiment from a protocol, which snapshots the protocol text and fills in its placeholders.
- **Result tables** — add tables with configurable rows/columns and spreadsheet-style formulas (the same formula engine `Assay` uses).
- **Linked previews** — embed assay plates and gel records inline; the preview reads the owning module's saved record.
- **Samples and reagents** — quick-add a sample or attach a reagent from `Samples`/`Chemicals` without leaving the entry.
- **Notebook calculators** — a buffer and fixed-volume-reaction sidebar that writes its result straight into the record.
- **Attachments and storage** — imported result files and an append-only page log under the storage root.
- **PDF export** — export an entry, with its tables and previews, as a PDF.
- **Agent rail** — a project-scoped assistant panel docked beside the entry.

![Notebook page with an SDS-PAGE protocol and a result table](../screenshots/notebook-entry.png)

![Project dashboard for a fictional yeast growth practical](../screenshots/notebook-project-dashboard.png)

### Papers

<img src="../../assets/icons/papers.svg" width="20" align="left" /> A local PDF library with a real viewer, not a file list. Search, download, parsing, and analysis run in the main process under [`src/main/papers/`](../../src/main/papers/).

- **Library rail** — nested folders, drag-and-drop filing, rename/delete, and project linkage.
- **Upload or fetch** — add a local PDF, or search the paper database and download the PDF into the library.
- **PDF viewer** — page rendering, zoom, in-document search, and text selection.
- **Anchored comments** — pin a comment to a location on the page; edit it from the sidebar.
- **Summaries and methods** — generate a summary or extract the methods section into structured text.
- **Project-scoped Q&A** — ask questions across the papers linked to the current project.
- **Scheduled finding** — recurring searches against the journals configured in `Settings > Preferred Journals`, surfaced on `Home`.
- **Agent rail** — the assistant panel, scoped to the open paper and project.

![Papers PDF viewer showing a fictional thermal shift teaching handout](../screenshots/papers-viewer.png)

### Samples

<img src="../../assets/icons/sample-inventory.svg" width="20" align="left" /> One workspace covering both physical storage containers and the samples inside them — the container view and the registry render together.

- **Storage containers** — define boxes, racks, and freezers, then record samples directly into a position.
- **Sample types** — plasmid, cell line, strain, antibody, protein, chemical, primer, and other. Rename them or add your own types in `Settings > Locations & samples`.
- **Chemical structures** — chemical samples carry structure data and a rendered preview.
- **CSV import / export** — bulk-load a registry or export it for a shared sheet.
- **Cell passage tracking** — passage records that feed the `Home` reminder widget.
- **Notebook capture** — push a sample into the open notebook entry, or create one from an entry.

![Samples container with a fictional GFP fluorescence standard](../screenshots/samples-registry.png)

### Chemicals

<img src="../../assets/icons/chemicals.svg" width="20" align="left" /> The shared reagent inventory, kept separate from personal samples because it is the lab-wide stock list.

- **Searchable records** — search by name or catalog identity from the topbar.
- **Locations and lots** — where the bottle lives and which lot is open.
- **Activity history** — a record of stock changes over time.
- **Fast lookup** — indexed on disk (`hikari-chemicals.index.sqlite`) so search stays quick on large inventories.

![Chemical inventory with common teaching-lab reagents](../screenshots/chemicals-list.png)

### Workflows

<img src="../../assets/icons/workflows.svg" width="20" align="left" /> Plans a multi-day experiment as a graph rather than a checklist, so branches and parallel tracks are visible.

- **Graph editor** — drag nodes, connect steps, and lay out branches directly.
- **Templates** — save a workflow as a reusable template and instantiate it for a new run; templates are searchable.
- **Protocol blocks** — pull protocol steps into a node instead of retyping them.
- **Assignees and next steps** — default-assignee resolution and next-step planning.
- **Project linkage** — attach a workflow to a project; progress shows on `Home`.

![Branching workflow for a fictional yeast growth practical](../screenshots/workflows-graph.png)

### Agent

<img src="../../assets/icons/agent.svg" width="20" align="left" /> The assistant workspace. It answers from your actual records, and anything it wants to write goes through a review card first.

- **Sessions** — multiple named sessions, organized in folders, with history.
- **Project context** — pick the project scope; the assistant reads a compact snapshot of that project's state.
- **Grounded tools** — it can look up notebook entries, protocols, samples, chemicals, containers, and papers; run literature search and paper download/analysis; read assay tables; build Plotly graphs; and suggest purchases.
- **Review before write** — generated notebook drafts and protocols land as review cards you approve or reject; the owning module, not the assistant, defines the record schema.
- **Side rail** — the same chat mounts as a rail inside `Notebook`, `Plate`, and `Papers`, scoped to what is open there. `Home` also opens it as the **Prepare notebook page** dialog.

Backend details are in [`docs/agent/README.md`](../agent/README.md).

![Agent chat rail with a scripted example conversation beside a notebook page](../screenshots/agent-chat.png)

### Sequence Viewer

<img src="../../assets/icons/sequence-viewer.svg" width="20" align="left" /> Labelled **DNA** in the dock. The largest workspace — read it as several cooperating tools sharing one sequence library.

- **Import** — `.gbk`, `.gb`, `.gbff`, `.fasta`, `.fa`, `.fas`, `.fna`, `.fastq`, `.fq`, `.seq`, `.txt`, or pasted text.
- **Library** — nested folders, rename, move, and a saved/unsaved indicator per record.
- **Detail view** — sequence inspection with feature annotations, hover detail, and inline feature editing.
- **ORF analysis** — open reading frame detection and translation overlays.
- **Restriction analysis** — cut-site detection against a commercial enzyme catalog, with an enzyme picker.
- **Alignment** — align against a pasted sequence or a chosen file.
- **Protein Builder** — assemble a protein from blocks and build the DNA sequence back out.
- **Cloning design** — plan a Gibson/HR assembly or a vector insert, design primers, and export IDT bulk-input blocks or CSV.

![Annotated plasmid sequence in the Sequence Viewer](../screenshots/sequence-detail.png)

### Assay

<img src="../../assets/icons/assay.svg" width="20" align="left" /> Labelled **Plate** in the dock. Plate-based data capture and analysis. The mental model is: define the plate → map the wells → paste results → analyze → save one normalized record.

- **Plate layout** — define the plate, fill concentrations across a row or column, and edit sample IDs per well.
- **Serial dilution** — a dilution dialog that computes the recipe and writes the concentrations into the layout.
- **Inventory picker** — apply a sample ID from `Samples` to a well from its context menu.
- **Result import** — paste a matrix, or import `.csv` / `.xls` / `.xlsx`; plate-sized matrices are detected and offered for mapping.
- **Formulas** — spreadsheet-style formulas per cell for background subtraction and normalization, parsed (never `eval`'d) with function names and arity checked as you type.
- **Analysis** — grouped summaries plus curve fitting (linear, sigmoidal, hyperbola, polynomial, Padé) and normalize-to-baseline dose response.
- **Charts** — Plotly figures with a Format rail, saved style presets, and figure export.
- **Artifacts** — analysis JSON, chart SVG, and attached result files stored under the storage root.
- **Agent rail** — the assistant panel, scoped to the open plate.

![Assay plate mapped with a synthetic inhibitor dilution series](../screenshots/assay-layout.png)

### Tools

<img src="../../assets/icons/tools.svg" width="20" align="left" /> Small bench calculators in one workspace. Each is its own subview, switched from the tool rail; the colony counter loads on demand because it is the heavy one.

| Tool (rail label) | What it computes |
| --- | --- |
| Molarity Calculator | mass ↔ molarity ↔ volume, with concentration and dilution panels in the same view |
| Peptide Properties | peptide mass and properties |
| Buffer Preparer | buffer recipes from a shared compound dataset |
| Fixed Volume Reaction | reaction mixes at a fixed final volume |
| DNA to Protein | translation |
| Protein to DNA | reverse translation, with a restriction-site avoidance list |
| DNA/RNA Oligo Properties | Tm, GC content, and oligo properties |
| Extinction Coefficient | extinction coefficient from sequence |
| Colony Counter | image-based colony counting with annotated output (loaded on demand) |

![Molarity and dilution calculators with a Tris buffer example](../screenshots/tools-molarity.png)

### Settings

<img src="../../assets/icons/settings.svg" width="20" align="left" /> Configuration, plus the shared vocabularies other modules read from.

The Settings rail has three groups.

| Group | Section | What it controls |
| --- | --- | --- |
| Workspace | Appearance | Day/night theme and workspace look. |
| | Startup | Default startup module, or "remember last opened module". |
| | Storage & data | The storage root folder — the one setting to get right first — plus **Diagnostics & app information** (logs folder, third-party notices). |
| Lab preferences | Locations & samples | The inventory location vocabulary used by `Chemicals`, the sample storage locations, and the sample type names used by `Samples` (rename or add types). |
| | Papers | Preferred journal names or URLs for `Papers` search and the scheduled paper finder. |
| | Notebook PDF | Layout options for notebook PDF export. |
| Agent & extensions | Codex | Codex CLI install/sign-in status, model choice, and reasoning effort. |
| | Tool access | Turn individual Hikari MCP tools on or off for the agent. |
| | External skills | External agent skill folders (refresh, enable/disable). |
| | Plugins | User plugin folders (add, enable/disable, remove). |

![Settings appearance controls with the day theme selected](../screenshots/settings-appearance.png)

## Plugins

Plugin workspaces run in a sandboxed iframe with a declared permission list, and appear after the built-in apps in the dock, behind its **More** button when the dock runs out of room. See [`docs/plugins/plugin-system.md`](../plugins/plugin-system.md) for the folder format and install flow.

### Gel (bundled)

[`src/plugins/gel`](../../src/plugins/gel/) ships with the app and cannot be removed, only turned off in `Settings > Plugins`.

- Image and TIFF ingestion, crop, free rotation, and enhancement.
- Lane segmentation, ladder calibration, band quantification, and peak editing.
- Saved gel records, reports, and CSV export.
- PNG export at up to 4× raster density; PowerPoint export keeps the lane table as an editable native table.

It requests only `storage`, `files`, `downloads`, and `layout` — it has no notebook, project, sample, or protocol access. `Notebook` and `Agent` can still *display* saved gel records by reading the plugin's persisted index; that one-way read does not grant the iframe anything.

![Gel workspace with a synthetic SDS-PAGE gel and detected lanes](../screenshots/gel-analysis.png)

## AI and Agent Setup

Configure AI features in `Settings > Codex`.

The Agent workspace uses:

- `Codex Agent (CLI)`

Hikari ships no model list: Settings asks Codex (`codex app-server`, `model/list`) which models the account can use and which is the default. All LLM-backed features use the signed-in `codex` CLI; no API endpoint or API key is stored by the app.

### No LLM API key required

Hikari never calls a model provider directly. Every request goes through the `codex` CLI, and Codex is included with a ChatGPT subscription — so you sign in once with your ChatGPT account and the AI features work with no per-token billing, no API key to buy, and nothing secret to paste into the app. Usage counts against your subscription's Codex allowance instead of a separate API bill.

If you prefer usage-based billing, `codex login --api-key` still works, but it is optional.

### Codex Agent Setup

1. Install the `codex` CLI. If Hikari cannot find it, `Settings > Codex` shows an **Install Codex CLI** card with a **Copy install command** button and a **Check again** button.
2. Sign in with **Sign in with OpenAI** in `Settings > Codex`, or run `codex login` in a terminal.
3. In `Settings > Codex`, optionally choose a model and reasoning effort.
4. In `Settings > Tool access`, optionally turn off Hikari tools you do not want the agent to call.

Hikari uses your normal Codex sign-in (`~/.codex`, or `$CODEX_HOME`), but runs Codex with a private copy of that home under the app-data folder (`Config/codex-cli-home/`, see [Data and Storage](#data-and-storage)). Hikari's MCP server and skills are configured there, so your own Codex settings are not changed.

### Use Hikari from Codex Desktop

`Settings > Codex > Connect Codex Desktop` lets a separately installed Codex Desktop app call Hikari's tools against your open workspace.

1. Click **Copy setup instructions**. Hikari writes a live MCP configuration block (a loopback address and a private token) and copies a prompt that points at it.
2. Paste the prompt into a Codex Desktop task and send it. Codex merges the marked `hikari` block into its user `config.toml`, keeping your other settings.
3. Restart Codex Desktop once. `/mcp` should then list `hikari` as connected.

Keep Hikari open while you use the connection: the configuration points at the running app process. The same **Tool access** switches apply.

## Data and Storage

Hikari keeps state in three layers:

| Layer | Where | What lives there |
| --- | --- | --- |
| Renderer state | `localStorage` key `hikari_state_v1` | Fast UI state, loaded on boot |
| Snapshot | `hikari-data.json` in the storage root | Settings and the small collections; the large collections are cleared from it on save and rebuilt from the module folders on load |
| Storage root | The folder you set in `Settings > Storage & data` | Every record and file, in folders owned by the module that writes them |

Most records are plain JSON files, one per record, so the folder is readable without Hikari:

| Path in the storage root | What it holds |
| --- | --- |
| `hikari-data.json` | The compact snapshot |
| `Protocol/<name>__<id>/protocol.md` | Readable protocol; companion JSON retains interactive state and recovery text |
| `Project/<project>/Notebook/<page>__<id>/page.md` | Readable notebook pages, grouped by project, with structured JSON companions |
| `Project/<project>/MEMORY.md`, `.agents/skills/`, `DNA/` | The agent's per-project memory and skills, and the project's sequence folder |
| `Samples/<zone>/<container>__<id>.json`, `folders.json`, `unplaced.json` | Samples, one file per storage container |
| `Plates/<name>__<id>/assay.json` | Plate assays, next to their analysis JSON, chart SVGs, and result files |
| `Gels/<name>__<id>/gel.json` | Gel records from builds before Gel became a plugin (kept so the Gel plugin can import them) |
| `Workflow/<template>__<id>/template.json`, `…/<run>__<id>/workflow.json` | Workflow templates and runs |
| `Papers/` (and `Project/<project>/Papers/`) | Stored PDFs; each has a `<file>.pdf.json` record beside it with comments, highlights, and summaries |
| `KnowledgeBase/papers.md/`, `knowledge.index.sqlite`, `experiments.sqlite` | Parsed paper Markdown and figures, the paper identity index, and extracted experiments |
| `DNA/sequence-library.sqlite` | The sequence library |
| `hikari-chemicals.index.sqlite` | The chemical inventory (the only copy; SQLite is kept here for fast search) |
| `Dashboard/experiment-log.json` | The Home experiment log |
| `Plugins/<plugin-id>/` | Files that plugins save. The Gel plugin keeps its images and exports under `Plugins/gel/`; each plugin's small record store rides in the snapshot's `settings.pluginStorage` |
| `Config/scheduled-tasks.json`, `Config/genome-library.json` | Scheduled paper-finder tasks and connected genome files |
| `.hikari/agent-memory.json`, `Project/<project>/.hikari/` | Agent memory, and each project's cached notebook summaries |

App-owned files that are not part of your lab record live in the OS app-data folder (`~/Library/Application Support/Hikari` on macOS, `%APPDATA%\Hikari` on Windows): `Config/last-storage-root.json` (so Hikari can find your workspace again), `Config/codex-cli-home/` (the private Codex runtime home), `Logs/` (`errors.log`, `agent-chat.log`), and `Tmp/`. `Settings > Storage & data > Diagnostics & app information > Open Logs Folder` opens the logs.

Notes:

- The snapshot is a `.json` file; the default filename is `hikari-data.json`.
- Auto-save runs whenever a storage path is set. Without one, nothing is written to disk.
- If the chemicals index cannot be read, Hikari moves it aside as `hikari-chemicals.index.sqlite.corrupt-<time>`, starts a new one, and shows an error notice. It never overwrites an unreadable index.

Backup suggestions:

1. Back up the whole storage folder, not just the snapshot file — the snapshot alone does not contain your protocols, notebook pages, PDFs, gels, or attachments.
2. Quit Hikari before copying the folder so the SQLite files are not mid-write.

## Development

Generated files are part of the normal workflow and are not committed. Do not hand-edit `index.html`, `styles.css`, `src/renderer/modules/views.js`, or the `*.generated.js` modules; edit their sources under `ui/` (or `scripts/build-ui/llm-catalog.mjs` for the Codex provider modules) and rerun `npm run build:ui`.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run build:ui` | Generates `index.html`, `styles.css`, `views.js`, the app registry, and the Codex provider modules from `ui/`. |
| `npm run start` | Builds the UI, then starts Electron in development mode. |
| `npm test` | Builds the UI, then runs `node test.js`: lint, the static checks, every `tests/*-selfcheck.*` script, and the core and edge suites. This is the whole CI gate. |
| `npm run test:checks` | Lint, static checks, and selfchecks only (no suites). |
| `npm run test:core` / `npm run test:edge` | One suite branch. `node test.js <regex>` runs any subset; `npm run test:groups` lists the groups. |
| `npm run lint` | ESLint over `src`, `scripts`, `tests`, and `test.js`. |
| `npm run check:dom-ids` | Verifies `document.getElementById(...)` calls against the generated `index.html`. |
| `npm run check:css-colors` | Keeps raw color literals inside `*palette.css` files and rejects unused custom properties. |
| `npm run check:source-layout` | Enforces the import boundaries: no unresolved imports, no main ↔ renderer crossings, no cross-feature cycles, and public-API-only access to Agent Chat and Tools. |
| `npm run report:modules` | Writes the renderer module relationship report to `reports/renderer-module-relationships.md`. |
| `npm run package:app` | Creates packaged app artifacts with Electron Forge. |
| `npm run dist` | Builds the macOS app bundle or the Windows installer. |

Packaging notes:

- macOS builds produce one `Hikari.app` bundle, with license notices inside and no ZIP
- Windows builds produce a self-contained `HikariSetup.exe` (Squirrel) and the portable app folder `Hikari/` (run `Hikari.exe` from anywhere); intermediate packages stay in temporary staging. Published GitHub releases include the x64 installer.
- Build artifacts are written under `out/`

### Tests

- `test.js` is the main test entrypoint. Every test reports one `PASS`/`FAIL [group] name` line.
- `tests/suites/core/` covers app modules, contracts, agent flows, the Codex CLI provider, the plugin system, and the updater.
- `tests/suites/edge/` covers regression-style and edge-case suites.
- `tests/*-selfcheck.*` are standalone scripts that `test.js` runs in their own process; `tests/*-electron.cjs` drive a real Electron window and run separately.

See [`tests/README.md`](../../tests/README.md) for the full layout.

### Continuous integration and releases

- **CI** (`.github/workflows/ci.yml`) runs on every push, on macOS: `npm ci`, `npm test`, then the embedded-Electron MCP startup check and the workspace onboarding test (`tests/storage-setup-electron.cjs`).
- **Publish** (`.github/workflows/publish.yml`) runs when a GitHub release (`vX.Y.Z`, matching `package.json`) is published. It re-runs CI, builds and attaches the Windows x64 `HikariSetup.exe`, and publishes the package to npmjs (trusted publishing) and GitHub Packages.
- **Windows install smoke** (`.github/workflows/windows-install-smoke.yml`) packs the branch, runs it through `npx`, installs `HikariSetup.exe`, and drives the installed app (`tests/installed-app-smoke.mjs`). Push to a `win-smoke/**` branch to run it before merging.
- **In-app updates.** At startup Hikari checks the npm registry for a newer `@hinashirosaki/hikari`. If you choose **Update** (or use **Settings > Updates**), it runs the same `npx` build in the background, then installs it where the running app is and restarts: a macOS `Hikari.app` or a portable Windows `Hikari` folder is replaced in place, on any folder or drive; a `HikariSetup.exe` install runs the new setup. There are no hosted binaries and builds are ad-hoc signed, so Electron's Squirrel auto-updater is not used (`src/main/updater/`).

### Where a module's code lives

Renderer workspaces are folder modules under `src/renderer/modules/<feature>/index.js`, registered through `module-manifests/`. A module captures DOM nodes once, mutates the shared `state`, and calls the shared `persist()` — modules do not own their own persistence.

| Module | Renderer folder | Main-process half |
| --- | --- | --- |
| Home | `modules/home-dashboard/` | `src/main/scheduled-tasks/` (paper finder), `src/main/storage/experiment-log-storage.js` |
| Protocols | `modules/protocol/` | `src/main/storage/` (`Protocol/` folders) |
| Notebook | `modules/biology-notebook/` | — |
| Papers | `modules/papers/` | `src/main/papers/` (search, download, parse, retrieve, analysis, finding) |
| Samples | `modules/personal-inventory/` | `src/main/storage/sample-containers.js` |
| Chemicals | `modules/lab-common-inventory/` | `src/main/storage/` (chemicals index) |
| Workflows | `modules/workflow/` | `src/main/storage/workflow/` |
| Agent | `modules/agent-chat/` | `src/main/agent/` |
| Sequence Viewer | `modules/sequence-viewer/` | `modules/sequence-viewer/main-process/` |
| Assay | `modules/assay/` | `src/main/storage/` (`Plates/` folders) |
| Tools | `modules/tool-box/` | — |
| Settings | `modules/settings/` | `src/main/ipc/register-system-ipc.js`, `src/main/lib/codex-cli-provider/` |
| Gel (plugin) | `src/plugins/gel/` | `src/main/ipc/register-plugin-ipc.js` (served on its own loopback origin) |

## Project Layout

- `src/main/main.js` → `src/main/app/start-main-app.js`: Electron app lifecycle (Squirrel install hooks, crash reporting, window creation, and the unsaved-changes close handshake).
- `src/main/core/main-services.js`: constructs main-process services in dependency order and registers IPC.
- `src/main/windows/`: the main `BrowserWindow`.
- `src/main/preload/`: the `window.hikariApi` bridge, one file per domain under `api/`.
- `src/main/storage/`: storage-root layout, per-module record folders, the chemicals SQLite index, hydration, and import.
- `src/main/data/`: the compact snapshot and the save/load facade.
- `src/main/project-memory/`: project-scoped Codex memory collection and Markdown generation.
- `src/main/scheduled-tasks/`: task persistence, recurrence, and Codex task execution.
- `src/main/genome/`: connected FASTA indexing and genome registry logic.
- `src/main/updater/`: release metadata, version comparison, installer lookup, and update orchestration.
- `src/main/agent/`: Codex integration, MCP contracts, tool adapters, context, and agent runtime support.
- `src/main/papers/`: paper search, download, parsing, retrieval, analysis, and scheduled finding.
- `src/main/ipc/`: IPC registrars; channel names are centralized in `src/shared/ipc/channels.js`.
- `src/main/bioinformatics/`: NCBI BLAST and UniProt clients.
- `src/main/lib/`: process-level integrations and shared utilities (Codex CLI provider, LLM runtime, app paths, plugin server and file access, path safety, SQLite helpers).
- `src/shared/ipc/channels.js`: every IPC channel name, shared by main and preload.
- `src/renderer/`: renderer shell, feature modules, shared state, and service layer.
- `src/plugins/`: bundled plugin workspaces.
- `ui/html/` and `ui/css/`: source fragments used to generate the shipped `index.html` and `styles.css`.
- `ui/config/`: `app-registry.json` (dock order, labels, aliases, and search wiring) plus the HTML and CSS order files.
- `vendor/` and the `cropperjs`, `pptxgenjs`, `tabulator`, and `utif` folders under `src/plugins/gel/vendor/`: unmodified third-party builds. Licences are listed in [`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md), also reachable from **Settings → Storage & data → Diagnostics & app information → Third-Party Notices**.
- `examples/plugins/`: small example plugins (`hello-world`, `notebook-results`).
- `scripts/`: the UI build, static checks, the module report, and `dev/` and `maintenance/` utilities.
- `bin/`: `hikari.js` (the `npx` entry that builds the app) and `dist.js` (packaging).
- `docs/`: internal walkthroughs for renderer, main helpers, plugins, and the agent backend.

## Internal Docs

If you are onboarding to the codebase, start with the docs index and then the area you need:

- [`docs/README.md`](../README.md) — internal docs index and architecture overview
- [`Architecture.md`](../../Architecture.md) — topology of the whole app down to the module/service layer
- [`docs/renderer/README.md`](../renderer/README.md)
- [`docs/main-platform/README.md`](../main-platform/README.md)
- [`docs/agent/README.md`](../agent/README.md)
- [`docs/plugins/plugin-system.md`](../plugins/plugin-system.md) — plugin format, install flow, and sandboxing
- [`docs/module-development/README.md`](../module-development/README.md) — how to add a new module
- [`tests/README.md`](../../tests/README.md)
