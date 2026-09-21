module.exports = function registerAgentContractsA(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  const { assert, fs, path, test } = scope;
    const agentPath = (...parts) => path.join(__dirname, 'src', 'main', 'agent', ...parts);
    const readCatalog = (fileName) => JSON.parse(fs.readFileSync(agentPath('tools', fileName), 'utf8'));

    // The catalogs are what the model actually sees, so a tool silently losing its
    // entry or its input schema is a runtime failure no executing test would catch.
    const registeredTools = [
      'inventory-lookup',
      'notebook-lookup',
      'python-sandbox',
      'command-line',
      'web-search',
      'sub-agent',
      'memory',
      'container',
      'literature-search',
      'purchase-recommendation',
      'paper-download',
      'paper-analysis',
      'notebook-draft',
      'protocol-generation',
      'assay-table',
      'plotly-graph'
    ];

    test('agent tool catalogs declare every registered tool with a described input schema', () => {
      const toolsCatalog = readCatalog('Tools.json');
      const toolCallCatalog = readCatalog('Tool-call.json');
      assert.equal(Array.isArray(toolsCatalog), true);
      assert.equal(Boolean(toolCallCatalog.$defs), true);

      const missingFromTools = registeredTools.filter((name) => !toolsCatalog.some((entry) => entry?.name === name));
      const missingSchema = registeredTools.filter((name) => !toolCallCatalog[name]?.input_schema);
      const missingDescription = registeredTools.filter((name) => typeof toolCallCatalog[name]?.description !== 'string');
      assert.deepEqual(missingFromTools, []);
      assert.deepEqual(missingSchema, []);
      assert.deepEqual(missingDescription, []);

      assert.deepEqual(toolCallCatalog['inventory-lookup']?.input_schema?.properties?.kinds, {
        type: 'array',
        items: {
          type: 'string',
          enum: ['chemical', 'personal_container', 'personal_sample']
        },
        minItems: 1,
        maxItems: 3,
        uniqueItems: true
      });
      assert.equal(toolCallCatalog['notebook-draft']?.input_schema?.properties?.pending_values?.$ref, '#/$defs/pending_values');
      assert.equal(toolCallCatalog['notebook-draft']?.input_schema?.properties?.step_edits?.type, 'array');
    });

    test('tool argument normalization accepts catalog-shaped calls', () => {
      const { normalizeToolArgumentsPayload } = require(agentPath('tools', 'agent-tool-loading.js'));
      assert.equal(normalizeToolArgumentsPayload({
        tool_calls: [{
          tool_name: 'inventory-lookup',
          arguments: {
            query: 'BL21(DE3)',
            kinds: ['personal_container', 'personal_sample']
          }
        }]
      }).ok, true);
      assert.equal(normalizeToolArgumentsPayload({
        tool_calls: [{
          tool_name: 'notebook-lookup',
          arguments: {
            query: 'BL21(DE3)',
            detail: 'full'
          }
        }]
      }).ok, true);
    });

    test('the generic tool executor stays free of per-tool hardcoding', () => {
      const executionSource = fs.readFileSync(agentPath('tools', 'agent-tool-execution.js'), 'utf8');
      const hardcoded = registeredTools.filter((name) => new RegExp(`["']${name}["']`).test(executionSource));
      assert.deepEqual(hardcoded, [], 'tools reach the executor through the registry, not by name');
      assert.match(executionSource, /function registerToolExecutor\(toolName, executor\)/);
      assert.match(executionSource, /function getToolExecutor\(toolName\)/);
    });
};
