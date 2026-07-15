module.exports = function registerLoopRuntimeEdgeAndProtocolSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    // The science-reasoning-loop edge-case tests moved out with /self-agent when it
    // was isolated; the src-backed protocol-generation tests below remain.

    test('protocol generation runtime normalizes import-ready protocol JSON without an llm call', async () => {
      let createIdCounter = 0;
      const requestOptions = [];
      const runtime = agentProtocolGeneration.createProtocolGenerationRuntime({
        now: () => '2026-03-22T12:00:00.000Z',
        createId: () => `generated-${++createIdCounter}`,
        requestStructuredJsonPayload: async (options = {}) => {
          requestOptions.push(options);
          throw new Error('protocol generation should not call the llm');
        }
      });

      const result = await runtime.generateProtocol({
        protocol: {
          name: 'PD-1 Nanobody Purification',
          purpose: 'Purify the expressed PD-1 nanobody from lysate.',
          materials: ['Ni-NTA resin', 'imidazole buffer'],
          steps: [
            'Clarify lysate.',
            'Bind clarified lysate to Ni-NTA resin for [time].',
            'Elute bound protein with imidazole.'
          ],
          troubleshooting: [
            {
              problem: 'Low yield',
              possible_cause: 'Insufficient binding time',
              solution: 'Extend resin contact time.'
            }
          ]
        },
        result_summary: 'Prepared a purification protocol.'
      });

      assert.equal(result.ok, true);
      assert.equal(result.status, 'normalized');
      assert.equal(result.protocol.name, 'PD-1 Nanobody Purification');
      assert.equal(Object.prototype.hasOwnProperty.call(result.protocol, 'id'), false);
      assert.equal(result.protocol.createdAt, '2026-03-22T12:00:00.000Z');
      assert.equal(result.protocol.updatedAt, '2026-03-22T12:00:00.000Z');
      assert.equal(Array.isArray(result.protocol.materials), true);
      assert.equal(result.protocol.materials[0], 'Ni-NTA resin');
      assert.equal(Array.isArray(result.protocol.steps), true);
      assert.equal(result.protocol.steps.length, 3);
      assert.match(String(result.protocol.steps[1].text || ''), /\{\{ph:/);
      assert.equal(result.protocol.steps[1].placeholders[0].name, 'time');
      assert.match(String(result.protocol.troubleshooting || ''), /Low yield/);
      assert.equal(result.summary, 'Prepared a purification protocol.');
      assert.equal(requestOptions.length, 0);
    });

    test('protocol generation prompt documents deterministic protocol json normalization', () => {
      const runtime = agentProtocolGeneration.createProtocolGenerationRuntime();
      const prompt = runtime.buildPrompt({
        protocol: {
          name: 'HEK293 Transfection',
          steps: ['Seed HEK293 cells.', 'Transfect at 37 C.']
        }
      });

      assert.match(runtime.PROTOCOL_GENERATION_SYSTEM_PROMPT, /Do not generate protocol content/i);
      assert.match(prompt, /Do not call an LLM or web search/i);
      assert.match(prompt, /HEK293 Transfection/);
    });
  }
};
