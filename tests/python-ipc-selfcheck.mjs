// Self-check for the python:run IPC bridge in src/main/ipc/register-python-ipc.js.
//
// The registrar is the only thing between the renderer and process execution,
// so its payload normalization and failure shape get a runnable check. The last
// case runs real Python end to end when an interpreter is available.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { registerPythonIpc } = require(path.join(projectRoot, 'src/main/ipc/register-python-ipc.js'));
const { PYTHON } = require(path.join(projectRoot, 'src/shared/ipc/channels.js'));
const { developerToolsMissing, runPythonSandbox, resolvePythonExecutable } = require(
  path.join(projectRoot, 'src/main/agent/tools/agent-python-sandbox/runner.js')
);

function harness(deps = {}) {
  const handlers = new Map();
  registerPythonIpc({
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    ...deps
  });
  const handler = handlers.get(PYTHON.RUN);
  assert.ok(handler, 'python:run handler was not registered');
  return (payload) => handler({}, payload);
}

// A non-object payload becomes an empty input rather than reaching the runner raw.
{
  const seen = [];
  const invoke = harness({
    runPythonSandbox: (input, options) => {
      seen.push({ input, options });
      return { ok: true };
    },
    getSandboxRoot: () => '/sandbox-root'
  });

  await invoke('not-an-object');
  await invoke(['also', 'not']);
  await invoke({ code: 'print(1)' });

  assert.deepEqual(seen[0].input, {});
  assert.deepEqual(seen[1].input, {});
  assert.deepEqual(seen[2].input, { code: 'print(1)' });
  assert.equal(seen[2].options.sandboxRoot, '/sandbox-root', 'runs must be confined to the sandbox root');
}

// A broken sandbox root returns the normal result shape instead of rejecting.
{
  const invoke = harness({
    runPythonSandbox: () => ({ ok: true }),
    getSandboxRoot: () => {
      throw new Error('no sandbox root');
    }
  });

  const result = await invoke({ code: 'print(1)' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');
  assert.match(result.error, /no sandbox root/);
}

// Only macOS has the /usr/bin/python3 stub; elsewhere bare `python3` is always probed.
assert.strictEqual(await developerToolsMissing('linux'), false);
assert.strictEqual(await developerToolsMissing('win32'), false);

// End to end: the renderer payload actually executes Python and reads a file back.
{
  let pythonAvailable = true;
  try {
    await resolvePythonExecutable();
  } catch {
    pythonAvailable = false;
  }

  if (!pythonAvailable) {
    console.log('python-ipc-selfcheck: no Python interpreter found, skipped the end-to-end case.');
  } else {
    const invoke = harness({
      runPythonSandbox,
      getSandboxRoot: () => path.join(os.tmpdir(), 'hikari-python-ipc-selfcheck')
    });

    const result = await invoke({
      code: [
        'import pathlib',
        'value = int(pathlib.Path("input.txt").read_text()) * 2',
        'print(f"doubled {value}")',
        'pathlib.Path("output.txt").write_text(str(value))'
      ].join('\n'),
      files: [{ path: 'input.txt', content: '21' }],
      readback_paths: ['output.txt']
    });

    assert.equal(result.ok, true, `expected a successful run, got: ${result.error}`);
    assert.match(result.stdout, /doubled 42/);
    assert.deepEqual(result.readback_files.map((file) => file.path), ['output.txt']);
    assert.equal(result.readback_files[0].content, '42');
  }
}

console.log('python-ipc-selfcheck passed');
