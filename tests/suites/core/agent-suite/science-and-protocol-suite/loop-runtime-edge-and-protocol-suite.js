module.exports = function registerLoopRuntimeEdgeAndProtocolSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('science reasoning loop returns partial answer when the tool budget is exhausted', async () => {
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        requestStructuredJsonPayload: async () => ({
          ok: false,
          error: 'LLM disabled for deterministic fallback testing.'
        }),
        startAgentSession: async () => ({ step: 0 }),
        extractAgentSessionFunctionCalls: (session) => (
          session.step === 0
            ? [{ callId: 'call-1', name: 'python-sandbox', argsText: JSON.stringify({ code: 'print(1)' }) }]
            : []
        ),
        extractAgentSessionText: (session) => (
          session.step === 0
            ? 'I started a computation.'
            : 'Computation completed, but I still need historical context for the outliers.'
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
            required: ['code'],
            properties: {
              code: { type: 'string' }
            }
          }
        })),
        evaluateScienceRound: async () => ({
          satisfied: false,
          reason: 'The computation finished, but interpretation is still incomplete.',
          missing_requirements: ['A clearer interpretation is still needed.'],
          should_continue: true,
          next_tool_hint: {
            tool_name: 'record-lookup',
            query: 'previous similar assay',
            reason: 'Need contextual interpretation.'
          },
          can_answer_with_limitations: true
        })
      });

      const result = await runtime.runResultAnalysis({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'Fit this assay and explain any outliers.',
        conversation: [],
        parserPayload: {
          primary_intent: 'result_analysis',
          needs_clarification: false,
          clarification_reason: null,
          entities: {}
        },
        routing: {
          intent: 'result_analysis',
          confidence: 0.64,
          entities: {},
          plan: {},
          classifier: {}
        },
        maxRounds: 1,
        runTool: async () => ({
          ok: true,
          tool_name: 'python-sandbox',
          input: { code: 'print(1)' },
          result: {
            items: [{ run_id: 'py-1', status: 'ok' }],
            citations: [{ source: 'python-sandbox', pointer: 'py-1', reason: 'Computation completed.' }],
            summary: 'Python sandbox execution completed.'
          },
          items: [{ run_id: 'py-1', status: 'ok' }],
          citations: [{ source: 'python-sandbox', pointer: 'py-1', reason: 'Computation completed.' }],
          summary: 'Python sandbox execution completed.'
        })
      });

      assert.equal(result.status, 'partial');
      assert.equal(result.rounds_executed, 1);
      assert.match(result.answer, /Computation completed, but I still need historical context for the outliers\./);
      assert.match(result.answer, /Remaining gaps: A clearer interpretation is still needed\./);
      assert.match(result.answer, /Latest tool summary: Python sandbox execution completed\./);
      assert.equal(result.citations.length, 1);
      assert.equal(result.citations[0].source, 'python-sandbox');
      assert.equal(result.follow_up_questions.some((question) => /A clearer interpretation is still needed/.test(question)), true);
    });

    test('science reasoning loop turns invalid tool arguments into a failed tool result', async () => {
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        startAgentSession: async () => ({ step: 0 }),
        extractAgentSessionFunctionCalls: () => [
          { callId: 'call-1', name: 'literature-search', argsText: JSON.stringify({ limit: 'five' }) }
        ],
        extractAgentSessionText: () => 'Trying PubMed.',
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
              limit: { type: 'integer' }
            }
          }
        })),
        evaluateScienceRound: async () => ({
          satisfied: false,
          reason: 'The tool call itself failed schema validation.',
          missing_requirements: ['A valid literature query is still required.'],
          should_continue: false,
          next_tool_hint: null,
          can_answer_with_limitations: true
        }),
        synthesizeScienceFinal: async ({ partial }) => ({
          answer: partial ? 'Partial answer after tool-validation failure.' : 'Complete answer.',
          confidence: 0.41,
          decision_record: {
            assumptions: ['The tool request failed validation before execution.'],
            open_questions: ['A valid literature query is still required.'],
            verification_notes: ['Returned a best-effort answer without executing the invalid tool call.']
          },
          follow_up_questions: ['What specific literature query should I use?']
        })
      });

      const result = await runtime.runGeneralScienceQuestion({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'Find recent papers on CRISPR base editing.',
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
        maxRounds: 1,
        runTool: async () => {
          throw new Error('This executor should not run when args are invalid.');
        }
      });

      assert.equal(result.status, 'partial');
      assert.equal(result.tool_trace.length, 1);
      assert.equal(result.tool_trace[0].ok, false);
      assert.match(String(result.tool_trace[0].summary || ''), /required|type integer/i);
    });

    test('science reasoning loop uses the llm-authored follow-up question when project scope is still missing', async () => {
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        requestStructuredJsonPayload: async ({ stage }) => {
          if (stage === 'science_input_clarification') {
            return {
              ok: true,
              payload: {
                clarified_input: 'Explain why expression dropped in the unresolved project context.',
                analysis_goal: 'Resolve the project scope before analyzing the expression change.',
                important_constraints: ['Need a single resolved project.'],
                missing_information: ['project scope'],
                should_ask_follow_up: true,
                follow_up_question: 'Which project should I analyze for the expression drop?',
                follow_up_reason: 'The request refers to a project, but no single project is resolved yet.'
              }
            };
          }
          return {
            ok: false,
            error: `Unexpected structured-json stage: ${stage}`
          };
        },
        startAgentSession: async () => {
          throw new Error('Session should not start when project preflight fails.');
        }
      });

      const result = await runtime.runProjectScienceQuestion({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'Why did expression drop in this project?',
        conversation: [],
        parserPayload: {
          primary_intent: 'project_science_question',
          needs_clarification: false,
          clarification_reason: null,
          entities: {}
        },
        routing: {
          intent: 'project_science_question',
          confidence: 0.64,
          entities: {},
          plan: {},
          classifier: {}
        }
      });

      assert.equal(result.status, 'needs_more_info');
      assert.equal(result.rounds_executed, 0);
      assert.equal(result.follow_up_questions.length >= 1, true);
      assert.equal(result.follow_up_questions[0], 'Which project should I analyze for the expression drop?');
      assert.match(String(result.thinking_trace.question_clarifier || ''), /Resolve the project scope/i);
      assert.equal(result.final_synthesized_question, 'Explain why expression dropped in the unresolved project context.');
    });

    test('science reasoning loop exposes the expected result-analysis tool priority including python first', async () => {
      let capturedToolNames = [];
      const feedbackMessages = [];
      const executedTools = [];
      const scriptedTurns = [
        {
          calls: [],
          text: 'I can probably answer without running a computation.'
        },
        {
          calls: [
            { callId: 'call-1', name: 'python-sandbox', argsText: JSON.stringify({ code: 'print("trend")' }) }
          ],
          text: 'I should quantify the trend first.'
        },
        {
          calls: [],
          text: 'Now I have computation evidence.'
        }
      ];
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        startAgentSession: async ({ toolDefinitions }) => {
          capturedToolNames = toolDefinitions.map((tool) => tool.name);
          return { step: 0 };
        },
        extractAgentSessionFunctionCalls: (session) => scriptedTurns[session.step].calls,
        extractAgentSessionText: (session) => scriptedTurns[session.step].text,
        continueAgentSessionWithToolOutputs: async (session) => ({ step: session.step + 1 }),
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
          parameters: name === 'python-sandbox'
            ? {
              type: 'object',
              additionalProperties: false,
              required: ['code'],
              properties: {
                code: { type: 'string' }
              }
            }
            : {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
        })),
        evaluateScienceRound: async () => ({
          satisfied: true,
          reason: 'Harness evaluator thinks the current evidence is already sufficient.',
          missing_requirements: [],
          should_continue: false,
          next_tool_hint: null,
          can_answer_with_limitations: true
        }),
        synthesizeScienceFinal: async ({ toolTrace }) => ({
          answer: `Ready after ${toolTrace.length} computation step.`,
          confidence: 0.6,
          decision_record: {
            assumptions: [],
            open_questions: [],
            verification_notes: []
          },
          follow_up_questions: []
        })
      });

      const result = await runtime.runResultAnalysis({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'Compute the assay trend.',
        conversation: [],
        parserPayload: {
          primary_intent: 'result_analysis',
          needs_clarification: false,
          clarification_reason: null,
          entities: {}
        },
        routing: {
          intent: 'result_analysis',
          confidence: 0.64,
          entities: {},
          plan: {},
          classifier: {}
        },
        runTool: async (toolName, args) => {
          executedTools.push({ toolName, args });
          return {
            ok: true,
            tool_name: toolName,
            input: args,
            result: {
              items: [{ run_id: 'py-1' }],
              citations: [{ source: 'python-sandbox', pointer: 'py-1', reason: 'Computed the assay trend.' }],
              summary: 'Python sandbox execution completed.'
            },
            items: [{ run_id: 'py-1' }],
            citations: [{ source: 'python-sandbox', pointer: 'py-1', reason: 'Computed the assay trend.' }],
            summary: 'Python sandbox execution completed.'
          };
        }
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.tool_trace.length, 1);
      assert.equal(result.tool_trace[0].tool_name, 'python-sandbox');
      assert.equal(result.citations[0].source, 'python-sandbox');
      assert.equal(feedbackMessages.length, 1);
      assert.doesNotMatch(feedbackMessages[0], /Suggested next tool:/i);
      assert.match(feedbackMessages[0], /at least one tool round must run before exit judgement\./i);
      assert.equal(executedTools.length, 1);
      assert.equal(executedTools[0].toolName, 'python-sandbox');
      assert.equal(executedTools[0].args.code, 'print("trend")');
      assert.match(result.answer, /Ready after 1 computation step/i);
      assert.equal(capturedToolNames.includes('python-sandbox'), true);
      assert.equal(capturedToolNames.includes('record-lookup'), true);
      assert.equal(capturedToolNames.includes('literature-search'), true);
    });

    test('protocol generation runtime emits import-ready protocol records with placeholders and troubleshooting', async () => {
      let createIdCounter = 0;
      const runtime = agentProtocolGeneration.createProtocolGenerationRuntime({
        now: () => '2026-03-22T12:00:00.000Z',
        createId: () => `generated-${++createIdCounter}`,
        requestStructuredJsonPayload: async () => ({
          ok: true,
          payload: {
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
            result_summary: 'Generated a purification protocol.'
          }
        })
      });

      const result = await runtime.generateProtocol({
        title: 'PD-1 Nanobody Purification',
        method_text: 'Clarify lysate, bind it to Ni-NTA resin, then elute with imidazole.'
      });

      assert.equal(result.ok, true);
      assert.equal(result.status, 'generated');
      assert.equal(result.protocol.name, 'PD-1 Nanobody Purification');
      assert.equal(result.protocol.createdAt, '2026-03-22T12:00:00.000Z');
      assert.equal(result.protocol.updatedAt, '2026-03-22T12:00:00.000Z');
      assert.equal(Array.isArray(result.protocol.materials), true);
      assert.equal(result.protocol.materials[0], 'Ni-NTA resin');
      assert.equal(Array.isArray(result.protocol.steps), true);
      assert.equal(result.protocol.steps.length, 3);
      assert.match(String(result.protocol.steps[1].text || ''), /\{\{ph:/);
      assert.equal(result.protocol.steps[1].placeholders[0].name, 'time');
      assert.match(String(result.protocol.troubleshooting || ''), /Low yield/);
      assert.equal(result.summary, 'Generated a purification protocol.');
    });
  }
};
