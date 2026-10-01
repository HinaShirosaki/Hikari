# Security Policy

## Supported versions

Only the latest release (including the latest beta) receives security fixes. Please update before reporting.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub:
[Report a vulnerability](https://github.com/HinaShirosaki/Hikari/security/advisories/new)

Please include:

- what is affected (app, installer, updater, MCP server, plugin system, …) and the version
- steps to reproduce or a proof of concept
- the impact you expect (e.g. code execution, data exposure)

You should get an acknowledgement within 7 days. Once a fix is released, the advisory will be published and you will be credited unless you prefer otherwise.

## Scope

Hikari is local-first: it runs on your machine and stores data in a folder you choose. Of particular interest:

- code execution through opened files, imported data, plugins, or the agent/MCP tools beyond what the user approved
- the auto-updater and install scripts (`install.sh`, `install.ps1`)
- leaking local data or credentials to the network

Third-party plugins you install yourself run with the permissions described in [docs/plugins/](../docs/plugins/README.md); issues in those plugins should go to their authors.
