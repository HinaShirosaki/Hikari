# Main Service Catalog

`main-service-catalog.js` is the stable composition facade. Definitions are grouped here by ownership:

- `app-services.js`: app metadata, persistence, logging, prompts, npm updates, and Telegram.
- `agent-services.js`: provider-neutral agent foundation, MCP, Codex, and the completed controller facade.
- `ipc-services.js`: data, agent, and system IPC adapters.
- `constants.js`: shared filenames used by service definitions.

Each module returns plain lifecycle definitions. Ordering and dependency validation remain owned by `service-lifecycle.js`.
