# Enana (Electron App)

Enana is a desktop Electron app for lab workflow management:
- members, instruments, protocols, notebooks
- assay/gel analysis
- inventory and sample registry
- papers and agent-assisted Q&A

## Install For End Users

1. Download the installer package produced from `npm run dist`.
2. Install like a normal desktop app on your OS.
3. Launch Enana directly (no Node.js or manual dependency install needed).

Installer outputs are generated under `out/make/`.

## Build / Package

```bash
npm install
npm test
npm run dist
```

Helpful scripts:
- `npm run start`: run app in dev mode
- `npm run package:app`: package app folder without installer
- `npm run dist`: build installer artifacts

## Portability Notes

- Static frontend assets are loaded with app-relative paths (no machine-specific absolute paths).
- Packaging is configured with `asar` + dependency pruning for smaller, portable builds.
- Build artifacts (`out/`, `output/`, `tmp/`) are excluded from packaged installers.

## Optional External Services

Some features are optional and require external setup:
- LLM/API features need an API key in Settings (or env vars).
- Telegram bot commands need a Telegram bot token.
