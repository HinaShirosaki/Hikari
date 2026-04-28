module.exports = function registerLoopRuntimeCoreSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('science reasoning loop runs parallel tool rounds and pre-synthesizes after the full batch returns', async () => {
      const scriptedTurns = [
        {
          calls: [
            { callId: 'call-1', name: 'literature-search', argsText: JSON.stringify({ query: 'MAPK inhibitor resistance', source: 'pubmed', limit: 3 }) },
            { callId: 'call-2', name: 'literature-search', argsText: JSON.stringify({ query: 'MAPK inhibitor resistance review', source: 'web', limit: 3 }) }
          ],
          text: 'I will gather a focused paper and a broader review in parallel.'
        },
        {
          calls: [],
          text: 'I now have a focused paper and a broader review, but I still need a deterministic fit.'
        },
        {
          calls: [
            { callId: 'call-3', name: 'python-sandbox', argsText: JSON.stringify({ code: 'fit_escape_curve()', purpose: 'Check whether the observed trend is robust.' }) }
          ],
          text: 'I will run a deterministic fit next.'
        },
        {
          calls: [],
          text: 'The combined literature context and deterministic fit are enough to answer.'
        }
      ];
      const feedbackMessages = [];
      const lifecycleEvents = [];
      const evaluationSnapshots = [];
      const toolOutputBatches = [];
      let synthesisLoadedContext = [];
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        startAgentSession: async ({ toolDefinitions }) => {
          const toolNames = toolDefinitions.map((tool) => tool.name);
          assert.equal(toolNames.includes('literature-search'), true);
          assert.equal(toolNames.includes('python-sandbox'), true);
          return { step: 0 };
        },
        extractAgentSessionFunctionCalls: (session) => scriptedTurns[session.step].calls,
        extractAgentSessionText: (session) => scriptedTurns[session.step].text,
        continueAgentSessionWithToolOutputs: async (session, outputs) => {
          toolOutputBatches.push(outputs.map((entry) => ({
            name: entry.name,
            output: JSON.parse(entry.output)
          })));
          return { step: session.step + 1 };
        },
        continueAgentSessionWithUserMessage: async (session, feedback) => {
          feedbackMessages.push(String(feedback || ''));
          return { step: session.step + 1 };
        },
        askMainAgentToolRoundSatisfaction: async () => ({
          satisfied: true,
          reason: 'The current tool round is ready for pre-synthesis.'
        }),
        evaluateScienceRound: async ({ roundsExecuted, preSynthesizedAnswer, toolTrace }) => {
          evaluationSnapshots.push({
            roundsExecuted,
            preSynthesizedAnswer,
            toolTrace: structuredClone(toolTrace || [])
          });
          if (roundsExecuted === 1) {
            assert.equal(toolOutputBatches.length, 1);
            assert.equal(toolOutputBatches[0].length, 2);
            assert.equal(toolTrace.length, 2);
            assert.equal(toolTrace.every((row) => row.round === 1), true);
            assert.equal(toolTrace.every((row) => row.multi_tool_round === true), true);
            assert.equal(toolTrace.every((row) => row.tool_count_in_round === 2), true);
            assert.match(preSynthesizedAnswer.tentative_answer.current_best_answer, /focused paper and a broader review/i);
            assert.equal(preSynthesizedAnswer.supporting_basis.some((item) => /Retrieved from literature-search \(pubmed\)/i.test(String(item))), true);
            assert.equal(preSynthesizedAnswer.supporting_basis.some((item) => /Retrieved from literature-search \(web\)/i.test(String(item))), true);
            return {
              satisfied: false,
              reason: 'Need one deterministic fit before answering.',
              missing_requirements: ['A deterministic fit is still needed.'],
              should_continue: true,
              next_tool_hint: {
                tool_name: 'python-sandbox',
                query: null,
                reason: 'Check whether the observed trend remains robust.'
              },
              can_answer_with_limitations: true
            };
          }
          return {
            satisfied: true,
            reason: 'Evidence is sufficient now.',
            missing_requirements: [],
            should_continue: false,
            next_tool_hint: null,
            can_answer_with_limitations: true
          };
        },
        synthesizeScienceFinal: async ({ toolTrace }) => {
          synthesisLoadedContext = (toolTrace || []).flatMap((row) => row?.loaded_context_blocks || []);
          return {
            answer: 'Resistance often involves pathway reactivation and compensatory signaling, and the deterministic fit supports a real trend rather than a single outlier.',
            confidence: 0.77,
            decision_record: {
              assumptions: ['Only the collected literature and computation outputs were used.'],
              open_questions: [],
              verification_notes: ['One parallel literature round and one computation round completed.']
            },
            follow_up_questions: []
          };
        },
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
      assert.equal(result.tool_trace.length, 3);
      assert.equal(result.tool_trace[0].tool_name, 'literature-search');
      assert.equal(result.tool_trace[0].input.source, 'pubmed');
      assert.equal(result.tool_trace[0].loaded_context_blocks.length, 1);
      assert.equal(result.tool_trace[0].multi_tool_round, true);
      assert.equal(result.tool_trace[0].truncated_multi_call, false);
      assert.equal(result.tool_trace[1].tool_name, 'literature-search');
      assert.equal(result.tool_trace[1].input.source, 'web');
      assert.equal(result.tool_trace[1].multi_tool_round, true);
      assert.equal(result.tool_trace[2].tool_name, 'python-sandbox');
      assert.equal(result.tool_trace[2].round, 2);
      assert.equal(toolOutputBatches.length, 2);
      assert.equal(toolOutputBatches[0].length, 2);
      assert.deepEqual(toolOutputBatches[0].map((entry) => entry.name), ['literature-search', 'literature-search']);
      assert.equal(toolOutputBatches[1].length, 1);
      assert.deepEqual(toolOutputBatches[1].map((entry) => entry.name), ['python-sandbox']);
      assert.equal(evaluationSnapshots.length, 2);
      assert.equal(evaluationSnapshots[0].toolTrace.length, 2);
      assert.match(evaluationSnapshots[0].preSynthesizedAnswer.tentative_answer.current_best_answer, /focused paper and a broader review/i);
      assert.equal(evaluationSnapshots[0].preSynthesizedAnswer.supporting_basis.some((item) => /ERK signaling resumed after MAPK inhibitor escape/i.test(String(item))), true);
      assert.equal(synthesisLoadedContext.some((block) => /ERK signaling resumed/i.test(String(block?.excerpt || ''))), true);
      assert.equal(result.intermediate_states.some((state) => state.stage === 'science_pre_synthesis'), true);
      assert.equal(feedbackMessages.length, 1);
      assert.match(feedbackMessages[0], /Need one deterministic fit before answering/i);
      assert.match(result.answer, /deterministic fit supports a real trend/i);
      assert.equal(
        lifecycleEvents.some((event) => event.stage === 'science_round_started' && event.meta.round === 1 && event.meta.multi_tool_round === true && event.meta.tool_count === 2),
        true
      );
      assert.equal(lifecycleEvents.some((event) => event.stage === 'science_evaluator_continue' && event.meta.round === 1), true);
      assert.equal(lifecycleEvents.some((event) => event.stage === 'science_evaluator_satisfied' && event.meta.round === 2), true);
      assert.equal(
        lifecycleEvents.some((event) => event.stage === 'science_clarification_completed' && /execution-ready science question/i.test(String(event?.meta?.thinking_trace || ''))),
        true
      );
      assert.equal(
        lifecycleEvents.some((event) => event.stage === 'science_route_planner_completed' && /lightweight route/i.test(String(event?.meta?.thinking_trace || ''))),
        true
      );
      assert.equal(
        lifecycleEvents.some((event) => event.stage === 'science_round_started' && /in parallel/i.test(String(event?.meta?.thinking_trace || ''))),
        true
      );
      assert.equal(
        lifecycleEvents.some((event) => event.stage === 'science_intent_completed' && /synthesizing the final grounded answer/i.test(String(event?.meta?.thinking_trace || ''))),
        true
      );
    });

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
