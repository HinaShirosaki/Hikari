'use strict';

// node tests/hikari-mcp-launch-selfcheck.js [runtime-root] [electron-executable] [developer-app-root]
// Omit Electron to test external Node; supply the packaged executable to test
// the no-Node fallback. All workspace data and credentials are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function main() {
  const runtimeRoot = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  const electron = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
  const appPath = process.argv[4] ? path.resolve(process.argv[4]) : undefined;
  const { createAgentMcpHost } = require(path.join(runtimeRoot, 'src/main/agent/mcp-contract/host'));
  const { buildHikariCodexMcpConfigBlock } = require(path.join(runtimeRoot, 'src/main/agent/codex-agent/runtime-files'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari mcp connection-'));
  const calls = [];
  const hostEnv = {};
  const host = createAgentMcpHost({
    env: hostEnv,
    runTool: async (toolId, args, snapshot, context) => {
      calls.push({ toolId, args, snapshot, context });
      return { ok: true, status: 'completed', connection_proof: 'HIKARI_MCP_CONNECTED', items: [] };
    }
  });
  let transport;
  let client;
  let stderr = '';
  try {
    const [started, concurrent] = await Promise.all([host.ensureStarted(), host.ensureStarted()]);
    assert.equal(started.url, concurrent.url);
    const unauthorized = await fetch(started.url, { method: 'POST', body: '{}' });
    assert.equal(unauthorized.status, 401);
    const context = { traceRequestId: 'mcp-launch-selfcheck', snapshot: { fixture: 'isolated' } };
    const block = buildHikariCodexMcpConfigBlock({
      workspace,
      env: {}, envPath: '',
      mcpHostUrl: started.url, mcpToken: started.token,
      envOverrides: { HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify(context) },
      ...(electron ? {
        processExecPath: electron, electronVersion: 'fixture', defaultApp: Boolean(appPath), appPath,
        commonNodePaths: [], resourcesPath: '',
        fs: { statSync() { throw new Error('No external Node installed'); }, readdirSync: () => [] }
      } : { mcpCommandPath: process.execPath })
    });
    // Parse only the emitted command, args, and JSON-escaped string entries.
    const command = JSON.parse(block.match(/^command = (.+)$/m)[1]);
    const args = JSON.parse(block.match(/^args = (.+)$/m)[1]);
    const inlineEnv = block.match(/^env = \{ (.*) \}$/m)[1];
    const env = Object.fromEntries([...inlineEnv.matchAll(/(\w+) = ("(?:\\.|[^"\\])*")/gu)]
      .map((match) => [match[1], JSON.parse(match[2])]));
    Object.assign(env, { PATH: process.platform === 'win32' ? (process.env.SystemRoot || 'C:\\Windows') : '/usr/bin:/bin' });
    transport = new StdioClientTransport({ command, args, env, cwd: workspace, stderr: 'pipe' });
    transport.stderr.on('data', (chunk) => { stderr += chunk; });
    client = new Client({ name: 'hikari-mcp-launch-qa', version: '1.0.0' });
    await client.connect(transport, { timeout: 20000 });
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'memory'));
    assert.ok(tools.tools.some((tool) => tool.name === 'inventory_lookup'));
    const response = await client.callTool({ name: 'memory', arguments: { action: 'list', limit: 1 } });
    assert.equal(response.isError, false);
    assert.match(JSON.stringify(response), /HIKARI_MCP_CONNECTED/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, 'memory');
    assert.equal(calls[0].context.traceRequestId, context.traceRequestId);
    assert.equal(calls[0].snapshot.fixture, 'isolated');
    const pid = transport.pid;
    await client.close();
    client = null;
    if (pid) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    await host.close();
    assert.equal(hostEnv.HIKARI_AGENT_MCP_HOST, undefined);
    const restarted = await host.ensureStarted();
    assert.ok(restarted.url);
    console.log(JSON.stringify({ ok: true, mode: electron ? 'embedded-electron' : 'external-node',
      toolCount: tools.tools.length, authenticatedToolCall: true, requestContext: true,
      cleanChildExit: true, hostRestart: true, runtimeRoot }));
  } catch (error) {
    // Never dump generated config or environment: they carry the host token.
    console.error(error.message);
    console.error(stderr.slice(-3000));
    process.exitCode = 1;
  } finally {
    await client?.close();
    await host.close();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
