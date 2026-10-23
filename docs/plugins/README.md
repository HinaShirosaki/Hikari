# Plugins

Sandboxed extensions. A plugin is a folder of web files that Hikari boots as a
first-class app with its own navigation entry and workspace view, plus narrow,
permission-gated host capabilities. Plugins can be user-installed or bundled
with Hikari.

**Start here:** follow [quickstart.md](quickstart.md). Copy `hello-world` for a
minimal page, or `notebook-results` when you need the host API. Both use classic
scripts and need no build step or development server; Hikari serves the folder
itself.

## Build a plugin

Read in this order; each page links forward to the next.

| Document | Read it for |
| --- | --- |
| [quickstart.md](quickstart.md) | Build, install, and harden a small plugin with a copyable host client. |
| [plugin-system.md](plugin-system.md) §1–3, §6–7 | The folder contract Hikari enforces: plugin kinds, `plugin.json`, permissions, installing, what is stored, limitations, and troubleshooting. |
| [plugin-api.md](plugin-api.md) | Host API reference: every verb and host event, its permission, and its request/response shape — data access, tool plugins in **Tools**, the right toolbar and context actions, and the agent chat and canvas. |
| [plugin-settings.md](plugin-settings.md) | Declare preferences in `plugin.json`, display them in Settings → Plugins, and read, patch, and subscribe to their values. |
| [service-plugins.md](service-plugins.md) | Headless capability providers, e.g. teaching the sequence viewer to open `.dna`. |
| [imagej-walkthrough.md](imagej-walkthrough.md) | Case study: a runtime-heavy plugin (ImageJ in WebAssembly), why it needs a real origin, and what "runs locally" does and does not cover. |

## Share a plugin

| Document | Read it for |
| --- | --- |
| [github-installation.md](github-installation.md) | Publish a repository users install by pasting its GitHub URL: layout, build output, supported URLs, and troubleshooting. |

## Work on Hikari's plugin host

| Document | Read it for |
| --- | --- |
| [plugin-system.md](plugin-system.md) §4–5, §8–9 | Boot sequence, install IPC, loopback serving, security model, when to graduate a plugin into a built-in module, and the test suites. |
| [plugin-api.md §8](plugin-api.md#8-adding-a-verb) | Adding a host verb. |
| [`src/plugins/README.md`](../../src/plugins/README.md) | Source-owned internal plugins (such as Gel) that still use the sandbox and public plugin API. |

## Examples

| Example | Kind | Shows |
| --- | --- | --- |
| [`hello-world`](../../examples/plugins/hello-world/) | local | The minimum that installs: manifest, entry page, no host access. |
| [`notebook-results`](../../examples/plugins/notebook-results/) | local | Reading and writing notebook data through the host API. |
| [`settings-demo`](../../examples/plugins/settings-demo/) | local | Host-rendered plugin preferences, defaults, partial updates, and live change events. |
| [`buffer-ratio`](../../examples/plugins/buffer-ratio/) | tool (`tool: true`) | The smallest tool: looks up pKa values with `chemicals.list`. |
| [`cell-seeding`](../../examples/plugins/cell-seeding/) | tool (`tool: true`) | A full tool in **Tools**: hemocytometer count to a plate-seeding plan, remembered plate settings (`storage`), cell-line names (`samples.list`), and the plan saved to a notebook page. |
| [`plugins/qpcr-analysis`](../../plugins/qpcr-analysis/) | tool (`tool: true`) | An installable analysis tool: ΔΔCt and standard curves, `storage` drafts, notebook appends, TSV `downloads`, and its own tests. |
| [`plugins/scientific-illustration`](../../plugins/scientific-illustration/) | local (`serve: true`) | A full installable editor: manifest icon, `storage`/`files` persistence, the shared right toolbar, Protocol and PDF context actions, and the agent chat rail and canvas (`agent:chat`, `agent:canvas`). |
| [`src/plugins/gel`](../../src/plugins/gel/) | bundled | Hikari's source-owned Gel workspace, on the same served iframe and public API. The production-sized reference for persistence, recovery, responsive UI, and unsaved-change protection. |

The ImageJ and DNA-importer plugins are not committed examples;
[imagej-walkthrough.md](imagej-walkthrough.md) and
[service-plugins.md](service-plugins.md) keep their manifests and code as
worked examples.
