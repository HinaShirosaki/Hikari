module.exports = function registerToolRoutingSuite(context = {}) {
  const { assert, path, test } = context.scope;
  const root = context.__dirname || process.cwd();
  const load = (relative) => require(path.join(root, 'src/main/agent', relative));
  const { HIKARI_MCP_TOOL_NAMES, buildHikariAgentMcpInstructions } = load('mcp-contract/instructions.js');
  const { HIKARI_MCP_TOOL_ROUTES, buildHikariToolRoutingInstructionLines } = load('mcp-contract/tool-routing.js');
  const { getAvailableHikariMcpToolNames } = load('mcp-contract/tool-availability.js');
  const { getDirectMcpToolDefinitions } = load('mcp-contract/direct-tools/index.js');
  const { buildCodexAgentPrompt } = load('codex-agent/prompts.js');
  const background = {
    projectId: 'project-1',
    snapshot: { scheduled_task: { id: 'run-1', task_type: 'notebook_suggestion', deny_paper_download: true } }
  };
  const routeNames = (text) => [...text.matchAll(/^- `([a-z_]+)`: /gm)].map((match) => match[1]).sort();
  const compactNames = (text) => [...(text.match(/^- Available workflows this turn: (.*)$/m)?.[1] || '').matchAll(/`([a-z_]+)`/g)]
    .map((match) => match[1]).sort();

  test('workflow routing covers every registered MCP tool exactly once', () => {
    assert.deepEqual(Object.keys(HIKARI_MCP_TOOL_ROUTES).sort(), [...HIKARI_MCP_TOOL_NAMES].sort());
    assert.deepEqual(routeNames(buildHikariToolRoutingInstructionLines().join('\n')), [...HIKARI_MCP_TOOL_NAMES].sort());
    const actualNames = new Set([
      ...getDirectMcpToolDefinitions().map((tool) => tool.name),
      ...getDirectMcpToolDefinitions(background).map((tool) => tool.name)
    ]);
    assert.deepEqual([...actualNames].sort(), Object.keys(HIKARI_MCP_TOOL_ROUTES).sort());
  });

  test('each MCP route survives independently when all other tools are disabled', () => {
    for (const name of HIKARI_MCP_TOOL_NAMES) {
      const base = name === 'notebook_suggest' ? background : {};
      const input = {
        ...base,
        message: 'Continue the requested task.',
        snapshot: {
          ...base.snapshot,
          settings: { agent: { disabledMcpToolNames: HIKARI_MCP_TOOL_NAMES.filter((other) => other !== name) } }
        }
      };
      assert.deepEqual(getAvailableHikariMcpToolNames(input), [name]);
      assert.deepEqual(getDirectMcpToolDefinitions(input).map((tool) => tool.name), [name]);
      assert.deepEqual(routeNames(buildCodexAgentPrompt(input)), [name]);
      assert.deepEqual(routeNames(buildHikariToolRoutingInstructionLines({ enabledToolNames: [name] }).join('\n')), [name]);
    }
  });

  // Codex 0.163 prepends server instructions to every tool description instead of
  // reading them as instructions, so they must stay short and route-free.
  test('MCP server instructions stay short and carry no routes', () => {
    const instructions = buildHikariAgentMcpInstructions();
    assert.ok(instructions.length < 400, `instructions are ${instructions.length} chars`);
    assert.deepEqual(routeNames(instructions), []);
    assert.doesNotMatch(instructions, /workflow routing/i);
  });

  test('MCP initialization, tools/list and chat routing agree on workflow availability', async () => {
    const { createAgentMcpStdioServer } = load('mcp-contract/stdio-server.js');
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
    for (const input of [
      {},
      { snapshot: { settings: { agent: { disabledMcpToolNames: ['chemical_lookup', 'assay_table', 'notebook_lookup', 'literature_search', 'sequence_get'] } } } },
      background,
      { ...background, snapshot: { ...background.snapshot, settings: { agent: { disabledMcpToolNames: ['literature_search'] } } } },
      { snapshot: { scheduled_task: { task_type: 'notebook_suggestion' } } },
      { snapshot: { settings: { agent: { disabledMcpToolNames: HIKARI_MCP_TOOL_NAMES } } } }
    ]) {
      const { server, connect } = createAgentMcpStdioServer({
        env: { HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify(input) },
        gateway: { callGatewayTool: async () => ({ ok: true }) }
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'routing-test', version: '1.0.0' }, { capabilities: {} });
      try {
        await connect(serverTransport);
        await client.connect(clientTransport);
        const { tools } = await client.listTools();
        const expected = tools.map((tool) => tool.name).sort();
        assert.equal(client.getInstructions(), buildHikariAgentMcpInstructions());
        assert.deepEqual(getAvailableHikariMcpToolNames(input).sort(), expected);
        assert.deepEqual(routeNames(buildCodexAgentPrompt({ ...input, message: 'Continue.' })), expected);
        const resumed = buildCodexAgentPrompt({ ...input, message: 'Continue.', codexSessionId: 'existing-session' });
        assert.deepEqual(routeNames(resumed), []);
        assert.deepEqual(compactNames(resumed), expected);
      } finally {
        await client.close();
        await server.close();
      }
    }
  });

  test('published MCP definitions include the ordinary and conditional tool contracts', () => {
    const contract = require(path.join(root, 'docs/agent/mcp-contract/mcp-contract.json'));
    assert.deepEqual(contract.mcp.tools, getDirectMcpToolDefinitions());
    assert.deepEqual(contract.mcp.conditional_tools, getDirectMcpToolDefinitions(background).filter((tool) => tool.name === 'notebook_suggest'));
  });
};
