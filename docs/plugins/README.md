# Plugins

User-installed extensions. A plugin is a folder of web files that Hikari boots
as a first-class app with its own navigation entry and workspace view, plus
permission-gated read/write access to protocols, notebook entries, projects,
and samples.

| Document | Read it for |
| --- | --- |
| [plugin-system.md](plugin-system.md) | The folder contract Hikari enforces, `plugin.json`, permissions, install/boot lifecycle, security model, and how to graduate a plugin into a built-in module. |
| [plugin-api.md](plugin-api.md) | Host API reference: every verb, its permission, its request/response shape, and how to add a new one. |
| [imagej-walkthrough.md](imagej-walkthrough.md) | Served plugins: why storage forces `serve: true`, and what "runs locally" does and does not cover. |

Runnable examples:

| Example | Kind | Shows |
| --- | --- | --- |
| [`hello-world`](../../examples/plugins/hello-world/) | local | The minimum that installs: manifest, entry page, no host access. |
| [`notebook-results`](../../examples/plugins/notebook-results/) | local | Reading and writing notebook data through the host API. |
| [`imagej`](../../examples/plugins/imagej/) | served | Real ImageJ running locally, on its own loopback origin. |

**Start here:** copy `hello-world`, rename the folder and its manifest `id` to
match, and install it via **Settings → Plugins → Add Plugin Folder**. Then add
permissions and API calls as you need them.
