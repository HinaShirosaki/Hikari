# Hikari Codex runtime

`src/main/lib/codex-cli-provider/runtime-gateway.js` owns the Codex connection: executable normalization, invocation selection, runtime home, CLI version, and model/reasoning settings. Login, model discovery, requests, and the live illustration test use this gateway.

The gateway resolves an executable before preparing its home, expands quoted/relative/home paths, resolves symlinks, and handles Windows npm entrypoints through an absolute Node/script pair without a shell. A connection retains its immutable executable and model defaults for the duration of a request. Updating Codex or changing Settings affects subsequent connections.

`prepareCodexRuntime()` returns the invocation, environment, identity and diagnostics. `resolveCodexRequestSelection()` applies explicit choices before the connection's saved defaults. Callers pass this selection into the argument builder; the builder only serializes it. An explicitly selected model is always sent to Codex, including when absent from its catalog, so errors cannot silently switch the model.

`catalog.js` handles model/list and maps the response. Its cache is scoped to the executable/version, home and login. A failed discovery clears the cache, and a different connection cannot reuse it. An advertised model is not proof of successful inference; account errors from execution remain separate.

`cli-updater.js` runs native `codex update` for standard standalone installations. A verified downloader is retained for first installation and old Hikari layouts that Codex cannot self-update. Migration keeps old releases intact, creates Codex's standalone selection and private install directory, and emits the existing refresh event. Concurrent update requests share one operation. Failed updates restore the previous selected release. Explicit CLI overrides remain authoritative and are not automatically updated.

The selected CLI owns its model cache, version metadata and refreshed login. Hikari seeds missing auth/config files as private copies, preserves existing runtime state and detaches old file links before editing. Model caches are never copied or rewritten across clients.

Use `node test.js '^core/codex-cli-provider-suite/'` for regression coverage. `tests/scientific-illustration-renderer-live.cjs --live` uses the same preparation API before isolating storage and credentials. Windows path/invocation behavior is covered by simulated fixtures; actual Windows installation/update validation still requires a Windows host.
