# Plugins

Sandboxed extensions. A plugin is a folder of web files that Hikari boots as a
first-class app with its own navigation entry and workspace view, plus narrow,
permission-gated host capabilities. Plugins can be user-installed or bundled
with Hikari.

| Document | Read it for |
| --- | --- |
| [quickstart.md](quickstart.md) | **Start here:** build, install, and harden a small plugin with a copyable host client. |
| [plugin-system.md](plugin-system.md) | The folder contract Hikari enforces, `plugin.json`, permissions, install/boot lifecycle, security model, and how to graduate a plugin into a built-in module. |
| [plugin-api.md](plugin-api.md) | Host API reference: every verb, its permission, its request/response shape, and how to add a new one. |
| [imagej-walkthrough.md](imagej-walkthrough.md) | Served plugins: why storage forces `serve: true`, and what "runs locally" does and does not cover. |
| [service-plugins.md](service-plugins.md) | Service plugins: headless capability providers, e.g. teaching the sequence viewer to open `.dna`. |

Runnable examples:

| Example | Kind | Shows |
| --- | --- | --- |
| [`hello-world`](../../examples/plugins/hello-world/) | local | The minimum that installs: manifest, entry page, no host access. |
| [`notebook-results`](../../examples/plugins/notebook-results/) | local | Reading and writing notebook data through the host API. |
| [`imagej`](../../examples/plugins/imagej/) | served | Real ImageJ running locally, on its own loopback origin. |
| [`snapgene-dna`](../../examples/plugins/snapgene-dna/) | service | Headless `.dna` → GenBank converter, so the sequence viewer can open `.dna`. |
| [`gel`](../../examples/plugins/gel/) | bundled + served | **The Gel app itself**, moved out of the renderer. It owns its workspace code, keeps a compact record index in `storage`, stores images/reports in `files`, exports through `downloads`, follows host appearance context, and imports pre-port Gel records once. |

**Start here:** follow [quickstart.md](quickstart.md). Copy `hello-world` for a
minimal page, or `notebook-results` when you need the host API. Both use classic
scripts and work as local plugins without a development server.
