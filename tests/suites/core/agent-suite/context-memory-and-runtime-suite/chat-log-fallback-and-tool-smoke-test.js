module.exports = function registerAgentContextMemoryAndRuntimeSuiteChatLogFallbackAndToolSmokeTest(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('agent chat log runtime builds fallback assistant message for controller errors', () => {
      const runtime = agentChatLog.createAgentChatLogRuntime();
      const assistantMessage = runtime.buildAssistantMessageFromError({
        errorMessage: 'Provider timeout.',
        requestText: 'Analyze the latest assay.'
      });

      assert.equal(assistantMessage.role, 'assistant');
      assert.match(String(assistantMessage.text || ''), /Provider timeout/);
      assert.equal(assistantMessage.meta.parser.needs_clarification, true);
      assert.equal(assistantMessage.meta.parser.clarification_reason, 'agent_error');
      assert.equal(assistantMessage.meta.requestText, 'Analyze the latest assay.');
    });
    test('agent tool smoke-test runtime manually exercises every registered tool', async () => {
      const runtime = agentToolSmokeTest.createAgentToolSmokeTestRuntime();
      const result = await runtime.runAllTools();

      assert.equal(result.ok, true);
      assert.equal(result.status, 'completed');
      assert.equal(result.tool_count, runtime.toolNames.length);
      assert.equal(result.failed_count, 0);
      assert.equal(result.passed_count, result.tool_count);
      assert.deepEqual(result.items.map((item) => item.tool_name), runtime.toolNames);
      assert.equal(result.items.every((item) => item.ok === true), true);
      assert.equal(result.items.every((item) => Number.isFinite(Number(item.duration_ms))), true);
      assert.equal(result.items.some((item) => item.tool_name === 'notebook-draft' && /Viability Assay/i.test(String(item.preview || ''))), true);
      assert.equal(result.items.some((item) => item.tool_name === 'python-sandbox' && /out\.json/.test(String(item.preview || ''))), true);
      assert.equal(result.items.some((item) => item.tool_name === 'paper-download' && /\.pdf/i.test(String(item.preview || ''))), true);
      assert.equal(result.items.some((item) => item.tool_name === 'paper-search' && /Methods/i.test(String(item.preview || ''))), true);
      assert.match(String(result.summary || ''), /tools passed/i);
    });
  }
};
