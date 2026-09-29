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

Either way this downloads the source from npm, builds the native app for your OS and CPU on your machine, and writes a single `Hikari.app` to `./hikari-out/Hikari-darwin-<arch>/` on macOS. Move it to Applications and open it. Windows produces one `./hikari-out/Hikari-win32-<arch>/HikariSetup.exe`; run it to install Hikari. Set `HIKARI_OUT_DIR` to build somewhere else.

### Let a coding agent install it

Paste this into a coding agent that has terminal access:

```text
Install Hikari (https://github.com/HinaShirosaki/Hikari) for me:

1. Confirm Node.js 20 or newer and npm are available. If missing, explain what is needed and ask before installing system software or requesting administrator privileges.
2. Run `npx @hinashirosaki/hikari` in a user-owned folder. It builds the native app for my OS and CPU and writes `Hikari.app` under `hikari-out/Hikari-darwin-<arch>/` on macOS, or `HikariSetup.exe` under `hikari-out/Hikari-win32-<arch>/` on Windows.
3. Install Hikari from that artifact using the normal convention for my operating system. Ask before overwriting an existing installation or making a system-wide change, and do not bypass operating-system security checks.
4. Launch Hikari once and confirm that it opens. Report the build artifact, installed application path, and any step I still need to complete.

Preserve any existing Hikari application data. Do not choose or change the Hikari storage root, and do not sign in to Codex on my behalf.
```

### Prerequisites

- Node.js 20+
- npm
- macOS or Windows (Linux is not supported)

### Run from source

```bash
git clone https://github.com/HinaShirosaki/Hikari && cd Hikari
npm install
npm run start
```

`npm run dist` builds the same output as `npx @hinashirosaki/hikari`: a single `out/Hikari-darwin-<arch>/Hikari.app` on macOS or one `out/Hikari-win32-<arch>/HikariSetup.exe` on Windows. macOS license notices are retained inside the app bundle.

### Install from GitHub Packages

The same package is also published to [GitHub Packages](https://github.com/HinaShirosaki/Hikari/packages). Unlike npmjs, that registry always needs a GitHub token (`read:packages`), so point the `@hinashirosaki` scope at it once and sign in:

```bash
npm config set @hinashirosaki:registry https://npm.pkg.github.com
npm login --scope=@hinashirosaki --auth-type=legacy --registry=https://npm.pkg.github.com
npx @hinashirosaki/hikari
```

## First launch checklist

1. On the welcome page, click **Choose Folder** to create or open a Hikari workspace. Hikari opens your workspace after checking and saving the folder. You can change the root later in `Settings > Storage`.
2. In `Settings > Startup`, pick a default module or enable "remember last opened module".
3. In `Settings > Samples` and `Settings > Inventory Locations`, set your storage locations and sample type names — the inventory modules read these.
4. Sign in to the Codex CLI if you want `Agent`, paper summaries, or protocol generation (see [AI and Agent Setup](#ai-and-agent-setup)). A ChatGPT subscription is enough — you do not need an LLM API key.

## App Surface

Every workspace below is one dock entry. The dock order is the order shown here; plugin workspaces live behind the **More** button at the end of the dock.

> **Screenshots:** Each workspace below is shown with neutral demonstration data in an isolated browser preview of the app. The example conversation, teaching handout, sequence, assay values, and gel image are synthetic; they are not research results. [Capture notes](../screenshots/README.md).

### Module index

| Module | One-liner |
| --- | --- |
| <img src="../../assets/icons/home.svg" width="16"/> [`Home`](#home) | Bench dashboard: timers, quick notes, contribution heatmap, and recurring reminders. |
| <img src="../../assets/icons/protocols.svg" width="16"/> [`Protocols`](#protocols) | Protocol library with a structured editor, JSON import/export, and LLM drafting. |
| <img src="../../assets/icons/biology-notebook.svg" width="16"/> [`Notebook`](#notebook) | Projects and protocol-linked experiment records with result tables and PDF export. |
| <img src="../../assets/icons/papers.svg" width="16"/> [`Papers`](#papers) | Local PDF library, anchored comments, summaries, and method extraction. |
| <img src="../../assets/icons/sample-inventory.svg" width="16"/> [`Samples`](#samples) | Sample registry inside physical storage containers, with CSV round-trip. |
| <img src="../../assets/icons/chemicals.svg" width="16"/> [`Chemicals`](#chemicals) | Shared reagent inventory with locations, lots, and activity history. |
| <img src="../../assets/icons/workflows.svg" width="16"/> [`Workflows`](#workflows) | Graph workflow builder with reusable templates and project linkage. |
| <img src="../../assets/icons/agent.svg" width="16"/> [`Agent`](#agent) | Evidence-grounded assistant over app state, with review-before-write drafts. |
| <img src="../../assets/icons/sequence-viewer.svg" width="16"/> [`Sequence Viewer`](#sequence-viewer) | Sequence library, annotation, restriction analysis, alignment, and cloning design. |
| <img src="../../assets/icons/assay.svg" width="16"/> [`Assay`](#assay) | Plate design, result capture, spreadsheet formulas, and curve-fitting analysis. |
| <img src="../../assets/icons/tools.svg" width="16"/> [`Tools`](#tools) | Ten bench calculators plus an image-based colony counter. |
| <img src="../../assets/icons/settings.svg" width="16"/> [`Settings`](#settings) | Storage root, startup, appearance, model access, plugins, and shared vocabularies. |

---

### Home

<img src="../../assets/icons/home.svg" width="20" align="left" /> The launch dashboard. It is a widget board rather than a single view, so most of it is a shortcut into another module.

- **Lab timers** — named countdown timers for incubations, spins, and washes.
- **Quick Add Notes** — append a note straight onto a notebook page without opening `Notebook`.
- **Add Experiments** — log an experiment or notebook entry from one input box.
- **Contribution heatmap** — calendar-style activity view across your records.
- **Cell passage** — track cell line, passage number, and split ratio; surfaces the next due passage.
- **Overnight incubation** — record what is incubating and where, against your configured location list.
- **Scheduled paper finding** — recurring literature sweep against your preferred journals (see [`Papers`](#papers)).

![Hikari Home dashboard with teaching-lab reminders](../screenshots/home.png)

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

![Notebook entry with a yeast growth protocol and observations](../screenshots/notebook-entry.png)

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

![Papers PDF viewer showing a fictional yeast growth teaching handout](../screenshots/papers-viewer.png)

### Samples

<img src="../../assets/icons/sample-inventory.svg" width="20" align="left" /> One workspace covering both physical storage containers and the samples inside them — the container view and the registry render together.

- **Storage containers** — define boxes, racks, and freezers, then record samples directly into a position.
- **Sample types** — plasmids, cell lines, strains, antibodies, proteins, compounds, and primers; type names are editable in `Settings > Samples`.
- **Chemical structures** — compound samples carry structure data and a rendered preview.
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
- **Side rail** — the same chat mounts as a rail inside `Papers`, `Notebook`, and `Assay`, scoped to what is open there.

Backend details are in [`docs/agent/README.md`](../agent/README.md).

![Agent workspace with a scripted teaching-lab example conversation](../screenshots/agent-chat.png)

### Sequence Viewer

<img src="../../assets/icons/sequence-viewer.svg" width="20" align="left" /> The largest workspace — read it as several cooperating tools sharing one sequence library.

- **Import** — `.gbk`, `.gb`, `.gbff`, `.fasta`, `.fa`, `.fas`, `.fna`, `.fastq`, `.fq`, `.seq`, `.txt`, or pasted text.
- **Library** — nested folders, rename, move, and a saved/unsaved indicator per record.
- **Detail view** — sequence inspection with feature annotations, hover detail, and inline feature editing.
- **ORF analysis** — open reading frame detection and translation overlays.
- **Restriction analysis** — cut-site detection against a commercial enzyme catalog, with an enzyme picker.
- **Alignment** — align against a pasted sequence or a chosen file.
- **Protein Builder** — assemble a protein from blocks and build the DNA sequence back out.
- **Cloning design** — plan a Gibson/HR assembly or a vector insert, design primers, and export IDT bulk-input blocks or CSV.

![Annotated synthetic classroom reporter sequence](../screenshots/sequence-detail.png)

### Assay

<img src="../../assets/icons/assay.svg" width="20" align="left" /> Plate-based data capture and analysis. The mental model is: define the plate → map the wells → paste results → analyze → save one normalized record.

- **Plate layout** — define the plate, fill concentrations across a row or column, and edit sample IDs per well.
- **Serial dilution** — a dilution dialog that computes the recipe and writes the concentrations into the layout.
- **Inventory picker** — apply a sample ID from `Samples` to a well from its context menu.
- **Result import** — paste a matrix, or import `.csv` / `.xls` / `.xlsx`; plate-sized matrices are detected and offered for mapping.
- **Formulas** — spreadsheet-style formulas per cell for background subtraction and normalization, parsed (never `eval`'d) with function names and arity checked as you type.
- **Analysis** — grouped summaries plus curve fitting (linear, sigmoidal, hyperbola, polynomial, Padé) and normalize-to-baseline dose response.
- **Charts** — Plotly figures with a Format rail, saved style presets, and figure export.
- **Artifacts** — analysis JSON, chart SVG, and attached result files stored under the storage root.
- **Agent rail** — the assistant panel, scoped to the open plate.

![Assay plate mapped with synthetic BSA standard concentrations](../screenshots/assay-layout.png)

### Tools

<img src="../../assets/icons/tools.svg" width="20" align="left" /> Small bench calculators in one workspace. Each is its own subview, switched from the tool rail; the colony counter loads on demand because it is the heavy one.

| Tool | What it computes |
| --- | --- |
| Mass Molarity Calculator | mass ↔ molarity ↔ volume, with concentration and dilution panels in the same view |
| Buffer Preparer | buffer recipes from a shared compound dataset |
| Fixed Volume Reaction | reaction mixes at a fixed final volume |
| qPCR Efficiency Calculator | amplification efficiency from a standard curve |
| CRISPR sgRNA Designer | guide candidates for a target sequence |
| DNA / RNA Oligo Properties | Tm, GC content, and oligo properties |
| DNA Sequence to Protein | translation |
| Protein Sequence to DNA | reverse translation, with a restriction-site avoidance list |
| Peptide Property Calculator | peptide mass and properties |
| Extinction Coefficient Calculator | extinction coefficient from sequence |
| Colony Counter | image-based colony counting with annotated output (loaded on demand) |

![Molarity and dilution calculators with a Tris buffer example](../screenshots/tools-molarity.png)

### Settings

<img src="../../assets/icons/settings.svg" width="20" align="left" /> Configuration, plus the shared vocabularies other modules read from.

| Section | What it controls |
| --- | --- |
| Appearance | Theme and workspace look. |
| Storage | The storage root folder — the one setting to get right first. |
| Startup | Default startup module, or "remember last opened module". |
| Inventory Locations | The shared location vocabulary used by `Chemicals` and `Home`. |
| Samples | Storage locations and the editable sample type names used by `Samples`. |
| Preferred Journals | Journal names or URLs for `Papers` search and scheduled finding. |
| Codex Model & Access | Model choice, reasoning effort, and Codex sign-in status. |
| External Skills | Agent skill files loaded from disk. |
| Genomes | Connect local genome files and refresh the connected list. |
| Plugins | User plugin folders; enable or disable plugin workspaces. |

![Settings appearance controls with the day theme selected](../screenshots/settings-appearance.png)

## Plugins

Plugin workspaces run in a sandboxed iframe with a declared permission list, and appear behind the dock's **More** button. See [`docs/plugins/plugin-system.md`](../plugins/plugin-system.md) for the folder format and install flow.

### Gel (bundled)

[`src/plugins/gel`](../../src/plugins/gel/) ships with the app and cannot be removed, only turned off in `Settings > Plugins`.

- Image and TIFF ingestion, crop, free rotation, and enhancement.
- Lane segmentation, ladder calibration, band quantification, and peak editing.
- Saved gel records, reports, and CSV export.
- PNG export at up to 4× raster density; PowerPoint export keeps the lane table as an editable native table.

It requests only `storage`, `files`, `downloads`, and `layout` — it has no notebook, project, sample, or protocol access. `Notebook` and `Agent` can still *display* saved gel records by reading the plugin's persisted index; that one-way read does not grant the iframe anything.

![Gel workspace with a synthetic teaching gel and detected lanes](../screenshots/gel-analysis.png)

## AI and Agent Setup

Configure AI features in `Settings > Codex Model & Access`.

The Agent workspace uses:

- `Codex Agent (CLI)`

Hikari ships no model list: Settings asks Codex (`codex app-server`, `model/list`) which models the account can use and which is the default. All LLM-backed features use the signed-in `codex` CLI; no API endpoint or API key is stored by the app.

### No LLM API key required

Hikari never calls a model provider directly. Every request goes through the `codex` CLI, and Codex is included with a ChatGPT subscription — so you sign in once with your ChatGPT account and the AI features work with no per-token billing, no API key to buy, and nothing secret to paste into the app. Usage counts against your subscription's Codex allowance instead of a separate API bill.

If you prefer usage-based billing, `codex login --api-key` still works, but it is optional.

### Codex Agent Setup

1. Install the `codex` CLI and make sure it is available on `PATH`.
2. Run `codex login`.
3. In `Settings > Codex Model & Access`, optionally choose a model and reasoning effort.

## Data and Storage

Hikari keeps state in three layers:

| Layer | Where | What lives there |
| --- | --- | --- |
| Renderer state | `localStorage` key `hikari_state_v1` | Fast UI state, loaded on boot |
| Snapshot | `hikari-data.json` in the storage root | The saved record set |
| Storage root | The folder you set in `Settings > Storage` | Every heavy file, in named subfolders |

Inside the storage root you will find `Papers/` and `papers.md/`, `Plates/`, `Gels/`, `Samples/`, `Protocol/`, and `KnowledgeBase/`, alongside the snapshot file and the SQLite search indexes for chemicals and protocols.

Notes:

- The snapshot is a `.json` file; the default filename is `hikari-data.json`.
- Auto-save runs whenever a storage path is set. Without one, nothing is written to disk.

Backup suggestions:

1. Back up the whole storage folder, not just the snapshot file — the snapshot alone does not contain your PDFs, gels, or attachments.
2. Periodically copy a dated snapshot out of the root.

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
| `npm run dist` | Builds the macOS app bundle or the Windows installer. |

Packaging notes:

- macOS builds produce one `Hikari.app` bundle, with license notices inside and no ZIP
- Windows builds produce one self-contained `HikariSetup.exe` using Squirrel; intermediate packages stay in temporary staging. Published GitHub releases include the x64 installer.
- Build artifacts are written under `out/`

### Tests

- `test.js` is the main test entrypoint.
- `tests/suites/core/` covers app modules, contracts, and agent flows.
- `tests/suites/edge/` covers regression-style and edge-case suites.

### Where a module's code lives

Renderer workspaces are folder modules under `src/renderer/modules/<feature>/index.js`, registered through `module-manifests/`. A module captures DOM nodes once, mutates the shared `state`, and calls the shared `persist()` — modules do not own their own persistence.

| Module | Renderer folder | Main-process half |
| --- | --- | --- |
| Home | `modules/home-dashboard/index.js` + `home-dashboard/` | — |
| Protocols | `modules/protocol/` | `src/main/storage/` (protocol index) |
| Notebook | `modules/biology-notebook/` | — |
| Papers | `modules/papers/` | `src/main/papers/` (search, download, parse, retrieve, analysis, finding) |
| Samples | `modules/sample-registry/` + `modules/personal-inventory/` | — |
| Chemicals | `modules/lab-common-inventory/` | `src/main/storage/` (chemicals index) |
| Workflows | `modules/workflow/` | — |
| Agent | `modules/agent-chat/` | `src/main/agent/` |
| Sequence Viewer | `modules/sequence-viewer/` | `modules/sequence-viewer/main-process/` |
| Assay | `modules/assay/` | — |
| Tools | `modules/tool-box/index.js` + `tool-box/` | — |
| Settings | `modules/settings/` | `src/main/core/main-services.js` |
| Gel (plugin) | `src/plugins/gel/` | served plugin runtime |

## Project Layout

- `src/main/app/start-main-app.js`: Electron main process, window lifecycle, IPC wiring, and LLM integration.
- `src/main/core/main-services.js`: constructs main-process services in dependency order and registers IPC.
- `src/main/storage/`: storage-bundle import/export, persistence, and sequence-library summary logic.
- `src/main/data/`: primary snapshot and data-helper utilities.
- `src/main/project-memory/`: project-scoped Codex memory collection and Markdown generation.
- `src/main/scheduled-tasks/`: task persistence, recurrence, and Codex task execution.
- `src/main/genome/`: connected FASTA indexing and genome registry logic.
- `src/main/updater/`: release metadata, version comparison, installer lookup, and update orchestration.
- `src/main/agent/`: Codex integration, MCP contracts, tool adapters, context, and agent runtime support.
- `src/main/papers/`: paper search, download, parsing, retrieval, analysis, and scheduled finding.
- `src/main/ipc/`: IPC registrars; channel names are centralized in `src/shared/ipc/channels.js`.
- `src/main/lib/`: process-level integrations and shared utilities (Codex agent launcher, LLM runtime, app-paths).
- `src/renderer/`: renderer shell, feature modules, shared state, and service layer.
- `src/plugins/`: bundled plugin workspaces.
- `ui/html/` and `ui/css/`: source fragments used to generate the shipped `index.html` and `styles.css`.
- `ui/config/app-registry.json`: source-of-truth dock order, labels, aliases, and search wiring.
- `vendor/` and `src/plugins/gel/vendor/`: unmodified third-party builds. Licences are listed in [`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md), also reachable from **Settings → Startup → Diagnostics → Third-Party Notices**.
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
