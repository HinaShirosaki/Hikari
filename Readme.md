<div align="center">

<img src="assets/icon.png" alt="Hikari" width="112" height="112" />

# Hikari

### Your whole lab bench in one desktop app, and all of it stays on your machine.

Protocols, notebook, papers, samples, sequences, assays, and an AI assistant in one workspace.<br/>
**No account. No server. No API key.**

<p>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-555?style=flat-square" alt="macOS | Windows | Linux" />
  <img src="https://img.shields.io/badge/local--first-no%20backend-7C3AED?style=flat-square" alt="local-first, no backend" />
  <img src="https://img.shields.io/badge/AI-no%20API%20key-10A37F?style=flat-square" alt="AI with no API key" />
  <img src="https://img.shields.io/badge/version-1.0.3-0EA5E9?style=flat-square" alt="version 1.0.3" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="Apache-2.0 license" /></a>
</p>

<a href="#quick-start"><b>Install</b></a> ·
<a href="docs/getting-started/first-experiment.md"><b>15-min Tutorial</b></a> ·
<a href="docs/guide/README.md"><b>Full Guide</b></a> ·
<a href="docs/README.md"><b>Contributor Docs</b></a>

</div>

<br/>

## Quick Start

**macOS / Linux**

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/@hinashirosaki/hikari/install.sh | bash
```

**Windows (PowerShell)**

```powershell
iwr -useb https://cdn.jsdelivr.net/npm/@hinashirosaki/hikari/install.ps1 | iex
```

You do not need Node.js. The script builds a native app for your OS and CPU and writes it to `./hikari-out/`. If you already have Node.js 20+, `npx @hinashirosaki/hikari` does the same thing.

Then open Hikari, click **Choose Folder**, and follow the **[15-minute first experiment tutorial](docs/getting-started/first-experiment.md)**.

The [installation guide](docs/guide/README.md#install) covers the other options: running from source, installing from GitHub Packages, and letting a coding agent install it for you.

## Highlights

<table>
<tr>
<td width="33%" valign="top">

### 🔒 Your data stays yours

Records, PDFs, gels, plates, and sequences all live in **one folder on your disk**. There is no cloud account and no hosted backend. Back up that folder and you have backed up the lab.

</td>
<td width="33%" valign="top">

### 🧪 One app, whole bench

**Twelve workspaces** in a single dock: protocols, notebook, papers, samples, chemicals, workflows, sequences, assays, and bench calculators.

</td>
<td width="33%" valign="top">

### 🔗 Everything connects

A notebook entry pulls in **the protocol you ran, the samples you used, the assay plate, the gel, and the paper**, all without leaving the page.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🤖 AI that knows your lab

The assistant answers from **your actual notebook, protocols, samples, and papers**. Anything it drafts lands as a review card that you approve before it is saved.

</td>
<td width="33%" valign="top">

### 🔑 No API key to buy

AI runs through the Codex CLI, which is **covered by a ChatGPT subscription**. Sign in once and there is no per-token bill. The AI is optional; everything else works without it.

</td>
<td width="33%" valign="top">

### 📊 Analysis built in

**Cloning and primer design**, plate assays with **curve fitting**, gel **band quantification**, a colony counter, and ten bench calculators.

</td>
</tr>
</table>

## See it in action

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/screenshots/notebook-entry.png" alt="Notebook entry with a yeast growth protocol" /><br/>
<b>Notebook</b>: experiment records that snapshot the protocol you ran
</td>
<td width="50%" valign="top">
<img src="docs/screenshots/sequence-detail.png" alt="Annotated sequence in the Sequence Viewer" /><br/>
<b>Sequence Viewer</b>: annotation, restriction sites, alignment, and cloning design
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="docs/screenshots/assay-layout.png" alt="96-well assay plate layout with a BSA standard" /><br/>
<b>Assay</b>: plate layouts, spreadsheet formulas, and curve fitting
</td>
<td width="50%" valign="top">
<img src="docs/screenshots/gel-analysis.png" alt="Gel analysis with detected lanes and an intensity trace" /><br/>
<b>Gel</b>: lane detection, ladder calibration, and band quantification
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="docs/screenshots/papers-viewer.png" alt="Papers PDF viewer" /><br/>
<b>Papers</b>: a local PDF library with comments, summaries, and method extraction
</td>
<td width="50%" valign="top">
<img src="docs/screenshots/agent-chat.png" alt="Agent chat scoped to a project" /><br/>
<b>Agent</b>: a project-scoped assistant grounded in your records
</td>
</tr>
<tr>
<td colspan="2" valign="top">
<img src="docs/screenshots/home.png" alt="Home dashboard with timers, notes, and reminders" /><br/>
<b>Home</b>: a bench dashboard with timers, quick notes, an activity heatmap, and passage and incubation reminders
</td>
</tr>
</table>

<sub>All screenshots use fictional demonstration data. See the <a href="docs/screenshots/README.md">capture notes</a>.</sub>

**Also in the dock:** Protocols · Samples · Chemicals · Workflows · Tools · Settings, plus sandboxed plugins. **[Tour every workspace →](docs/guide/README.md#app-surface)**

## Learn more

| Where to go | What you will find |
| --- | --- |
| 📖 **[Full guide](docs/guide/README.md)** | Every workspace, AI setup, data and storage, and development |
| 🎓 **[First experiment tutorial](docs/getting-started/first-experiment.md)** | Go from an empty folder to a saved result in 15 minutes |
| 🏗️ **[Architecture](Architecture.md)** | How the app fits together |
| 🧩 **[Plugin system](docs/plugins/plugin-system.md)** | Build your own sandboxed workspace |
| 🛠️ **[Contributor docs](docs/README.md)** | Internal docs for working on the codebase |

## License

[Apache-2.0](LICENSE). Bundled third-party components are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
