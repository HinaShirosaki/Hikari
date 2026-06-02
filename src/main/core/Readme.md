# Main Core

`src/main/core/` is the main-process composition boundary for Hikari.

The core owns service construction, path/runtime setup, main IPC registration, agent service wiring, storage helpers, sequence-library wiring, Telegram runtime wiring, prompt loading, and long-running background monitors.

Electron lifecycle concerns stay in `src/main/app/`. `start-main-app.js` creates the window, responds to app lifecycle events, and starts or stops the core. `main-runtime.js` remains a compatibility wrapper for older imports of `createMainRuntime()`.

Feature and protocol logic should stay in the helper/runtime folders that own it. The core may wire protocol, notebook, agent, storage, sequence, and system services together, but it should not grow feature-specific implementation logic.
