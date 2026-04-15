# Telegram Bot

This folder holds shared Telegram bot modules.

- `config.js`: canonical command maps, search scopes, draft labels, and field labels.

Maintenance notes:

- Put static maps and label registries here instead of growing `telegramBot.js`.
- Keep keys canonical and lower-case so the parser and command router stay aligned.
- When adding a new Telegram intent or scope, update config first, then wire runtime behavior.
