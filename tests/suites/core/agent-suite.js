module.exports = function registerAgentSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('intent parser normalizes canonical parser payload', () => {
      const raw = {
        primary_intent: 'inventory_lookup',
        needs_clarification: false,
        clarification_reason: null,
        entities: {
          activity_type: 'lookup',
          project_name: 'Atlas',
          protocol_name: null,
          protein_name: null,
          compound_name: 'Tris',
          inventory_item: 'Tris-HCl',
          cell_line: null,
          paper_title: null,
          workflow_step: null,
          requested_output: 'location'
        },
        inventory_search: {
          normalized_query: 'Tris-HCl',
          candidate_terms: ['Tris-HCl', 'tris', 'Tris-HCl'],
          aliases: ['tris(hydroxymethyl)aminomethane'],
          search_mode: 'exact_then_alias_then_fuzzy'
        },
        protocol_candidates: ['HEK293 Transfection'],
        reasoning_summary: 'Inventory lookup for Tris-HCl.'
      };

      const result = agentIntentParser.normalizeIntentParserPayload(raw);
      assert.equal(result.ok, true);
      assert.equal(result.payload.primary_intent, 'inventory_lookup');
      assert.equal(result.payload.needs_clarification, false);
      assert.equal(result.payload.inventory_search.normalized_query, 'Tris-HCl');
      assert.equal(Array.isArray(result.payload.inventory_search.candidate_terms), true);
      assert.equal(result.payload.inventory_search.candidate_terms.length >= 2, true);
      assert.deepEqual(result.payload.protocol_candidates, []);
      assert.match(result.payload.reasoning_summary, /Inventory lookup/);
    });

    test('intent parser normalizes protocol candidates for protocol_to_notebook intent', () => {
      const raw = {
        primary_intent: 'protocol_to_notebook',
        needs_clarification: false,
        clarification_reason: null,
        entities: {
          activity_type: 'transfection',
          project_name: 'Atlas',
          protocol_name: 'HEK293 Transfection',
          protein_name: null,
          compound_name: null,
          inventory_item: null,
          cell_line: 'HEK293',
          paper_title: null,
          workflow_step: null,
          requested_output: 'notebook'
        },
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: ['HEK293 Transfection', 'HEK293 transfection', 'Expi293 Transfection'],
        reasoning_summary: 'Protocol intent payload.'
      };

      const result = agentIntentParser.normalizeIntentParserPayload(raw);
      assert.equal(result.ok, true);
      assert.equal(result.payload.primary_intent, 'protocol_to_notebook');
      assert.equal(Array.isArray(result.payload.protocol_candidates), true);
      assert.equal(result.payload.protocol_candidates.length <= 3, true);
      assert.equal(result.payload.protocol_candidates[0], 'HEK293 Transfection');
    });

    test('intent parser rejects legacy confidence and secondary_intents fields', () => {
      const withConfidence = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'general_science_question',
        needs_clarification: false,
        clarification_reason: null,
        entities: {
          activity_type: null,
          project_name: null,
          protocol_name: null,
          protein_name: null,
          compound_name: null,
          inventory_item: null,
          cell_line: null,
          paper_title: null,
          workflow_step: null,
          requested_output: null
        },
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: [],
        reasoning_summary: 'General question.',
        confidence: 0.91
      });
      assert.equal(withConfidence.ok, false);
      assert.match(String(withConfidence.error || ''), /must not include confidence/i);

      const withSecondary = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'general_science_question',
        needs_clarification: false,
        clarification_reason: null,
        entities: {
          activity_type: null,
          project_name: null,
          protocol_name: null,
          protein_name: null,
          compound_name: null,
          inventory_item: null,
          cell_line: null,
          paper_title: null,
          workflow_step: null,
          requested_output: null
        },
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: [],
        reasoning_summary: 'General question.',
        secondary_intents: ['inventory_lookup']
      });
      assert.equal(withSecondary.ok, false);
      assert.match(String(withSecondary.error || ''), /secondary_intents/i);
    });

    test('intent parser rejects protocol_candidates lists longer than 3', () => {
      const result = agentIntentParser.normalizeIntentParserPayload({
        primary_intent: 'protocol_to_notebook',
        needs_clarification: false,
        clarification_reason: null,
        entities: {
          activity_type: null,
          project_name: null,
          protocol_name: null,
          protein_name: null,
          compound_name: null,
          inventory_item: null,
          cell_line: null,
          paper_title: null,
          workflow_step: null,
          requested_output: null
        },
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: ['A', 'B', 'C', 'D'],
        reasoning_summary: 'Too many protocol candidates.'
      });
      assert.equal(result.ok, false);
      assert.match(String(result.error || ''), /at most 3/i);
    });

    test('intent parser maps aliases and typo variants to canonical intents', () => {
      assert.equal(agentIntentParser.normalizeParserIntent('data_analysis_or_coding'), 'result_analysis');
      assert.equal(agentIntentParser.normalizeParserIntent('coding-data-analysis'), 'result_analysis');
      assert.equal(agentIntentParser.normalizeParserIntent('inventory_loopup'), 'inventory_lookup');
      assert.equal(agentIntentParser.normalizeParserIntent('record_loopup'), 'record_lookup');
    });

    test('intent parser prompt includes recent transcript and active project context', () => {
      const prompt = agentIntentParser.buildIntentParserPrompt({
        message: 'Do we have PEI in stock?',
        conversation: [
          { role: 'user', text: 'Hello' },
          { role: 'assistant', text: 'Hi there' }
        ],
        projectName: 'Cancer Study'
      });
      assert.match(prompt, /Active project context: Cancer Study/);
      assert.match(prompt, /Recent conversation:/);
      assert.match(prompt, /User message:/);
    });

    test('agent observability replays lifecycle and llm traces in order', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-observability-'));
      const logPath = path.join(tempDir, 'agent-chat.log');
      try {
        await agentObservability.appendLogWithRotation({
          logPath,
          entry: JSON.stringify({
            type: 'agent-chat-request',
            requestId: 'req-1',
            timestamp: '2026-03-21T10:00:00.000Z',
            message: 'Do we have PEI?'
          })
        });
        await agentObservability.appendLogWithRotation({
          logPath,
          entry: JSON.stringify({
            type: 'agent-lifecycle',
            requestId: 'req-1',
            stage: 'parser_completed',
            status: 'ok',
            timestamp: '2026-03-21T10:00:01.000Z'
          })
        });
        await agentObservability.appendLogWithRotation({
          logPath,
          entry: JSON.stringify({
            type: 'agent-llm-trace',
            requestId: 'req-1',
            stage: 'intent_parser',
            provider: 'openai',
            model: 'gpt-5',
            summary: 'Intent parsed.',
            timestamp: '2026-03-21T10:00:02.000Z',
            request_payload: { prompt: '...' },
            response_payload: { primary_intent: 'inventory_lookup' }
          })
        });
        await agentObservability.appendLogWithRotation({
          logPath,
          entry: JSON.stringify({
            type: 'agent-chat-result',
            requestId: 'req-1',
            ok: true,
            parser: { primary_intent: 'inventory_lookup' },
            timestamp: '2026-03-21T10:00:03.000Z'
          })
        });

        const replay = await agentObservability.replayRequestLifecycle({
          requestId: 'req-1',
          logPath
        });
        assert.equal(replay.ok, true);
        assert.equal(Array.isArray(replay.events), true);
        assert.equal(Array.isArray(replay.traces), true);
        assert.equal(replay.events.length, 1);
        assert.equal(replay.traces.length, 1);
        assert.equal(replay.traces[0].stage, 'intent_parser');
        assert.equal(Array.isArray(replay.summary.trace_stages), true);
        assert.equal(replay.summary.trace_stages.includes('intent_parser'), true);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('python sandbox executes deterministic readback payload', async () => {
      const result = await agentPython.runPythonSandbox({
        code: 'import json\nopen("out.json", "w", encoding="utf-8").write(json.dumps({"ok": True, "value": 42}))',
        readback_paths: ['out.json'],
        timeout_ms: 4000
      });
      assert.equal(result.ok, true);
      assert.equal(result.status, 'ok');
      assert.equal(Array.isArray(result.readback_files), true);
      assert.equal(result.readback_files.length, 1);
      assert.match(String(result.readback_files[0].content || ''), /"value": 42/);
    });
  }
};
