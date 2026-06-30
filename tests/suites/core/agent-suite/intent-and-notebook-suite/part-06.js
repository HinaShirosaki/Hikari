module.exports = function registerAgentIntentAndNotebookSuitePart06(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('intent parser prompt includes recent transcript and active project context', () => {
      const prompt = agentIntentParser.buildIntentParserPrompt({
        message: 'Do we have PEI in stock for Atlas lot 7?',
        conversation: [
          { role: 'user', text: 'Too old and should be dropped.' },
          { role: 'assistant', text: 'First retained assistant note.' },
          { role: 'user', text: 'We are in the Cancer Study workspace.' },
          { role: 'assistant', text: 'Last week we checked Tris.' },
          { role: 'user', text: 'Need the latest PEI stock and location.' },
          { role: 'assistant', text: 'I can look at recent inventory.' },
          { role: 'user', text: 'Focus on Atlas lot 7.' },
          { role: 'assistant', text: 'I will use the current project context.' },
          { role: 'user', text: 'Please include whether it is reserved.' }
        ],
        projectName: 'Cancer Study'
      });
      assert.equal(prompt.includes('Active project context: Cancer Study'), true);
      assert.equal(prompt.includes('Recent conversation:'), true);
      assert.equal(prompt.includes('1. assistant: First retained assistant note.'), true);
      assert.equal(prompt.includes('8. user: Please include whether it is reserved.'), true);
      assert.equal(prompt.includes('Too old and should be dropped.'), false);
      assert.equal(prompt.includes('User message:\nDo we have PEI in stock for Atlas lot 7?'), true);
    });
    test('intent parser catalog stays in sync with allowed intents and rendered prompt', () => {
      const catalog = agentIntentParser.INTENT_PARSER_CATALOG;
      assert.deepEqual(catalog.map((entry) => entry.name), agentIntentParser.PARSER_ALLOWED_INTENTS);
      assert.equal(typeof catalog[0].rules, 'string');
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Allowed intents:/);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Science reasoning_effort: 0=stable direct answer/);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /If unsure, choose 1\./);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Intent guide:/);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /"primary_intent": "one allowed intent"/);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Add only the extra fields listed for the chosen intent\./);
      assert.equal(/## Examples/.test(agentIntentParser.INTENT_PARSER_PROMPT), false);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Omit all other keys and empty placeholders\./);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /Standalone instructional wet-lab protocol requests/i);
      assert.match(agentIntentParser.INTENT_PARSER_PROMPT, /how to express X/i);

      let previousHeadingIndex = -1;
      agentIntentParser.PARSER_ALLOWED_INTENTS.forEach((intentName) => {
        const heading = `- ${intentName}:`;
        const headingIndex = agentIntentParser.INTENT_PARSER_PROMPT.indexOf(heading);
        assert.notEqual(headingIndex, -1);
        assert.equal(headingIndex > previousHeadingIndex, true);
        previousHeadingIndex = headingIndex;
      });

      const customCatalog = catalog.map((entry) => ({
        ...entry,
        specific_output_append: Array.isArray(entry.specific_output_append)
          ? entry.specific_output_append.map((row) => ({ ...row }))
          : []
      }));
      const inventoryEntry = customCatalog.find((entry) => entry.name === 'inventory_lookup');
      inventoryEntry.description = 'Custom inventory description.';
      inventoryEntry.rules = 'Custom inventory rule.';
      inventoryEntry.example_input = 'Where is the custom PEI bottle?';
      inventoryEntry.specific_output_append = [
        {
          key: 'custom_inventory_field',
          description: 'Custom inventory append description.'
        }
      ];
      const renderedPrompt = agentIntentParser.buildIntentCatalogPrompt(customCatalog);
      assert.equal(renderedPrompt.includes('- inventory_lookup:'), true);
      assert.equal(renderedPrompt.includes('Custom inventory description.'), true);
      assert.equal(renderedPrompt.includes('Custom inventory rule.'), true);
      assert.equal(renderedPrompt.includes('Extras: custom_inventory_field.'), true);
      assert.equal(renderedPrompt.includes('Custom inventory append description.'), false);
      assert.equal(renderedPrompt.includes('User: "Where is the custom PEI bottle?"'), false);
    });
    test('intent parser catalog validation rejects malformed entries', () => {
      const catalogPath = path.join(__dirname, 'self-agent', 'intent', 'agent-intent.json');
      const invalidCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      delete invalidCatalog.inventory_lookup.specific_output_append;
      assert.throws(
        () => agentIntentParser.validateIntentCatalog(invalidCatalog),
        /specific_output_append/
      );
    });
    test('protocol matching runtime selects exact match deterministically', async () => {
      const runtime = agentProtocolMatching.createProtocolMatchingRuntime();
      const selection = await runtime.selectProtocol({
        protocols: [
          {
            id: 'prot-1',
            name: 'HEK293 Transfection',
            purpose: 'Transfect HEK293 cells.',
            aliases: ['293 transfection'],
            steps: [
              { id: 'step-1', text: 'Seed HEK293 cells.' },
              { id: 'step-2', text: 'Add transfection reagent.' }
            ]
          },
          {
            id: 'prot-2',
            name: 'Protein Purification',
            purpose: 'Purify His-tagged protein.',
            steps: [
              { id: 'step-1', text: 'Bind lysate to resin.' }
            ]
          }
        ],
        protocolCandidates: ['HEK293 Transfection'],
        message: 'I did the HEK293 transfection today.',
        conversation: [],
        parserPayload: {
          entities: {
            activity_type: 'transfection',
            workflow_step: null,
            protocol_name: 'HEK293 Transfection'
          }
        }
      });
      assert.equal(selection.selection_method, 'deterministic');
      assert.equal(selection.selected_protocol.name, 'HEK293 Transfection');
      assert.equal(selection.ranked_matches.length >= 1, true);
      assert.equal(selection.ranked_matches[0].score > 0, true);
    });
    test('protocol matching runtime falls back to highest rank when llm tie-break output is invalid', async () => {
      const runtime = agentProtocolMatching.createProtocolMatchingRuntime({
        requestStructuredJsonPayload: async () => ({
          ok: false,
          error: 'not json'
        })
      });
      const result = await runtime.resolveProtocolWinner({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        matches: [
          { id: 'prot-1', name: 'Protocol A', purpose: 'first', steps: [], score: 57 },
          { id: 'prot-2', name: 'Protocol B', purpose: 'second', steps: [], score: 56 }
        ],
        message: 'Use the closer match.',
        conversation: [],
        parserPayload: { entities: {} }
      });
      assert.equal(result.selection_method, 'deterministic_fallback');
      assert.equal(result.selected.name, 'Protocol A');
    });
    test('protocol notebook context control closes completed action context', () => {
      const { createProtocolNotebookContextControl } = require(path.join(
        __dirname,
        'self-agent',
        'runtime',
        'agent-protocol-notebook-context-control.js'
      ));
      let nowMs = Date.parse('2026-04-10T12:00:00.000Z');
      const cleanText = (value, _maxLength = 2000) => {
        const text = String(value || '').trim();
        return text || '';
      };
      const control = createProtocolNotebookContextControl({
        cleanText,
        now: () => new Date(nowMs).toISOString(),
        nowMs: () => nowMs,
        store: new Map()
      });
      const sessionKey = control.buildSessionKey({
        projectId: 'proj-1',
        projectName: 'Atlas'
      });

      control.setPendingSession(sessionKey, {
        created_at: '2026-04-10T11:55:00.000Z',
        selected_protocol: {
          id: 'prot-1',
          name: 'Cell Prep'
        },
        follow_up_questions: ['Please provide sample name.']
      });
      assert.equal(control.hasPendingSession(sessionKey), true);

      const syncResult = control.syncActionContext(sessionKey, {
        status: 'completed'
      });
      assert.equal(syncResult.context_closed, true);
      assert.equal(control.hasPendingSession(sessionKey), false);
    });
    test('protocol notebook runtime closes pending context after completed action', async () => {
      const { createProtocolNotebookRuntime } = require(path.join(
        __dirname,
        'self-agent',
        'runtime',
        'agent-protocol-notebook.js'
      ));
      const cleanText = (value, _maxLength = 2000) => {
        const text = String(value || '').trim();
        return text || '';
      };
      const asArray = (value) => (Array.isArray(value) ? value : []);
      const uniqueStrings = (values, max = 50) => {
        const seen = new Set();
        const out = [];
        asArray(values).forEach((value) => {
          const normalized = cleanText(value, 220);
          if (!normalized) {
            return;
          }
          const key = normalized.toLowerCase();
          if (seen.has(key) || out.length >= max) {
            return;
          }
          seen.add(key);
          out.push(normalized);
        });
        return out;
      };
      let nowMs = Date.parse('2026-04-10T12:00:00.000Z');
      const runtime = createProtocolNotebookRuntime({
        asArray,
        cleanText,
        uniqueStrings,
        pickTopMatches: (items, _selector, _query, count = 1) => asArray(items).slice(0, count),
        now: () => new Date(nowMs).toISOString(),
        nowMs: () => nowMs,
        protocolNotebookPendingSessions: new Map(),
        getAgentRuntimeFactory: (runtimeName) => {
          if (runtimeName === 'protocol-matching') {
            return () => ({
              normalizeProtocolRecord(protocol = {}, index = 0) {
                return {
                  id: String(protocol.id || `protocol-${index + 1}`),
                  name: String(protocol.name || ''),
                  project_name: String(protocol.project_name || protocol.projectName || ''),
                  steps: Array.isArray(protocol.steps) ? protocol.steps : []
                };
              },
              async selectProtocol({ protocols = [] } = {}) {
                const selected = Array.isArray(protocols) ? protocols[0] : null;
                return {
                  selected_protocol: selected,
                  selection_method: 'deterministic',
                  rationale: 'Selected the only available protocol.',
                  ranked_matches: selected
                    ? [{ id: selected.id, name: selected.name, score: 120 }]
                    : []
                };
              },
              mapCandidateMatchesForOutput(matches = []) {
                return asArray(matches).map((match) => ({
                  id: cleanText(match.id, 120),
                  name: cleanText(match.name, 220),
                  score: Number.isFinite(Number(match.score)) ? Number(match.score) : 0
                }));
              }
            });
          }
          if (runtimeName === 'notebook-generation') {
            return () => ({
              async generateNotebook({ selectedProtocol, project } = {}) {
                return {
                  status: 'completed',
                  notebook: {
                    protocol: {
                      id: selectedProtocol?.id || '',
                      name: selectedProtocol?.name || ''
                    },
                    project: {
                      id: project?.id || '',
                      name: project?.name || ''
                    },
                    rendered_steps: ['Prepare Atlas-7 sample.'],
                    save: {
                      status: 'ready_for_save'
                    },
                    entry_template: {
                      result: 'Notebook draft completed for Cell Prep.'
                    }
                  },
                  known_values: {
                    sample_name: 'Atlas-7'
                  },
                  missing_placeholders: [],
                  follow_up_questions: []
                };
              }
            });
          }
          return null;
        }
      });
      const sessionKey = runtime.buildSessionKey({
        projectId: 'proj-1',
        projectName: 'Atlas'
      });
      runtime.setPendingSession(sessionKey, {
        created_at: '2026-04-10T11:55:00.000Z',
        selected_protocol: {
          id: 'prot-1',
          name: 'Cell Prep'
        },
        project: {
          id: 'proj-1',
          name: 'Atlas',
          resolution_source: 'payload_project_id'
        },
        follow_up_questions: ['Please provide sample name.']
      });
      assert.equal(runtime.hasPendingSession(sessionKey), true);

      const result = await runtime.runFlow({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key',
        model: 'gpt-5',
        message: 'The sample name was Atlas-7.',
        conversation: [],
        snapshot: {
          projects: [
            { id: 'proj-1', name: 'Atlas' }
          ],
          protocols: [
            {
              id: 'prot-1',
              name: 'Cell Prep',
              project_name: 'Atlas',
              steps: []
            }
          ]
        },
        parserPayload: {
          primary_intent: 'protocol_to_notebook',
          entities: {
            project_name: 'Atlas',
            protocol_name: 'Cell Prep'
          },
          protocol_candidates: ['Cell Prep']
        },
        projectId: 'proj-1',
        projectName: 'Atlas'
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.selected_protocol.name, 'Cell Prep');
      assert.equal(runtime.hasPendingSession(sessionKey), false);
    });
  }
};