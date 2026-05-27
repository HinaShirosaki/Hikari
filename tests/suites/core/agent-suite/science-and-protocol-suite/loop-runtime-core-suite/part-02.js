module.exports = function registerLoopRuntimeCoreSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('science reasoning loop uses post-tool assistant tool calls before pre-synthesizing', async () => {
      const scriptedTurns = [
        {
          calls: [
            { callId: 'call-1', name: 'literature-search', argsText: JSON.stringify({ query: 'MAPK inhibitor resistance', source: 'pubmed', limit: 3 }) },
            { callId: 'call-2', name: 'literature-search', argsText: JSON.stringify({ query: 'MAPK inhibitor resistance review', source: 'web', limit: 3 }) }
          ],
          text: 'I will gather a focused paper and a broader review in parallel.'
        },
        {
          calls: [
            { callId: 'call-3', name: 'python-sandbox', argsText: JSON.stringify({ code: 'fit_escape_curve()', purpose: 'Check whether the observed trend is robust.' }) }
          ],
          text: 'I have a focused paper and a broader review, so I will run a deterministic fit next.'
        },
        {
          calls: [],
          text: 'The deterministic fit plus the literature context are now satisfying enough to answer.'
        }
      ];
      const evaluationSnapshots = [];
      const feedbackMessages = [];
      const lifecycleEvents = [];
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        startAgentSession: async () => ({ step: 0 }),
        extractAgentSessionFunctionCalls: (session) => scriptedTurns[session.step].calls,
        extractAgentSessionText: (session) => scriptedTurns[session.step].text,
        continueAgentSessionWithToolOutputs: async (session) => ({ step: session.step + 1 }),
        continueAgentSessionWithUserMessage: async (session, feedback) => {
          feedbackMessages.push(String(feedback || ''));
          return { step: session.step + 1 };
        },
        evaluateScienceRound: async ({ roundsExecuted, preSynthesizedAnswer, toolTrace }) => {
          evaluationSnapshots.push({
            roundsExecuted,
            preSynthesizedAnswer,
            toolTrace: structuredClone(toolTrace || [])
          });
          return {
            satisfied: true,
            reason: 'The evidence is sufficient now.',
            missing_requirements: [],
            should_continue: false,
            next_tool_hint: null,
            can_answer_with_limitations: true
          };
        },
        synthesizeScienceFinal: async () => ({
          answer: 'Resistance often involves pathway reactivation and compensatory signaling, and the deterministic fit supports a real trend rather than a single outlier.',
          confidence: 0.78,
          decision_record: {
            assumptions: ['The post-tool assistant call delayed pre-synthesis until the fit was available.'],
            open_questions: [],
            verification_notes: ['Two tool rounds completed before synthesis.']
          },
          follow_up_questions: []
        }),
        recordLifecycleEvent: (_recorder, event) => {
          lifecycleEvents.push(event);
        }
      });

      const result = await runtime.runGeneralScienceQuestion({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'What causes MAPK inhibitor resistance?',
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
        toolDefinitions: [
          {
            name: 'literature-search',
            description: 'literature-search',
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
          },
          {
            name: 'python-sandbox',
            description: 'python-sandbox',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['code'],
              properties: {
                code: { type: 'string' },
                purpose: { type: 'string' }
              }
            }
          }
        ],
        runTool: async (toolName, args) => (
          toolName === 'python-sandbox'
            ? {
              ok: true,
              tool_name: toolName,
              input: args,
              result: {
                items: [{ id: 'fit-1' }],
                citations: [
                  {
                    source: 'python_sandbox',
                    pointer: 'fit-run-1',
                    reason: 'Computed a deterministic fit for the observed resistance trend.'
                  }
                ],
                summary: 'python-sandbox estimated a stable trend.'
              },
              items: [{ id: 'fit-1' }],
              citations: [
                {
                  source: 'python_sandbox',
                  pointer: 'fit-run-1',
                  reason: 'Computed a deterministic fit for the observed resistance trend.'
                }
              ],
              summary: 'python-sandbox estimated a stable trend.'
            }
            : {
              ok: true,
              tool_name: toolName,
              input: args,
              result: {
                items: [{ id: `${toolName}-${args?.source || 'auto'}-1` }],
                citations: [
                  {
                    source: args?.source === 'web' ? 'web_source' : 'pubmed',
                    pointer: `${toolName}-${args?.source || 'auto'}-pointer`,
                    reason: `Retrieved from ${toolName} (${args?.source || 'auto'}).`
                  }
                ],
                loaded_context_blocks: args?.source === 'web'
                  ? []
                  : [
                    {
                      paper_id: 'paper-1',
                      paper_title: 'MAPK resistance mechanisms',
                      section_label: 'Results',
                      excerpt: 'ERK signaling resumed after MAPK inhibitor escape.',
                      relevance_reason: 'Direct evidence from the retrieved paper.',
                      source: 'pubmed_abstract',
                      evidence_kind: 'text'
                    }
                  ],
                summary: `${toolName} completed.`
              },
              items: [{ id: `${toolName}-${args?.source || 'auto'}-1` }],
              citations: [
                {
                  source: args?.source === 'web' ? 'web_source' : 'pubmed',
                  pointer: `${toolName}-${args?.source || 'auto'}-pointer`,
                  reason: `Retrieved from ${toolName} (${args?.source || 'auto'}).`
                }
              ],
              loaded_context_blocks: args?.source === 'web'
                ? []
                : [
                  {
                    paper_id: 'paper-1',
                    paper_title: 'MAPK resistance mechanisms',
                    section_label: 'Results',
                    excerpt: 'ERK signaling resumed after MAPK inhibitor escape.',
                    relevance_reason: 'Direct evidence from the retrieved paper.',
                    source: 'pubmed_abstract',
                    evidence_kind: 'text'
                  }
                ],
              summary: `${toolName} completed.`
            }
        )
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.rounds_executed, 2);
      assert.equal(evaluationSnapshots.length, 1);
      assert.equal(evaluationSnapshots[0].roundsExecuted, 2);
      assert.equal(evaluationSnapshots[0].toolTrace.length, 3);
      assert.equal(
        evaluationSnapshots[0].preSynthesizedAnswer.supporting_basis.some((item) => /Computed a deterministic fit/i.test(String(item))),
        true
      );
      assert.equal(feedbackMessages.length, 0);
      assert.equal(result.intermediate_states.some((state) => state.stage === 'science_tool_round_satisfaction'), true);
      assert.equal(lifecycleEvents.some((event) => event.stage === 'science_tool_round_unsatisfied' && event.meta.round === 1), true);
      assert.equal(
        lifecycleEvents.some((event) => (
          event.stage === 'science_tool_round_unsatisfied'
          && event.meta.round === 1
          && event.meta.pending_tool_names.includes('python-sandbox')
        )),
        true
      );
      assert.equal(lifecycleEvents.some((event) => event.stage === 'science_tool_round_satisfied' && event.meta.round === 2), true);
      assert.match(result.answer, /deterministic fit supports a real trend/i);
    });
    test('science reasoning loop retries the tentative inference when logical verification is unstable', async () => {
      const feedbackMessages = [];
      const evaluatedAnswers = [];
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        startAgentSession: async () => ({ step: 0 }),
        extractAgentSessionFunctionCalls: (session) => (
          session.step === 0
            ? [{
              callId: 'call-1',
              name: 'literature-search',
              argsText: JSON.stringify({ query: 'MAPK inhibitor resistance mechanisms', source: 'pubmed', limit: 3 })
            }]
            : []
        ),
        extractAgentSessionText: (session) => (
          session.step === 0
            ? 'I will retrieve one paper first.'
            : (session.step === 1
              ? 'Pathway reactivation explains the escape.'
              : 'Pathway reactivation is supported, but alternatives still remain possible.')
        ),
        continueAgentSessionWithToolOutputs: async () => ({ step: 1 }),
        continueAgentSessionWithUserMessage: async (session, feedback) => {
          feedbackMessages.push(String(feedback || ''));
          return { step: session.step + 1 };
        },
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
        verifySciencePreSynthesizedAnswerLogic: async ({ latestAssistantText }) => (
          /alternatives still remain possible/i.test(String(latestAssistantText || ''))
            ? {
              part_1: {
                context: 'One focused paper supports a mechanism, but broader review context is still thin.',
                pre_synthesized_answer: 'Pathway reactivation is supported, but alternatives still remain possible.',
                logic_list: [
                  {
                    reasoning_type: 'deductive',
                    logic: 'The focused paper supports pathway reactivation.'
                  },
                  {
                    reasoning_type: 'abductive',
                    logic: 'Pathway reactivation is one plausible explanation.'
                  }
                ]
              },
              part_2: [
                {
                  reasoning_type: 'deductive',
                  logic: 'The focused paper supports pathway reactivation.',
                  stable: true,
                  failed_reason: ''
                },
                {
                  reasoning_type: 'abductive',
                  logic: 'Pathway reactivation is one plausible explanation.',
                  stable: true,
                  failed_reason: ''
                }
              ]
            }
            : {
              part_1: {
                context: 'One focused paper supports a mechanism, but broader review context is still thin.',
                pre_synthesized_answer: 'Pathway reactivation explains the escape.',
                logic_list: [
                  {
                    reasoning_type: 'abductive',
                    logic: 'Pathway reactivation best explains the escape.'
                  }
                ]
              },
              part_2: [
                {
                  reasoning_type: 'abductive',
                  logic: 'Pathway reactivation best explains the escape.',
                  stable: false,
                  failed_reason: 'alternatives unresolved'
                }
              ]
            }
        ),
        evaluateScienceRound: async ({ preSynthesizedAnswer }) => {
          evaluatedAnswers.push(preSynthesizedAnswer);
          return {
            satisfied: true,
            reason: 'The revised inference is stable enough for this harness.',
            missing_requirements: [],
            should_continue: false,
            next_tool_hint: null,
            can_answer_with_limitations: true
          };
        },
        synthesizeScienceFinal: async () => ({
          answer: 'Pathway reactivation is supported, but alternatives still remain possible.',
          confidence: 0.7,
          decision_record: {
            assumptions: [],
            open_questions: [],
            verification_notes: ['Retried the tentative inference after an unstable logic check.']
          },
          follow_up_questions: []
        })
      });

      const result = await runtime.runGeneralScienceQuestion({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'What causes MAPK inhibitor resistance?',
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
            citations: [{ source: 'pubmed', pointer: 'pubmed-1', reason: 'Retrieved one focused mechanism paper.' }],
            summary: 'Literature retrieval completed.'
          },
          items: [{ id: 'pubmed-1' }],
          citations: [{ source: 'pubmed', pointer: 'pubmed-1', reason: 'Retrieved one focused mechanism paper.' }],
          summary: 'Literature retrieval completed.'
        })
      });

      assert.equal(result.status, 'completed');
      assert.equal(feedbackMessages.length, 1);
      assert.match(feedbackMessages[0], /inference checks were unstable/i);
      assert.match(feedbackMessages[0], /alternatives unresolved/i);
      assert.equal(evaluatedAnswers.length, 1);
      assert.equal(evaluatedAnswers[0].tentative_answer.current_best_answer, 'Pathway reactivation is supported, but alternatives still remain possible.');
      assert.equal(evaluatedAnswers[0].logical_verification.part_2.some((row) => row.stable === false), false);
      assert.equal(result.intermediate_states.some((state) => state.stage === 'science_inference_retry'), true);
    });
  }
};