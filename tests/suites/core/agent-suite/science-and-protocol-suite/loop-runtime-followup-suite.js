module.exports = function registerLoopRuntimeFollowupSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('science reasoning loop answers reasoning-effort 0 science questions directly without entering the loop', async () => {
      let capturedToolDefinitions = null;
      let capturedSystemPrompt = '';
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        draftScienceRoutePlan: async () => {
          throw new Error('Reasoning-effort 0 should skip route planning.');
        },
        clarifyScienceInput: async () => {
          throw new Error('Reasoning-effort 0 should skip clarification.');
        },
        generateScienceLoopExitCriteria: async () => {
          throw new Error('Reasoning-effort 0 should skip exit criteria.');
        },
        startAgentSession: async ({ toolDefinitions, systemPrompt }) => {
          capturedToolDefinitions = toolDefinitions;
          capturedSystemPrompt = String(systemPrompt || '');
          return { step: 0 };
        },
        extractAgentSessionText: () => 'Imidazole competes with histidines for nickel coordination sites, which displaces His-tagged protein during elution.'
      });

      const result = await runtime.runGeneralScienceQuestion({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'Why does imidazole elute His-tagged proteins?',
        conversation: [],
        parserPayload: {
          primary_intent: 'general_science_question',
          reasoning_effort: 0,
          needs_clarification: false,
          clarification_reason: null,
          entities: {}
        },
        routing: {
          intent: 'general_science_question',
          confidence: 0.64,
          entities: {},
          plan: {},
          classifier: {}
        },
        baseSystemPrompt: 'Base science prompt.'
      });

      assert.deepEqual(capturedToolDefinitions, []);
      assert.match(capturedSystemPrompt, /direct answer only/i);
      assert.doesNotMatch(capturedSystemPrompt, /Intent:/);
      assert.equal(result.status, 'completed');
      assert.equal(result.rounds_executed, 0);
      assert.equal(result.reasoning_effort, 0);
      assert.equal(result.citations.length, 0);
      assert.match(result.answer, /nickel coordination/i);
      assert.equal(result.thinking_trace.tool_rounds.length, 0);
      assert.equal(result.final_synthesized_question, 'Why does imidazole elute His-tagged proteins?');
    });

    test('science reasoning loop clarifies the request before the first tool round and forwards the clarified input', async () => {
      const clarificationStages = [];
      let capturedSessionMessage = '';
      let capturedSystemPrompt = '';
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        requestStructuredJsonPayload: async ({ stage }) => {
          clarificationStages.push(String(stage || ''));
          if (stage === 'science_input_clarification') {
            return {
              ok: true,
              payload: {
                clarified_input: 'Explain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty.',
                analysis_goal: 'Answer the resistance question using grounded literature evidence.',
                important_constraints: ['Use literature before generic web search.'],
                missing_information: [],
                should_ask_follow_up: false,
                follow_up_question: '',
                follow_up_reason: 'The request is clear enough to continue.'
              }
            };
          }
          if (stage === 'science_route_planner') {
            return {
              ok: true,
              payload: {
                goal: 'Explain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty.',
                route_summary: 'Use one focused literature pass first, then refine only if the first evidence step is too narrow.',
                step_sequence: [
                  {
                    step_label: 'focused-literature',
                    objective: 'Start with a targeted literature search for direct resistance mechanisms.',
                    suggested_tools: ['literature-search'],
                    reason: 'The highest-yield first step is a focused literature pass.'
                  },
                  {
                    step_label: 'synthesize',
                    objective: 'Answer once one grounded literature step is sufficient.',
                    suggested_tools: [],
                    reason: 'Do not keep searching once the clarified request is already supported.'
                  }
                ],
                tool_call_suggestions: [
                  {
                    tool_name: 'literature-search',
                    priority: 1,
                    when_to_use: 'Use first.',
                    reason: 'Prefer literature before broader web retrieval.',
                    query_hint: 'MAPK inhibitor resistance mechanisms'
                  }
                ],
                decision_points: ['Refine the query if the first literature pass is too broad or too sparse.'],
                adaptation_notes: ['Treat the route as guidance only.'],
                reference_only: true
              }
            };
          }
          if (stage === 'science_loop_exit_criteria') {
            return {
              ok: true,
              payload: {
                objective_summary: 'Explain MAPK inhibitor resistance with grounded evidence and stop once one targeted literature pass is enough.',
                exit_conditions: ['At least one relevant literature source supports the answer.'],
                required_evidence: ['One literature-backed retrieval step is required.'],
                continue_when: ['No literature-backed source has been collected yet.'],
                can_exit_with_limitations_when: ['Minor uncertainty can remain if stated explicitly.'],
                preferred_next_tools: ['literature-search'],
                reasoning_notes: 'Prefer literature before broader web retrieval.',
                trace_sentence: 'I am defining what evidence would be enough to stop after one targeted literature pass.'
              }
            };
          }
          return {
            ok: false,
            error: `Unexpected structured-json stage: ${stage}`
          };
        },
        startAgentSession: async ({ message, systemPrompt }) => {
          capturedSessionMessage = String(message || '');
          capturedSystemPrompt = String(systemPrompt || '');
          return { step: 0 };
        },
        extractAgentSessionFunctionCalls: (session) => (
          session.step === 0
            ? [{ callId: 'call-1', name: 'literature-search', argsText: JSON.stringify({ query: 'MAPK inhibitor resistance', source: 'pubmed', limit: 3 }) }]
            : []
        ),
        extractAgentSessionText: (session) => (
          session.step === 0
            ? 'I will start with PubMed.'
            : 'I have enough evidence now.'
        ),
        continueAgentSessionWithToolOutputs: async () => ({ step: 1 }),
        continueAgentSessionWithUserMessage: async (session) => session,
        askMainAgentToolRoundSatisfaction: async () => ({
          satisfied: true,
          reason: 'The current tool round is ready for pre-synthesis.'
        }),
        resolveToolDefinitions: (selectedToolNames) => selectedToolNames.map((name) => ({
          name,
          description: name,
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['query'],
            properties: {
              query: { type: 'string' },
              source: { type: 'string' },
              limit: { type: 'integer' }
            }
          }
        })),
        evaluateScienceRound: async () => ({
          satisfied: true,
          reason: 'One literature retrieval round is sufficient for this harness.',
          missing_requirements: [],
          should_continue: false,
          next_tool_hint: null,
          can_answer_with_limitations: true
        }),
        synthesizeScienceFinal: async () => ({
          answer: 'MAPK inhibitor resistance often involves pathway reactivation and compensatory signaling.',
          confidence: 0.71,
          decision_record: {
            assumptions: [],
            open_questions: [],
            verification_notes: ['Used the clarified request before retrieval.']
          },
          follow_up_questions: []
        })
      });

      const result = await runtime.runGeneralScienceQuestion({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'Why do tumors stop responding to MAPK inhibitors?',
        conversation: [],
        parserPayload: {
          primary_intent: 'general_science_question',
          needs_clarification: false,
          clarification_reason: null,
          entities: {}
        },
        routing: {
          intent: 'general_science_question',
          confidence: 0.64,
          entities: {},
          plan: {},
          classifier: {}
        },
        runTool: async () => ({
          ok: true,
          tool_name: 'literature-search',
          input: { query: 'MAPK inhibitor resistance', source: 'pubmed', limit: 3 },
          result: {
            items: [{ id: 'pubmed-1' }],
            citations: [{ source: 'pubmed', pointer: 'pubmed-1', reason: 'Retrieved one literature hit.' }],
            summary: 'PubMed retrieval completed.'
          },
          items: [{ id: 'pubmed-1' }],
          citations: [{ source: 'pubmed', pointer: 'pubmed-1', reason: 'Retrieved one literature hit.' }],
          summary: 'PubMed retrieval completed.'
        })
      });

      assert.equal(result.status, 'completed');
      assert.deepEqual(
        clarificationStages,
        [
          'science_input_clarification',
          'science_route_planner',
          'science_loop_exit_criteria',
          'science_loop_logic_extraction'
        ]
      );
      assert.equal(capturedSessionMessage, 'Explain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty.');
      assert.match(capturedSystemPrompt, /Execution hints:/);
      assert.match(capturedSystemPrompt, /Preferred tools:/);
      assert.match(capturedSystemPrompt, /The clarified execution request is provided separately as the session message\./);
      assert.doesNotMatch(capturedSystemPrompt, /Intent:/);
      assert.doesNotMatch(capturedSystemPrompt, /Science policy:/);
      assert.doesNotMatch(capturedSystemPrompt, /Reference route plan:/);
      assert.doesNotMatch(capturedSystemPrompt, /Exit criteria:/);
      assert.doesNotMatch(capturedSystemPrompt, /Request for execution:/);
      assert.doesNotMatch(capturedSystemPrompt, /Routing JSON:/);
      assert.doesNotMatch(capturedSystemPrompt, /Clarification JSON:/);
      assert.match(capturedSystemPrompt, /guidance only/i);
      assert.equal(result.rounds_executed, 1);
      assert.equal(result.route_plan.reference_only, true);
      assert.equal(result.route_plan.tool_call_suggestions[0].tool_name, 'literature-search');
      assert.equal(result.intermediate_states.some((state) => state.stage === 'science_route_plan'), true);
      assert.equal(result.tool_trace[0].tool_name, 'literature-search');
      assert.equal(result.tool_trace[0].input.source, 'pubmed');
      assert.equal(result.thinking_trace.tool_rounds.length, 1);
      assert.equal(result.final_synthesized_question, 'Explain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty.');
    });

    test('science reasoning loop uses canonical literature-search definitions for simple buffer questions', async () => {
      let capturedToolNames = [];
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        startAgentSession: async ({ toolDefinitions }) => {
          capturedToolNames = toolDefinitions.map((tool) => tool.name);
          return { step: 0 };
        },
        extractAgentSessionFunctionCalls: (session) => (
          session.step === 0
            ? [{
              callId: 'call-1',
              name: 'literature-search',
              argsText: JSON.stringify({
                query: 'phosphate-buffered saline PBS 10x preparation recipe methods',
                source: 'pubmed',
                limit: 3
              })
            }]
            : []
        ),
        extractAgentSessionText: (session) => (
          session.step === 0
            ? 'I will gather one literature-backed preparation reference first.'
            : 'I now have enough evidence to answer.'
        ),
        continueAgentSessionWithToolOutputs: async () => ({ step: 1 }),
        continueAgentSessionWithUserMessage: async (session) => session,
        askMainAgentToolRoundSatisfaction: async () => ({
          satisfied: true,
          reason: 'The current tool round is ready for pre-synthesis.'
        }),
        resolveToolDefinitions: (selectedToolNames) => selectedToolNames.map((name) => ({
          name,
          description: name,
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['query'],
            properties: {
              query: { type: 'string' },
              source: { type: 'string' },
              limit: { type: 'integer' }
            }
          }
        })),
        evaluateScienceRound: async () => ({
          satisfied: true,
          reason: 'One grounded literature retrieval round is sufficient for this harness.',
          missing_requirements: [],
          should_continue: false,
          next_tool_hint: null,
          can_answer_with_limitations: true
        }),
        synthesizeScienceFinal: async () => ({
          answer: 'A standard 10x PBS stock can be prepared from sodium chloride, potassium chloride, sodium phosphate, and potassium phosphate, then diluted to 1x for use.',
          confidence: 0.72,
          decision_record: {
            assumptions: [],
            open_questions: [],
            verification_notes: ['Used one canonical literature-search round.']
          },
          follow_up_questions: []
        })
      });

      const result = await runtime.runGeneralScienceQuestion({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'How to make 10x PBS buffer',
        conversation: [],
        parserPayload: {
          primary_intent: 'general_science_question',
          needs_clarification: false,
          clarification_reason: null,
          entities: {}
        },
        routing: {
          intent: 'general_science_question',
          confidence: 0.64,
          entities: {},
          plan: {},
          classifier: {}
        },
        runTool: async (toolName, args) => ({
          ok: true,
          tool_name: toolName,
          input: args,
          result: {
            items: [{ id: 'pubmed-1' }],
            citations: [{ source: 'pubmed', pointer: 'pubmed-1', reason: 'Retrieved one preparation reference.' }],
            summary: 'Literature retrieval completed.'
          },
          items: [{ id: 'pubmed-1' }],
          citations: [{ source: 'pubmed', pointer: 'pubmed-1', reason: 'Retrieved one preparation reference.' }],
          summary: 'Literature retrieval completed.'
        })
      });

      assert.equal(capturedToolNames.includes('literature-search'), true);
      assert.equal(result.status, 'completed');
      assert.equal(result.rounds_executed, 1);
      assert.equal(result.tool_trace[0].tool_name, 'literature-search');
      assert.equal(result.tool_trace[0].input.source, 'pubmed');
      assert.equal(result.citations[0].source, 'pubmed');
      assert.match(result.answer, /10x PBS stock/i);
    });
  }
};
