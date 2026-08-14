'use strict';

const { PYTHON } = require('../../shared/ipc/channels');

// Runs renderer-supplied Python through the same sandbox runner the agent tool
// uses: every run gets its own throwaway directory under the sandbox root and
// that directory is removed when the run ends.
//
// Note there is deliberately no channel that takes a filesystem path. `files`
// and `readback_paths` are resolved inside the run directory by the runner, so
// the renderer cannot use this bridge to name a file outside it.
//
// That is the only confinement here. `code` is arbitrary Python run by a child
// process that inherits the full parent environment (including HIKARI_LLM_API_KEY
// and HIKARI_CODEX_ACCESS_TOKEN), with no filesystem or network restriction — the
// run directory is a scratch space, not a jail. Plugins DO reach this channel:
// `python.run` in the plugin bridge forwards to the preload's `runPython`, and
// `python` is a self-declared plugin permission. Treat granting it as equivalent
// to granting arbitrary local code execution.
function registerPythonIpc({ ipcMain, runPythonSandbox, getSandboxRoot } = {}) {
  ipcMain.handle(PYTHON.RUN, async (_event, payload) => {
    const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    try {
      return await runPythonSandbox(input, {
        sandboxRoot: typeof getSandboxRoot === 'function' ? getSandboxRoot() : ''
      });
    } catch (error) {
      // The runner reports its own failures in the result; this only catches a
      // broken sandbox root so the renderer still gets the normal result shape.
      return {
        ok: false,
        status: 'error',
        error: String(error?.message || error) || 'Python execution failed before launch.',
        stdout: '',
        stderr: '',
        exit_code: null,
        warnings: [],
        summary: 'Python execution failed before launch.'
      };
    }
  });
}

module.exports = {
  registerPythonIpc
};
