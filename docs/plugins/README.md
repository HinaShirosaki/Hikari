# Plugins

Sandboxed extensions. A plugin is a folder of web files that Hikari boots as a
first-class app with its own navigation entry and workspace view, plus narrow,
permission-gated host capabilities. Plugins can be user-installed or bundled
with Hikari.

| Document | Read it for |
| --- | --- |
| [quickstart.md](quickstart.md) | **Start here:** build, install, and harden a small plugin with a copyable host client. |
| [plugin-system.md](plugin-system.md) | The folder contract Hikari enforces, `plugin.json`, permissions, install/boot lifecycle, security model, and how to graduate a plugin into a built-in module. |
| [plugin-api.md](plugin-api.md) | Host API reference: every verb and host event, its permission, its request/response shape, and how to add a new one — data access, the right toolbar and context actions, and the agent chat and canvas. |
| [imagej-walkthrough.md](imagej-walkthrough.md) | Case study: a runtime-heavy plugin (ImageJ in WebAssembly), why it needs a real origin, and what "runs locally" does and does not cover. |
| [service-plugins.md](service-plugins.md) | Service plugins: headless capability providers, e.g. teaching the sequence viewer to open `.dna`. |
| [`src/plugins/README.md`](../../src/plugins/README.md) | Hikari contributors: source-owned internal plugins that still use the sandbox and public plugin API. |

Runnable examples:

| Example | Kind | Shows |
| --- | --- | --- |
| [`hello-world`](../../examples/plugins/hello-world/) | local | The minimum that installs: manifest, entry page, no host access. |
| [`notebook-results`](../../examples/plugins/notebook-results/) | local | Reading and writing notebook data through the host API. |
| [`plugins/scientific-illustration`](../../plugins/scientific-illustration/) | local (`serve: true`) | A full installable editor: manifest icon, `storage`/`files` persistence, the shared right toolbar, Protocol and PDF context actions, and the agent chat rail and canvas (`agent:chat`, `agent:canvas`). |


The `imagej` and `dna-importer` examples mentioned in older docs are no longer
in the repository; [imagej-walkthrough.md](imagej-walkthrough.md) and
[service-plugins.md](service-plugins.md) keep their manifests and code as
worked examples.

Internal reference: [`src/plugins/gel`](../../src/plugins/gel/) is Hikari's
source-owned, bundled Gel workspace. It is not installed through **Add Plugin
Folder**, but it deliberately uses the same served iframe and public API as an
installable plugin. Read it after the smaller examples when you need a
production-sized reference for persistence, recovery, responsive UI, and
unsaved-change protection.

**Start here:** follow [quickstart.md](quickstart.md). Copy `hello-world` for a
minimal page, or `notebook-results` when you need the host API. Both use classic
scripts and need no build step or development server; Hikari serves the folder
itself. Install from **Settings → Plugins → Add Plugin Folder**.
