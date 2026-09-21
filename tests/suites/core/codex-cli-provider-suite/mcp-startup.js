module.exports = function registerMcpStartup(context = {}) {
  const { test } = context.scope;
  const assert = require('node:assert/strict');
  const path = require('node:path');
  const fs = require('node:fs');
  const os = require('node:os');
  const {
    resolveHikariCodexMcpInvocation, resolveUnpackedAsarPath, buildHikariCodexMcpConfigBlock
  } = require('../../../../src/main/agent/codex-agent/runtime-files');
  const { createCodexWorkspaceInitializer } = require('../../../../src/main/core/services/create-codex-workspace-initializer');

  function options(platform, files = []) {
    const windows = platform === 'win32';
    return {
      platform, home: windows ? 'C:\\Users\\Test User' : '/home/test',
      envPath: '', env: {}, commonNodePaths: [], resourcesPath: '',
      electronVersion: '41.0.0', defaultApp: false,
      processExecPath: windows ? 'C:\\Program Files\\Hikari\\Hikari.exe'
        : platform === 'darwin' ? '/Applications/Hikari.app/Contents/MacOS/Hikari' : '/opt/Hikari/hikari',
      serverPath: windows ? 'C:\\Program Files\\Hikari\\resources\\app.asar.unpacked\\src\\main\\agent\\mcp-contract\\stdio-server.js'
        : '/opt/Hikari/resources/app.asar.unpacked/src/main/agent/mcp-contract/stdio-server.js',
      fs: {
        statSync(file) {
          if (!files.includes(file)) throw new Error('ENOENT');
          return { isFile: () => true, mode: 0o755 };
        },
        readdirSync: () => [],
        realpathSync: (file) => file
      }
    };
  }

  for (const platform of ['darwin', 'win32', 'linux']) {
    test(`MCP starts with Hikari's embedded runtime when Node is absent on ${platform}`, () => {
      const fixture = options(platform);
      const invocation = resolveHikariCodexMcpInvocation(fixture);
      assert.deepEqual(invocation, { command: fixture.processExecPath, args: ['--hikari-mcp-stdio'] });
      const config = buildHikariCodexMcpConfigBlock(fixture);
      assert.ok(config.includes(`command = ${JSON.stringify(fixture.processExecPath)}`));
      assert.match(config, /args = \["--hikari-mcp-stdio"\]/);
      assert.doesNotMatch(config, /ELECTRON_RUN_AS_NODE/);
    });
    test(`MCP uses an absolute external Node executable on ${platform}`, () => {
      const node = platform === 'win32' ? 'D:\\Node Runtime\\node.exe' : '/custom node/bin/node';
      const fixture = { ...options(platform, [node]), electronVersion: '', envPath: path[platform === 'win32' ? 'win32' : 'posix'].dirname(node) };
      assert.deepEqual(resolveHikariCodexMcpInvocation(fixture), { command: node, args: [fixture.serverPath] });
    });
    test(`packaged MCP ignores unrelated system Node on ${platform}`, () => {
      const node = platform === 'win32' ? 'D:\\Node\\node.exe' : '/usr/bin/node';
      const fixture = { ...options(platform, [node]), envPath: path[platform === 'win32' ? 'win32' : 'posix'].dirname(node) };
      assert.deepEqual(resolveHikariCodexMcpInvocation(fixture), { command: fixture.processExecPath, args: ['--hikari-mcp-stdio'] });
      assert.deepEqual(resolveHikariCodexMcpInvocation({ ...fixture, mcpCommandPath: node }), { command: node, args: [fixture.serverPath] });
    });
  }
  test('MCP developer Electron fallback includes the app directory as a distinct argument', () => {
    const fixture = { ...options('win32'), defaultApp: true, appPath: 'D:\\Hikari Dev' };
    assert.deepEqual(resolveHikariCodexMcpInvocation(fixture).args, ['D:\\Hikari Dev', '--hikari-mcp-stdio']);
  });
  test('MCP converts Windows and POSIX ASAR paths without damaging spaces or Unicode', () => {
    for (const original of ['C:\\Users\\实验 User\\Hikari\\resources\\app.asar\\src\\server.js', '/Applications/Hikari App/resources/app.asar/src/server.js']) {
      assert.equal(resolveUnpackedAsarPath(original), original.replace('app.asar', 'app.asar.unpacked'));
      assert.equal(resolveUnpackedAsarPath(resolveUnpackedAsarPath(original)), resolveUnpackedAsarPath(original));
    }
  });
  test('MCP reports a missing runtime instead of emitting an unresolved node command', () => {
    assert.throws(() => resolveHikariCodexMcpInvocation({ ...options('linux'), electronVersion: '' }), /Node.js runtime/);
  });
  test('MCP workspace rejects a missing host and records the startup failure', async () => {
    let writes = 0;
    const initializer = createCodexWorkspaceInitializer({
      mcpHost: { ensureStarted: async () => ({}) },
      ensureCodexCliRuntimeHome: async () => { writes++; return '/runtime'; }
    });
    await assert.rejects(initializer.initialize(), /MCP host is unavailable/);
    assert.equal(writes, 0);
    assert.equal(initializer.getLastResult().status, 'failed');
  });
  test('MCP config write errors propagate and initialization can retry successfully', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-mcp-retry-'));
    let fail = true;
    const initializer = createCodexWorkspaceInitializer({
      getCodexCliWorkingDirectory: () => workspace,
      mcpHost: { ensureStarted: async () => ({ url: 'http://127.0.0.1:12345/mcp', token: 'fixture' }) },
      ensureCodexCliRuntimeHome: async () => {
        if (fail) throw new Error('EACCES: config.toml');
        return path.join(workspace, 'Config', 'codex-cli-home');
      },
      releaseOfficialMcpSkillsForWorkspace: async () => []
    });
    try {
      await assert.rejects(initializer.initialize(), /EACCES/);
      assert.equal(initializer.getLastResult().ok, false);
      fail = false;
      assert.equal((await initializer.initialize()).ok, true);
    } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
  });
  test('generated MCP command completes a real stdio handshake and tool call', async () => {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari mcp stdio-'));
    const client = new Client({ name: 'hikari-stdio-test', version: '1.0.0' });
    const config = buildHikariCodexMcpConfigBlock({ mcpCommandPath: process.execPath, workspace });
    const command = JSON.parse(config.match(/^command = (.+)$/m)[1]);
    const args = JSON.parse(config.match(/^args = (.+)$/m)[1]);
    const transport = new StdioClientTransport({ command, args, cwd: workspace, env: {
      PATH: process.platform === 'win32' ? (process.env.SystemRoot || 'C:\\Windows') : '/usr/bin:/bin',
      HIKARI_AGENT_MCP_WORKSPACE: workspace,
      HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify({ snapshot: { settings: { agent: { disabledMcpToolNames: ['memory'] } } } })
    }, stderr: 'pipe' });
    try {
      await client.connect(transport, { timeout: 10000 });
      const result = await client.listTools();
      assert.ok(result.tools.some((tool) => tool.name === 'inventory_lookup'));
      assert.ok(!result.tools.some((tool) => tool.name === 'memory'));
      const response = await client.callTool({ name: 'ask_user', arguments: { question: 'Fixture question?', options: ['Yes'] } });
      assert.equal(response.isError, false);
      assert.match(JSON.stringify(response), /Fixture question/);
    } finally {
      await client.close();
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
};
