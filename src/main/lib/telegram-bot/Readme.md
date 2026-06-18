# Telegram Bot

This folder holds the Telegram bot's pure, stateless modules. `../telegramBot.js`
is the runtime: it owns the Telegraf instance and per-chat session state (drafts,
protocol runs, reminders, history) and wires these modules into command and
message handlers.

- `config.js`: canonical command maps, search scopes, draft labels, and field labels.
- `text-utils.js`: generic string/token/regex helpers (command args, token
  normalization, Levenshtein, compaction, linked-record extraction).
- `modules.js`: module-catalog and search-target resolution, plus fuzzy
  suggestions for mistyped module tokens.
- `renderer-bridge.js`: sends Telegram commands to the renderer over IPC and
  reports main-window status.
- `logging.js`: resolves the log path and appends JSON-lines message/lifecycle
  entries (default `data/telegram-events.log`).
- `duration.js`: duration parsing and timer-request extraction.
- `event-parsers.js`: heuristic parsers that turn free-text lab messages into
  structured event records, plus event-type detection.
- `intent.js`: natural-language intent classification (lookup, protocol
  execution, draft creation, reminders, chat) and intent↔event-type mapping.
- `formatting.js`: draft/protocol/context reply formatting and chat-context
  defaults.

Maintenance notes:

- Put static maps and label registries in `config.js` instead of growing
  `telegramBot.js`.
- Keep these modules pure (no Telegraf/session state); stateful wiring belongs in
  `telegramBot.js`.
- Keys stay canonical and lower-case so the parser and command router stay aligned.
- When adding a new Telegram intent or scope, update config first, then the
  relevant pure module, then wire runtime behavior in `telegramBot.js`.
