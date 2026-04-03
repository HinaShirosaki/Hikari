module.exports = function registerAgentScienceAndProtocolSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('science loop exit criteria runtime generates structured criteria with llm output', async () => {
      const { createScienceLoopExitCriteriaRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'loop-exit-criteria.js'));
      const runtime = createScienceLoopExitCriteriaRuntime({
        requestStructuredJsonPayload: async ({ stage }) => {
          assert.equal(stage, 'science_loop_exit_criteria');
          return {
            ok: true,
            payload: {
              objective_summary: 'Explain whether outliers are real and when analysis can stop.',
              exit_conditions: [
                'A deterministic computation has been run.',
                'The final interpretation is tied to the computed result.'
              ],
              required_evidence: [
                'One computation-backed evidence step is required.'
              ],
              continue_when: [
                'The requested computation has not been executed yet.'
              ],
              can_exit_with_limitations_when: [
                'A best-effort answer is acceptable if the missing context is stated explicitly.'
              ],
              preferred_next_tools: ['python-sandbox', 'record-lookup'],
              reasoning_notes: 'Prefer computation before interpretation.'
            }
          };
        }
      });

      const criteria = await runtime.generateExitCriteria({
        intent: 'result_analysis',
        message: 'Fit this assay and explain the outliers.',
        clarifiedInput: 'Fit this assay, quantify the outliers, and explain whether they are likely technical or biological.',
        policy: {
          tool_scope: ['python-sandbox', 'record-lookup']
        }
      });

      assert.equal(criteria.objective_summary.includes('analysis can stop'), true);
      assert.equal(criteria.exit_conditions.some((item) => /deterministic computation/i.test(String(item))), true);
      assert.equal(criteria.exit_conditions.some((item) => /computed result/i.test(String(item))), true);
      assert.equal(criteria.preferred_next_tools[0], 'python-sandbox');
      assert.match(String(criteria.reasoning_notes || ''), /computation/i);
    });

    test('science fallback heuristics treat source and computation needs as preferences unless exit criteria make them blocking', () => {
      const { createScienceLoopExitCriteriaRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'loop-exit-criteria.js'));
      const { createScienceLoopExitJudgeRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'loop-exit-judge.js'));
      const { createScienceLoopCurrentScientificStateRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'current-scientific-state.js'));

      const criteriaRuntime = createScienceLoopExitCriteriaRuntime({
        requestStructuredJsonPayload: async () => ({ ok: false, error: 'force fallback' })
      });
      const judgeRuntime = createScienceLoopExitJudgeRuntime();
      const currentStateRuntime = createScienceLoopCurrentScientificStateRuntime();

      const generalCriteria = criteriaRuntime.buildFallbackExitCriteria({
        intent: 'general_science_question',
        message: 'What are the latest findings on MAPK inhibitor resistance?',
        clarifiedInput: 'What are the latest findings on MAPK inhibitor resistance?',
        policy: {
          tool_scope: ['literature-search', 'web-search']
        }
      });
      assert.equal(generalCriteria.required_evidence.some((item) => /external citation-backed source/i.test(String(item))), false);
      assert.equal(generalCriteria.continue_when.some((item) => /freshness or explicit references/i.test(String(item))), true);

      const projectCriteria = criteriaRuntime.buildFallbackExitCriteria({
        intent: 'project_science_question',
        message: 'Why did Atlas expression drop after transfection?',
        clarifiedInput: 'Why did Atlas expression drop after transfection?'
      });
      assert.equal(projectCriteria.required_evidence.some((item) => /internal project-linked source/i.test(String(item))), false);
      assert.equal(projectCriteria.continue_when.some((item) => /project scope or project grounding/i.test(String(item))), true);

      const analysisCriteria = criteriaRuntime.buildFallbackExitCriteria({
        intent: 'result_analysis',
        message: 'Calculate the fold change from 2 to 4.',
        clarifiedInput: 'Calculate the fold change from 2 to 4.',
        policy: {
          require_compute_for_numeric_queries: true
        }
      });
      assert.equal(analysisCriteria.required_evidence.some((item) => /deterministic computation/i.test(String(item))), false);
      assert.equal(analysisCriteria.continue_when.some((item) => /trusted provided output/i.test(String(item))), true);

      const generalFallback = judgeRuntime.buildFallbackEvaluation({
        intent: 'general_science_question',
        message: 'What are the latest findings on MAPK inhibitor resistance?',
        exitCriteria: {
          required_evidence: ['At least one evidence-gathering round has run before the loop exits.'],
          continue_when: ['A blocking evidence gap still prevents a grounded answer.'],
          preferred_next_tools: ['literature-search']
        },
        toolTrace: [
          { tool_name: 'record-lookup', ok: true }
        ],
        citations: [],
        roundsExecuted: 1,
        maxRounds: 4
      });
      assert.equal(generalFallback.missing_requirements.some((item) => /external citation-backed source/i.test(String(item))), false);

      const projectFallback = judgeRuntime.buildFallbackEvaluation({
        intent: 'project_science_question',
        message: 'Why did Atlas expression drop after transfection?',
        exitCriteria: {
          required_evidence: ['At least one evidence-gathering round has run before the loop exits.'],
          continue_when: ['A blocking evidence gap still prevents a grounded answer.'],
          preferred_next_tools: ['record-lookup']
        },
        toolTrace: [
          { tool_name: 'record-lookup', ok: true }
        ],
        citations: [],
        roundsExecuted: 1,
        maxRounds: 4
      });
      assert.equal(projectFallback.missing_requirements.some((item) => /internal project citation/i.test(String(item))), false);

      const analysisFallback = judgeRuntime.buildFallbackEvaluation({
        intent: 'result_analysis',
        message: 'Calculate the fold change from 2 to 4.',
        exitCriteria: {
          required_evidence: ['At least one evidence-gathering round has run before the loop exits.'],
          continue_when: ['A blocking evidence gap still prevents a grounded answer.'],
          preferred_next_tools: ['record-lookup']
        },
        toolTrace: [
          { tool_name: 'record-lookup', ok: true }
        ],
        citations: [],
        roundsExecuted: 1,
        maxRounds: 4
      });
      assert.equal(analysisFallback.missing_requirements.some((item) => /python sandbox computation step/i.test(String(item))), false);

      const analysisState = currentStateRuntime.buildFallbackCurrentScientificState({
        intent: 'result_analysis',
        message: 'Calculate the fold change from 2 to 4.',
        exitCriteria: {
          required_evidence: ['At least one evidence-gathering round has run before the loop exits.'],
          continue_when: ['A blocking evidence gap still prevents a grounded answer.']
        },
        toolTrace: [
          { tool_name: 'record-lookup', ok: true }
        ],
        citations: []
      });
      assert.equal(analysisState.remains_unknown.some((item) => /is still required/i.test(String(item))), false);
      assert.equal(analysisState.remains_unknown.some((item) => /additional deterministic computation/i.test(String(item))), false);
    });

    test('science loop pre-synthesized question runtime compacts the current best answer, basis, and gaps', () => {
      const { createScienceLoopPreSynthesizedQuestionRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'pre-synthesized-question.js'));
      const runtime = createScienceLoopPreSynthesizedQuestionRuntime();

      const preSynthesizedQuestion = runtime.buildPreSynthesizedQuestion({
        latestAssistantText: 'The assay trend looks directionally real, but the answer is still provisional.',
        latestToolResult: {
          ok: false,
          tool_name: 'record-lookup',
          summary: 'Located the assay record, but the computation step has not run yet.',
          error: 'Python fit has not been executed yet.',
          items: [{ id: 'assay-1' }],
          citations: []
        },
        toolTrace: [
          {
            tool_name: 'record-lookup',
            ok: false,
            summary: 'Located the assay record, but the computation step has not run yet.',
            error: 'Python fit has not been executed yet.'
          }
        ]
      });

      assert.equal(preSynthesizedQuestion.tentative_answer.current_best_answer, 'The assay trend looks directionally real, but the answer is still provisional.');
      assert.equal(preSynthesizedQuestion.supporting_basis.some((item) => /Located the assay record/i.test(String(item))), true);
      assert.equal(preSynthesizedQuestion.unresolved_issues.some((item) => /Latest tool issue: Python fit has not been executed yet/i.test(String(item))), true);
      assert.equal(preSynthesizedQuestion.unresolved_issues.some((item) => /No citation-backed evidence has been collected yet/i.test(String(item))), true);
    });

    test('science loop exit judge runtime uses a sub-agent to return an exit decision', async () => {
      const { createScienceLoopExitJudgeRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'loop-exit-judge.js'));
      const stages = [];
      const runtime = createScienceLoopExitJudgeRuntime({
        requestStructuredJsonPayload: async ({ stage, userPrompt }) => {
          stages.push(stage);
          if (stage === 'science_loop_current_scientific_state') {
            assert.match(String(userPrompt || ''), /Pre-synthesized question JSON:/);
            assert.match(String(userPrompt || ''), /The assay trend looks real, but I still need a computation-backed fit/i);
            assert.match(String(userPrompt || ''), /Loaded assay data for fitting/i);
            return {
              ok: true,
              payload: {
                supported_now: ['No computation has been run yet.', 'No citation-backed evidence has been collected yet.'],
                contradicted: [],
                remains_unknown: ['Whether the assay trend is real or driven by outliers.'],
                uncertainty_decision_relevant: true,
                uncertainty_decision_reason: 'The missing computation directly affects whether the loop can stop.'
              }
            };
          }
          assert.equal(stage, 'science_loop_exit_judge_sub_agent');
          assert.match(String(userPrompt || ''), /Pre-synthesized question JSON:/);
          assert.match(String(userPrompt || ''), /The assay trend looks real, but I still need a computation-backed fit/i);
          assert.match(String(userPrompt || ''), /Current scientific state JSON:/);
          assert.match(String(userPrompt || ''), /Whether the assay trend is real or driven by outliers/i);
          assert.match(String(userPrompt || ''), /missing computation directly affects whether the loop can stop/i);
          return {
            ok: true,
            payload: {
              satisfied: false,
              reason: 'The computation step is still missing.',
              missing_requirements: ['A Python sandbox computation step is still required.'],
              should_continue: true,
              next_tool_hint: {
                tool_name: 'python-sandbox',
                query: 'fit assay outliers',
                reason: 'Need deterministic computation before interpretation.'
              },
              can_answer_with_limitations: false
            }
          };
        }
      });

      const judged = await runtime.judgeExit({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        intent: 'result_analysis',
        originalMessage: 'Fit this assay and explain the outliers.',
        message: 'Fit this assay and explain the outliers.',
        policy: {
          require_compute_for_numeric_queries: true
        },
        latestAssistantText: 'The assay trend looks real, but I still need a computation-backed fit.',
        exitCriteria: {
          preferred_next_tools: ['python-sandbox'],
          required_evidence: ['A deterministic computation step is required.']
        },
        latestToolResult: {
          ok: true,
          tool_name: 'record-lookup',
          summary: 'Located the assay record and raw values.',
          items: [{ id: 'assay-1' }],
          citations: [{ source: 'assay', pointer: 'assay-1', reason: 'Loaded assay data for fitting.' }]
        },
        toolTrace: [
          {
            tool_name: 'record-lookup',
            ok: true,
            summary: 'Located the assay record and raw values.'
          }
        ],
        citations: [{ source: 'assay', pointer: 'assay-1', reason: 'Loaded assay data for fitting.' }],
        roundsExecuted: 1,
        maxRounds: 4
      });

      assert.deepEqual(stages, ['science_loop_current_scientific_state', 'science_loop_exit_judge_sub_agent']);
      assert.equal(judged.evaluation.satisfied, false);
      assert.equal(judged.evaluation.should_continue, true);
      assert.equal(judged.evaluation.next_tool_hint.tool_name, 'python-sandbox');
      assert.equal(judged.pre_synthesized_question.tentative_answer.current_best_answer, 'The assay trend looks real, but I still need a computation-backed fit.');
      assert.equal(judged.pre_synthesized_question.supporting_basis.some((item) => /Loaded assay data for fitting/i.test(String(item))), true);
      assert.equal(judged.current_scientific_state.uncertainty_decision_relevant, true);
      assert.equal(judged.current_scientific_state.remains_unknown[0], 'Whether the assay trend is real or driven by outliers.');
      assert.equal(judged.sub_agent !== null, true);
      assert.equal(judged.sub_agent.last_response.output.satisfied, false);
    });

    test('science reasoning loop enforces one tool per round and continues from evaluator feedback', async () => {
      const scriptedTurns = [
        {
          calls: [
            { callId: 'call-1', name: 'literature-search', argsText: JSON.stringify({ query: 'MAPK inhibitor resistance', source: 'pubmed', limit: 3 }) },
            { callId: 'call-2', name: 'literature-search', argsText: JSON.stringify({ query: 'ignore this extra call', source: 'web', limit: 3 }) }
          ],
          text: 'I will start with PubMed.'
        },
        {
          calls: [],
          text: 'PubMed returned one paper, but I still need a broader review source.'
        },
        {
          calls: [
            { callId: 'call-3', name: 'literature-search', argsText: JSON.stringify({ query: 'MAPK inhibitor resistance review', source: 'web', limit: 3 }) }
          ],
          text: 'I will use a broader web-backed retrieval next.'
        },
        {
          calls: [],
          text: 'Now I have enough evidence to answer.'
        }
      ];
      const feedbackMessages = [];
      const lifecycleEvents = [];
      const preSynthesizedQuestions = [];
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
        startAgentSession: async ({ toolDefinitions }) => {
          assert.deepEqual(toolDefinitions.map((tool) => tool.name), ['literature-search']);
          return { step: 0 };
        },
        extractAgentSessionFunctionCalls: (session) => scriptedTurns[session.step].calls,
        extractAgentSessionText: (session) => scriptedTurns[session.step].text,
        continueAgentSessionWithToolOutputs: async (session) => ({ step: session.step + 1 }),
        continueAgentSessionWithUserMessage: async (session, feedback) => {
          feedbackMessages.push(String(feedback || ''));
          return { step: session.step + 1 };
        },
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
        evaluateScienceRound: async ({ roundsExecuted, preSynthesizedQuestion }) => {
          preSynthesizedQuestions.push({
            roundsExecuted,
            preSynthesizedQuestion
          });
          return roundsExecuted >= 2
            ? {
              satisfied: true,
              reason: 'Evidence is sufficient now.',
              missing_requirements: [],
              should_continue: false,
              next_tool_hint: null,
              can_answer_with_limitations: true
            }
            : {
              satisfied: false,
              reason: 'Need one broader review-style source.',
              missing_requirements: ['A broader source is still needed.'],
              should_continue: true,
              next_tool_hint: {
                tool_name: 'literature-search',
                query: 'MAPK inhibitor resistance review',
                reason: 'Broaden beyond the first paper.'
              },
              can_answer_with_limitations: true
            };
        },
        synthesizeScienceFinal: async () => ({
          answer: 'Resistance often involves pathway reactivation and compensatory signaling, supported by both the paper hit and broader review retrieval.',
          confidence: 0.77,
          decision_record: {
            assumptions: ['Only retrieved sources were used.'],
            open_questions: [],
            verification_notes: ['Two retrieval rounds completed.']
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
        runTool: async (toolName, args) => ({
          ok: true,
          tool_name: toolName,
          input: args,
          result: {
            items: [{ id: `${toolName}-1` }],
            citations: [
              {
                source: args?.source === 'web' ? 'web_source' : 'pubmed',
                pointer: `${toolName}-pointer`,
                reason: `Retrieved from ${toolName} (${args?.source || 'auto'}).`
              }
            ],
            summary: `${toolName} completed.`
          },
          items: [{ id: `${toolName}-1` }],
          citations: [
            {
              source: args?.source === 'web' ? 'web_source' : 'pubmed',
              pointer: `${toolName}-pointer`,
              reason: `Retrieved from ${toolName} (${args?.source || 'auto'}).`
            }
          ],
          summary: `${toolName} completed.`
        })
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.rounds_executed, 2);
      assert.equal(result.tool_trace.length, 2);
      assert.equal(result.tool_trace[0].tool_name, 'literature-search');
      assert.equal(result.tool_trace[0].input.source, 'pubmed');
      assert.equal(result.tool_trace[0].truncated_multi_call, true);
      assert.equal(result.tool_trace[1].tool_name, 'literature-search');
      assert.equal(result.tool_trace[1].input.source, 'web');
      assert.equal(preSynthesizedQuestions.length, 2);
      assert.match(preSynthesizedQuestions[0].preSynthesizedQuestion.tentative_answer.current_best_answer, /PubMed returned one paper/i);
      assert.equal(preSynthesizedQuestions[0].preSynthesizedQuestion.supporting_basis.some((item) => /Retrieved from literature-search \(pubmed\)/i.test(String(item))), true);
      assert.equal(result.intermediate_states.some((state) => state.stage === 'science_pre_synthesis'), true);
      assert.equal(feedbackMessages.length, 1);
      assert.match(feedbackMessages[0], /Need one broader review-style source/i);
      assert.match(result.answer, /pathway reactivation/i);
      assert.equal(lifecycleEvents.some((event) => event.stage === 'science_round_started' && event.meta.round === 1), true);
      assert.equal(lifecycleEvents.some((event) => event.stage === 'science_evaluator_continue' && event.meta.round === 1), true);
      assert.equal(lifecycleEvents.some((event) => event.stage === 'science_evaluator_satisfied' && event.meta.round === 2), true);
    });

    test('science reasoning loop answers reasoning-effort 0 science questions directly without entering the loop', async () => {
      let capturedToolDefinitions = null;
      let capturedSystemPrompt = '';
      const runtime = agentScienceReasoningLoop.createScienceReasoningLoopRuntime({
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
      assert.match(capturedSystemPrompt, /Reasoning effort: 0/);
      assert.match(capturedSystemPrompt, /direct answer only/i);
      assert.equal(result.status, 'completed');
      assert.equal(result.rounds_executed, 0);
      assert.equal(result.reasoning_effort, 0);
      assert.equal(result.citations.length, 0);
      assert.match(result.answer, /nickel coordination/i);
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
                reasoning_notes: 'Prefer literature before broader web retrieval.'
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
      assert.deepEqual(clarificationStages, ['science_input_clarification', 'science_loop_exit_criteria']);
      assert.equal(capturedSessionMessage, 'Explain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty.');
      assert.match(capturedSystemPrompt, /Clarified request for execution:/);
      assert.match(capturedSystemPrompt, /Exit criteria JSON:/);
      assert.match(capturedSystemPrompt, /Explain MAPK inhibitor resistance with literature-backed mechanisms/i);
      assert.equal(result.rounds_executed, 1);
      assert.equal(result.tool_trace[0].tool_name, 'literature-search');
      assert.equal(result.tool_trace[0].input.source, 'pubmed');
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

      assert.deepEqual(capturedToolNames, ['literature-search']);
      assert.equal(result.status, 'completed');
      assert.equal(result.rounds_executed, 1);
      assert.equal(result.tool_trace[0].tool_name, 'literature-search');
      assert.equal(result.tool_trace[0].input.source, 'pubmed');
      assert.equal(result.citations[0].source, 'pubmed');
      assert.match(result.answer, /10x PBS stock/i);
    });

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
      assert.match(feedbackMessages[0], /Suggested next tool: python-sandbox\./i);
      assert.equal(executedTools.length, 1);
      assert.equal(executedTools[0].toolName, 'python-sandbox');
      assert.equal(executedTools[0].args.code, 'print("trend")');
      assert.match(result.answer, /Ready after 1 computation step/i);
      assert.equal(capturedToolNames[0], 'python-sandbox');
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
