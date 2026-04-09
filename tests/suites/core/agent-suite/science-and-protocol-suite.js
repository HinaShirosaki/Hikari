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
              reasoning_notes: 'Prefer computation before interpretation.',
              trace_sentence: 'I am defining what evidence must exist before the reasoning loop can stop.'
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
      assert.match(String(criteria.trace_sentence || ''), /reasoning loop can stop/i);
    });

    test('science route planner runtime drafts a structured reference plan with tool ordering', async () => {
      const { createAgentRoutePlannerRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'agent-route-planner.js'));
      const runtime = createAgentRoutePlannerRuntime({
        requestStructuredJsonPayload: async ({ stage }) => {
          assert.equal(stage, 'science_route_planner');
          return {
            ok: true,
            payload: {
              goal: 'Explain MAPK inhibitor resistance with grounded mechanisms.',
              route_summary: 'Start with one focused literature pass, then broaden only if the evidence is thin.',
              step_sequence: [
                {
                  step_label: 'focused-literature',
                  objective: 'Pull one mechanistically relevant paper first.',
                  suggested_tools: ['literature-search'],
                  reason: 'A focused literature pass should answer most of the question.'
                },
                {
                  step_label: 'broaden-if-needed',
                  objective: 'Refine or broaden retrieval if the first hit is incomplete.',
                  suggested_tools: ['literature-search'],
                  reason: 'Do not broaden unless the first pass leaves a real gap.'
                }
              ],
              tool_call_suggestions: [
                {
                  tool_name: 'literature-search',
                  priority: 1,
                  when_to_use: 'Use first.',
                  reason: 'The question needs citation-backed external grounding.',
                  query_hint: 'MAPK inhibitor resistance mechanisms'
                }
              ],
              decision_points: [
                'If the first paper is too narrow, refine the search before answering.'
              ],
              adaptation_notes: [
                'Treat the route as guidance only.'
              ],
              reference_only: true,
              trace_sentence: 'I am sketching a lightweight route so the loop can start with the most targeted evidence step.'
            }
          };
        }
      });

      const plan = await runtime.draftRoutePlan({
        intent: 'general_science_question',
        reasoningEffort: 1,
        message: 'Why do tumors stop responding to MAPK inhibitors?',
        clarifiedInput: 'Explain MAPK inhibitor resistance with grounded mechanisms.',
        policy: {
          tool_scope: ['literature-search']
        }
      });

      assert.equal(plan.reference_only, true);
      assert.equal(plan.tool_call_suggestions[0].tool_name, 'literature-search');
      assert.equal(plan.tool_call_suggestions[0].priority, 1);
      assert.equal(plan.step_sequence[0].step_label, 'focused-literature');
      assert.match(String(plan.route_summary || ''), /focused literature pass/i);
      assert.match(String(plan.trace_sentence || ''), /lightweight route/i);
    });

    test('science route planner normalizes literature query hints into keyword phrases', async () => {
      const { createAgentRoutePlannerRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'agent-route-planner.js'));
      const runtime = createAgentRoutePlannerRuntime({
        requestStructuredJsonPayload: async ({ stage, userPrompt }) => {
          assert.equal(stage, 'science_route_planner');
          assert.match(String(userPrompt || ''), /keyword phrases rather than a full sentence/i);
          return {
            ok: true,
            payload: {
              goal: 'Explain the whole antigen processing procedure to me.',
              route_summary: 'Start with one focused literature pass.',
              step_sequence: [
                {
                  step_label: 'focused-literature',
                  objective: 'Pull one mechanistically relevant paper first.',
                  suggested_tools: ['literature-search'],
                  reason: 'A focused literature pass should answer most of the question.'
                }
              ],
              tool_call_suggestions: [
                {
                  tool_name: 'literature-search',
                  priority: 1,
                  when_to_use: 'Use first.',
                  reason: 'The question needs citation-backed external grounding.',
                  query_hint: 'Explain the whole antigen processing procedure to me.'
                }
              ],
              decision_points: [],
              adaptation_notes: ['Treat the route as guidance only.'],
              reference_only: true,
              trace_sentence: 'I am sketching a lightweight route so the loop can start with the most targeted evidence step.'
            }
          };
        }
      });

      const plan = await runtime.draftRoutePlan({
        intent: 'general_science_question',
        reasoningEffort: 1,
        message: 'Explain the whole antigen processing procedure to me.',
        clarifiedInput: 'Explain the whole antigen processing procedure to me.',
        policy: {
          tool_scope: ['literature-search']
        }
      });

      assert.equal(plan.tool_call_suggestions[0].tool_name, 'literature-search');
      assert.equal(plan.tool_call_suggestions[0].query_hint, 'antigen processing');
    });

    test('science final synthesis runtime requests plain assistant text and derives metadata locally', async () => {
      const { createScienceFinalSynthesisRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'final-synthesis.js'));
      let capturedPrompt = '';
      let capturedStage = '';
      const runtime = createScienceFinalSynthesisRuntime({
        requestAssistantText: async ({ stage, userPrompt }) => {
          capturedStage = String(stage || '');
          capturedPrompt = String(userPrompt || '');
          return {
            ok: true,
            text: '## Conclusion\nPathway reactivation and compensatory signaling are the strongest supported mechanisms in the retrieved evidence.'
          };
        }
      });

      const synthesis = await runtime.synthesizeFinal({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        intent: 'general_science_question',
        message: 'Why do tumors stop responding to MAPK inhibitors?',
        roundsExecuted: 2,
        maxRounds: 4,
        evaluator: {
          satisfied: true,
          reason: 'Two grounded retrieval steps are enough to answer.',
          missing_requirements: [],
          should_continue: false,
          next_tool_hint: null,
          can_answer_with_limitations: true
        },
        accumulatedCitations: [
          { source: 'pubmed', pointer: 'PMID:1', reason: 'Mechanism paper.' }
        ],
        toolTrace: [
          { tool_name: 'literature-search', ok: true, summary: 'Retrieved one targeted source.' },
          { tool_name: 'web-search', ok: true, summary: 'Retrieved one broader review source.' }
        ],
        partial: false
      });

      assert.equal(capturedStage, 'science_reasoning_final_synthesis');
      assert.match(capturedPrompt, /Respond with the final answer text only/i);
      assert.doesNotMatch(capturedPrompt, /Return JSON only/i);
      assert.match(synthesis.answer, /Pathway reactivation/i);
      assert.equal(synthesis.confidence > 0.7, true);
      assert.equal(synthesis.decision_record.verification_notes.some((item) => /Two grounded retrieval steps are enough to answer/i.test(String(item))), true);
      assert.match(String(synthesis.trace_sentence || ''), /final grounded answer/i);
    });

    test('science logical verification runtime extracts context plus per-item logic and checks each item separately', async () => {
      const { createScienceLoopLogicalVerificationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'logical-verification.js'));
      const stabilityPrompts = [];
      const runtime = createScienceLoopLogicalVerificationRuntime({
        requestStructuredJsonPayload: async ({ stage, userPrompt }) => {
          if (stage === 'science_loop_logic_extraction') {
            assert.match(String(userPrompt || ''), /Return a short context, the short pre-synthesized answer, and a short logic_list/i);
            return {
              ok: true,
              payload: {
                context: 'One focused mechanism paper plus one stated gap.',
                pre_synthesized_answer: 'Pathway reactivation looks central, but the answer is still provisional.',
                logic_list: [
                  {
                    reasoning_type: 'deductive',
                    logic: 'The mechanism paper directly supports pathway reactivation.'
                  },
                  {
                    reasoning_type: 'abductive',
                    logic: 'Pathway reactivation is the current best explanation.'
                  }
                ]
              }
            };
          }
          assert.equal(stage, 'science_loop_inference_stability');
          stabilityPrompts.push(String(userPrompt || ''));
          if (/Reasoning type: deductive/i.test(String(userPrompt || ''))) {
            return {
              ok: true,
              payload: {
                stable: true,
                failed_reason: ''
              }
            };
          }
          return {
            ok: true,
            payload: {
              stable: false,
              failed_reason: 'alternatives unresolved'
            }
          };
        }
      });

      const verification = await runtime.verifyPreSynthesizedQuestion({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'Why do tumors stop responding to MAPK inhibitors?',
        preSynthesizedQuestion: {
          tentative_answer: {
            current_best_answer: 'Pathway reactivation looks central, but the answer is still provisional.'
          },
          supporting_basis: ['ERK signaling resumed after inhibitor escape.'],
          unresolved_issues: ['Broader review context is still limited.']
        }
      });

      assert.equal(verification.part_1.context, 'One focused mechanism paper plus one stated gap.');
      assert.equal(verification.part_1.pre_synthesized_answer, 'Pathway reactivation looks central, but the answer is still provisional.');
      assert.equal(verification.part_1.logic_list.length, 2);
      assert.equal(verification.part_1.logic_list[0].reasoning_type, 'deductive');
      assert.equal(verification.part_2.length, 2);
      assert.equal(verification.part_2.find((row) => row.reasoning_type === 'deductive').stable, true);
      assert.equal(verification.part_2.find((row) => row.reasoning_type === 'abductive').stable, false);
      assert.equal(verification.part_2.find((row) => row.reasoning_type === 'abductive').failed_reason, 'alternatives unresolved');
      assert.equal(stabilityPrompts.some((prompt) => /Extracted context: One focused mechanism paper plus one stated gap\./i.test(prompt)), true);
      assert.equal(stabilityPrompts.some((prompt) => /Extracted pre-synthesized answer: Pathway reactivation looks central, but the answer is still provisional\./i.test(prompt)), true);
    });

    test('science prompt builders render compact summaries instead of JSON payload blocks', () => {
      const { createScienceLoopSupport } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'support.js'));
      const { createScienceInputClarificationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'input-clarification.js'));
      const { createAgentRoutePlannerRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'agent-route-planner.js'));
      const { createScienceLoopExitCriteriaRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'loop-exit-criteria.js'));
      const { createScienceLoopCurrentScientificStateRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'current-scientific-state.js'));
      const { createScienceLoopExitJudgeRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'loop-exit-judge.js'));
      const { createScienceFinalSynthesisRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'final-synthesis.js'));
      const { createScienceThinkingTraceRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'thinking-trace.js'));

      const policy = {
        intent: 'general_science_question',
        retrieval_priority: 'literature_first_web_last',
        tool_scope: ['literature-search', 'web-search'],
        require_external_citation_when_recent: true,
        require_retrieval_attempt: true
      };
      const routing = {
        intent: 'general_science_question',
        response_mode: 'science_loop',
        reasoning_effort: 2,
        confidence: 0.72,
        entities: {
          protein: 'MAPK',
          requested_output: 'mechanism review'
        },
        plan: {
          needs_clarification: false,
          selected_tool_names: ['literature-search', 'web-search']
        }
      };
      const project = {
        id: 'proj-1',
        name: 'Atlas',
        resolution_source: 'parser'
      };
      const clarification = {
        clarified_input: 'Explain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty.',
        analysis_goal: 'Answer the resistance question using grounded literature evidence.',
        important_constraints: ['Use literature before generic web search.'],
        missing_information: [],
        should_ask_follow_up: false,
        follow_up_question: '',
        follow_up_reason: 'The request is clear enough to continue.'
      };
      const parserPayload = {
        primary_intent: 'general_science_question',
        reasoning_effort: 2,
        needs_clarification: false,
        reasoning_summary: 'Needs grounded external evidence.',
        entities: {
          requested_output: 'mechanism review',
          protein: 'MAPK'
        }
      };
      const routePlan = {
        goal: clarification.clarified_input,
        route_summary: 'Use one focused literature pass first, then broaden only if the first evidence step is too narrow.',
        step_sequence: [
          {
            step_label: 'focused-literature',
            objective: 'Start with a targeted literature search for direct resistance mechanisms.',
            suggested_tools: ['literature-search'],
            reason: 'The highest-yield first step is a focused literature pass.'
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
      };
      const exitCriteria = {
        objective_summary: 'Explain MAPK inhibitor resistance with grounded evidence and stop once one targeted literature pass is enough.',
        exit_conditions: ['At least one relevant literature source supports the answer.'],
        required_evidence: ['One literature-backed retrieval step is required.'],
        continue_when: ['No literature-backed source has been collected yet.'],
        can_exit_with_limitations_when: ['Minor uncertainty can remain if stated explicitly.'],
        preferred_next_tools: ['literature-search'],
        reasoning_notes: 'Prefer literature before broader web retrieval.'
      };
      const citations = [
        { source: 'pubmed', pointer: 'PMID:1', reason: 'Retrieved one literature hit.' },
        { source: 'web_source', pointer: 'review-1', reason: 'Retrieved one review hit.' }
      ];
      const toolTrace = [
        {
          tool_name: 'literature-search',
          ok: true,
          input: { query: 'MAPK inhibitor resistance mechanisms', source: 'pubmed', limit: 3 },
          summary: 'Retrieved one targeted source.',
          loaded_context_blocks: [
            {
              paper_id: 'PMID:1',
              paper_title: 'Mechanisms review',
              section_label: 'Results',
              excerpt: 'Pathway reactivation restored ERK signaling after inhibitor exposure.',
              relevance_reason: 'Direct mechanistic evidence from the retrieved paper.',
              source: 'pubmed_abstract',
              evidence_kind: 'text'
            }
          ],
          assistant_after_tool: 'I now have one targeted source but may still need broader context.'
        }
      ];
      const preSynthesizedQuestion = {
        tentative_answer: {
          current_best_answer: 'Pathway reactivation and compensatory signaling appear central.'
        },
        supporting_basis: ['Retrieved one targeted source.'],
        unresolved_issues: ['Broader review context may still help.'],
        logical_verification: {
          part_1: {
            context: 'One targeted source supports a mechanistic escape explanation.',
            pre_synthesized_answer: 'Pathway reactivation and compensatory signaling appear central.',
            logic_list: [
              {
                reasoning_type: 'deductive',
                logic: 'The retrieved source directly supports pathway reactivation.'
              },
              {
                reasoning_type: 'abductive',
                logic: 'Pathway reactivation currently best explains the escape pattern.'
              }
            ]
          },
          part_2: [
            {
              reasoning_type: 'deductive',
              logic: 'The retrieved source directly supports pathway reactivation.',
              stable: true,
              failed_reason: ''
            },
            {
              reasoning_type: 'abductive',
              logic: 'Pathway reactivation currently best explains the escape pattern.',
              stable: false,
              failed_reason: 'alternatives still open'
            }
          ]
        }
      };
      const evaluation = {
        satisfied: false,
        reason: 'One broader source is still needed.',
        missing_requirements: ['A broader source is still needed.'],
        should_continue: true,
        next_tool_hint: {
          tool_name: 'web-search',
          query: 'MAPK inhibitor resistance review',
          reason: 'Broaden beyond the first paper.'
        },
        can_answer_with_limitations: true
      };

      const supportRuntime = createScienceLoopSupport();
      const clarificationRuntime = createScienceInputClarificationRuntime();
      const routePlannerRuntime = createAgentRoutePlannerRuntime();
      const exitCriteriaRuntime = createScienceLoopExitCriteriaRuntime();
      const currentStateRuntime = createScienceLoopCurrentScientificStateRuntime();
      const judgeRuntime = createScienceLoopExitJudgeRuntime();
      const finalSynthesisRuntime = createScienceFinalSynthesisRuntime();
      const thinkingTraceRuntime = createScienceThinkingTraceRuntime();

      const systemPrompt = supportRuntime.buildScienceSessionSystemPrompt({
        baseSystemPrompt: 'Base science prompt.',
        intent: 'general_science_question',
        policy,
        routing,
        project,
        originalMessage: 'Why do tumors stop responding to MAPK inhibitors?',
        clarification,
        routePlan,
        exitCriteria,
        message: clarification.clarified_input,
        reasoningEffort: 2
      });
      const clarificationPrompt = clarificationRuntime.buildClarificationPrompt({
        intent: 'general_science_question',
        project,
        parserPayload,
        routing,
        conversation: [
          { role: 'user', text: 'Why do tumors stop responding to MAPK inhibitors?' },
          { role: 'assistant', text: 'I can start with grounded literature.' }
        ],
        message: 'Why do tumors stop responding to MAPK inhibitors?'
      });
      const routePlanPrompt = routePlannerRuntime.buildRoutePlanPrompt({
        intent: 'general_science_question',
        reasoningEffort: 2,
        policy,
        project,
        clarification,
        routing,
        clarifiedInput: clarification.clarified_input
      });
      const exitCriteriaPrompt = exitCriteriaRuntime.buildExitCriteriaPrompt({
        intent: 'general_science_question',
        policy,
        project,
        clarification,
        routing,
        clarifiedInput: clarification.clarified_input
      });
      const currentStatePrompt = currentStateRuntime.buildCurrentScientificStatePrompt({
        intent: 'general_science_question',
        exitCriteria,
        preSynthesizedQuestion,
        project,
        clarification,
        message: clarification.clarified_input,
        latestAssistantText: 'I have one targeted source so far.',
        latestToolResult: toolTrace[0],
        toolTrace,
        citations,
        roundsExecuted: 1,
        maxRounds: 4
      });
      const judgePrompt = judgeRuntime.buildJudgeMessage({
        intent: 'general_science_question',
        exitCriteria,
        preSynthesizedQuestion,
        currentScientificState: {
          supported_now: ['Collected one targeted source.'],
          contradicted: [],
          remains_unknown: ['Broader review context may still help.'],
          uncertainty_decision_relevant: true,
          uncertainty_decision_reason: 'One broader source may still change the loop decision.'
        },
        project,
        clarification,
        message: clarification.clarified_input,
        latestAssistantText: 'I have one targeted source so far.',
        latestToolResult: toolTrace[0],
        toolTrace,
        citations,
        roundsExecuted: 1,
        maxRounds: 4
      });
      const synthesisPrompt = finalSynthesisRuntime.buildSynthesisPrompt({
        intent: 'general_science_question',
        policy,
        message: clarification.clarified_input,
        clarification,
        project,
        roundsExecuted: 1,
        maxRounds: 4,
        evaluator: evaluation,
        accumulatedCitations: citations,
        toolTrace,
        partial: false
      });
      const thinkingTracePrompt = thinkingTraceRuntime.buildThinkingTracePrompt({
        intent: 'general_science_question',
        clarifiedInput: clarification.clarified_input,
        clarification,
        routePlan,
        exitCriteria,
        toolRounds: [
          {
            round: 1,
            assistant_before_tool: 'I will start with one focused literature search.',
            tool_name: 'literature-search',
            tool_arguments: {
              query: 'MAPK inhibitor resistance mechanisms',
              source: 'pubmed'
            },
            tool_summary: 'Retrieved one targeted source.',
            assistant_after_tool: 'I now have one targeted source but may still need broader context.'
          }
        ],
        preSynthesizedQuestion,
        evaluation,
        status: 'partial',
        finalAnswer: 'Pathway reactivation and compensatory signaling are likely important.'
      });

      assert.match(systemPrompt, /Execution hints:/);
      assert.match(systemPrompt, /Retrieval preference:/);
      assert.match(systemPrompt, /Preferred tools:/);
      assert.match(systemPrompt, /The clarified execution request is provided separately as the session message\./);
      assert.doesNotMatch(systemPrompt, /Science policy:/);
      assert.doesNotMatch(systemPrompt, /Reference route plan:/);
      assert.doesNotMatch(systemPrompt, /Exit criteria:/);
      assert.doesNotMatch(systemPrompt, /Science loop policy JSON:/);
      assert.doesNotMatch(systemPrompt, /Routing JSON:/);
      assert.doesNotMatch(systemPrompt, /Clarification JSON:/);
      assert.doesNotMatch(systemPrompt, /Request for execution:/);
      assert.match(clarificationPrompt, /User message:/);
      assert.doesNotMatch(clarificationPrompt, /Parser payload JSON:/);
      assert.doesNotMatch(clarificationPrompt, /Routing JSON:/);
      assert.doesNotMatch(clarificationPrompt, /Recent conversation JSON:/);
      assert.match(routePlanPrompt, /Clarified request:\nExplain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty\./);
      assert.match(routePlanPrompt, /Science policy:/);
      assert.match(routePlanPrompt, /Allowed tools: literature-search \| web-search/);
      assert.doesNotMatch(routePlanPrompt, /Policy JSON:/);
      assert.doesNotMatch(routePlanPrompt, /Clarification JSON:/);
      assert.doesNotMatch(routePlanPrompt, /Parser payload JSON:/);
      assert.doesNotMatch(routePlanPrompt, /Routing JSON:/);
      assert.doesNotMatch(routePlanPrompt, /Original user message:/);
      assert.match(exitCriteriaPrompt, /Clarified request:\nExplain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty\./);
      assert.match(exitCriteriaPrompt, /Science policy:/);
      assert.match(exitCriteriaPrompt, /Allowed tools: literature-search \| web-search/);
      assert.doesNotMatch(exitCriteriaPrompt, /Policy JSON:/);
      assert.doesNotMatch(exitCriteriaPrompt, /Clarification JSON:/);
      assert.doesNotMatch(exitCriteriaPrompt, /Parser payload JSON:/);
      assert.doesNotMatch(exitCriteriaPrompt, /Routing JSON:/);
      assert.doesNotMatch(exitCriteriaPrompt, /Original user message:/);
      assert.match(currentStatePrompt, /Clarified request:\nExplain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty\./);
      assert.match(currentStatePrompt, /Exit criteria:/);
      assert.match(currentStatePrompt, /Pre-synthesized question:/);
      assert.match(currentStatePrompt, /Logical verification:/);
      assert.match(currentStatePrompt, /Context: One targeted source supports a mechanistic escape explanation\./);
      assert.match(currentStatePrompt, /Abductive: unstable - alternatives still open/i);
      assert.match(currentStatePrompt, /Loaded context blocks:/);
      assert.match(currentStatePrompt, /Mechanisms review \| Results/);
      assert.match(currentStatePrompt, /Pathway reactivation restored ERK signaling/i);
      assert.doesNotMatch(currentStatePrompt, /Original user message:/);
      assert.doesNotMatch(currentStatePrompt, /Clarification JSON:/);
      assert.doesNotMatch(currentStatePrompt, /Latest assistant text:/);
      assert.doesNotMatch(currentStatePrompt, /Tool trace JSON:/);
      assert.doesNotMatch(currentStatePrompt, /Citations JSON:/);
      assert.match(judgePrompt, /Clarified request:\nExplain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty\./);
      assert.match(judgePrompt, /Exit criteria:/);
      assert.match(judgePrompt, /Pre-synthesized question:/);
      assert.match(judgePrompt, /Logical verification:/);
      assert.match(judgePrompt, /Pre-synthesized answer: Pathway reactivation and compensatory signaling appear central\./);
      assert.match(judgePrompt, /Abductive: unstable - alternatives still open/i);
      assert.match(judgePrompt, /Loaded context blocks:/);
      assert.match(judgePrompt, /Mechanisms review \| Results/);
      assert.match(judgePrompt, /Pathway reactivation restored ERK signaling/i);
      assert.doesNotMatch(judgePrompt, /Current scientific state JSON:/);
      assert.doesNotMatch(judgePrompt, /Clarification JSON:/);
      assert.doesNotMatch(judgePrompt, /Original user message:/);
      assert.doesNotMatch(judgePrompt, /Latest assistant text:/);
      assert.doesNotMatch(judgePrompt, /Tool trace JSON:/);
      assert.doesNotMatch(judgePrompt, /Citations JSON:/);
      assert.match(synthesisPrompt, /Clarified request:\nExplain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty\./);
      assert.match(synthesisPrompt, /Evaluator summary:/);
      assert.match(synthesisPrompt, /Citations:/);
      assert.match(synthesisPrompt, /Loaded evidence excerpts:/);
      assert.match(synthesisPrompt, /Mechanisms review \| Results/);
      assert.match(synthesisPrompt, /Pathway reactivation restored ERK signaling/i);
      assert.match(synthesisPrompt, /Recent tool outputs:/);
      assert.match(synthesisPrompt, /Markdown is allowed in the final answer\./);
      assert.match(synthesisPrompt, /Respond with the final answer text only\./);
      assert.doesNotMatch(synthesisPrompt, /Original user message:/);
      assert.doesNotMatch(synthesisPrompt, /Clarification JSON:/);
      assert.doesNotMatch(synthesisPrompt, /Parser payload JSON:/);
      assert.doesNotMatch(synthesisPrompt, /Evaluator JSON:/);
      assert.doesNotMatch(synthesisPrompt, /Citations JSON:/);
      assert.doesNotMatch(synthesisPrompt, /Tool trace JSON:/);
      assert.doesNotMatch(synthesisPrompt, /Return JSON only/i);
      assert.match(thinkingTracePrompt, /Tool rounds JSON:/);
      assert.match(routePlanPrompt, /Explain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty\./);
      assert.match(thinkingTracePrompt, /Explain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty\./);
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

    test('science loop exit judge fallback uses only supplied exit criteria as blocking requirements', () => {
      const { createScienceLoopExitJudgeRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'loop-exit-judge.js'));
      const runtime = createScienceLoopExitJudgeRuntime();

      const evaluation = runtime.buildFallbackEvaluation({
        message: 'Explain the assay trend.',
        latestAssistantText: 'The assay trend looks directionally real, but broader review context is still missing.',
        exitCriteria: {
          required_evidence: ['A broader review-style source has been incorporated into the synthesized answer.'],
          exit_conditions: ['The pre-synthesized answer is grounded in the collected evidence.'],
          continue_when: ['Broader review context is still missing from the synthesized answer.'],
          can_exit_with_limitations_when: ['The remaining uncertainty is stated explicitly in the synthesized answer.'],
          preferred_next_tools: ['literature-search']
        },
        toolTrace: [
          {
            tool_name: 'record-lookup',
            ok: true,
            summary: 'Loaded the assay record and attached notes.'
          }
        ],
        latestToolResult: {
          ok: true,
          tool_name: 'record-lookup',
          summary: 'Loaded the assay record and attached notes.'
        },
        preSynthesizedQuestion: {
          tentative_answer: {
            current_best_answer: 'The assay trend looks directionally real, but broader review context is still missing.'
          },
          supporting_basis: [
            'Loaded the assay record and attached notes.'
          ],
          unresolved_issues: [
            'Broader review context is still missing from the synthesized answer.'
          ]
        },
        roundsExecuted: 1,
        maxRounds: 4
      });

      assert.equal(evaluation.satisfied, false);
      assert.equal(evaluation.should_continue, true);
      assert.equal(evaluation.next_tool_hint.tool_name, null);
      assert.equal(evaluation.missing_requirements.includes('A broader review-style source has been incorporated into the synthesized answer.'), true);
      assert.equal(evaluation.missing_requirements.includes('Broader review context is still missing from the synthesized answer.'), true);
      assert.equal(evaluation.missing_requirements.some((item) => /external citation|internal project citation|python sandbox/i.test(String(item))), false);
      assert.equal(evaluation.can_answer_with_limitations, true);
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
          citations: [],
          loaded_context_blocks: [
            {
              paper_id: 'paper-1',
              paper_title: 'Assay comparison note',
              section_label: 'Results',
              excerpt: 'Replicate A tracked the expected upward trend.',
              relevance_reason: 'Supports the provisional interpretation.'
            }
          ]
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
      assert.equal(preSynthesizedQuestion.supporting_basis.some((item) => /Replicate A tracked the expected upward trend/i.test(String(item))), true);
      assert.equal(preSynthesizedQuestion.unresolved_issues.some((item) => /Latest tool issue: Python fit has not been executed yet/i.test(String(item))), true);
      assert.equal(preSynthesizedQuestion.unresolved_issues.some((item) => /No citation-backed evidence has been collected yet/i.test(String(item))), true);
    });

    test('science thinking trace runtime reuses per-step trace sentences without another llm call', async () => {
      const { createScienceThinkingTraceRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'thinking-trace.js'));
      const runtime = createScienceThinkingTraceRuntime();

      const trace = await runtime.generateThinkingTrace({
        intent: 'general_science_question',
        originalMessage: 'Why do tumors stop responding to MAPK inhibitors?',
        clarifiedInput: 'Explain MAPK inhibitor resistance with grounded mechanisms.',
        parserPayload: {
          primary_intent: 'general_science_question',
          reasoning_summary: 'This is a general science question.'
        },
        clarification: {
          trace_sentence: 'I am clarifying the request into an execution-ready science question.'
        },
        routePlan: {
          trace_sentence: 'I am sketching a lightweight route so the loop can start with the most targeted evidence step.'
        },
        exitCriteria: {
          trace_sentence: 'I am defining what evidence would be enough to answer safely.'
        },
        toolRounds: [
          {
            round: 1,
            assistant_before_tool: 'I will start with one focused literature search.',
            tool_name: 'literature-search',
            tool_arguments: {
              query: 'MAPK inhibitor resistance mechanisms'
            },
            tool_summary: 'Retrieved one targeted source.',
            assistant_after_tool: 'I now have one targeted source but may still need broader context.'
          }
        ],
        preSynthesizedQuestion: {
          tentative_answer: {
            current_best_answer: 'Pathway reactivation looks central, but the answer is still provisional.'
          }
        },
        evaluation: {
          reason: 'One broader source is still needed.',
          trace_sentence: 'I am checking whether the current evidence is sufficient or whether one broader source is still needed.'
        },
        finalSynthesis: {
          trace_sentence: 'I am synthesizing the final grounded answer from the evidence collected so far.'
        },
        finalAnswer: 'Resistance often involves pathway reactivation plus compensatory signaling.'
      });

      assert.equal(trace.intent_parse_question, 'This is a general science question.');
      assert.equal(trace.question_clarifier, 'I am clarifying the request into an execution-ready science question.');
      assert.match(String(trace.criteria_generate || ''), /lightweight route/i);
      assert.match(String(trace.criteria_generate || ''), /evidence would be enough/i);
      assert.equal(trace.tool_rounds.length, 1);
      assert.match(trace.tool_rounds[0].tool_call, /investigate "MAPK inhibitor resistance mechanisms"/i);
      assert.equal(trace.judge, 'I am checking whether the current evidence is sufficient or whether one broader source is still needed.');
      assert.equal(trace.final_synthesize, 'I am synthesizing the final grounded answer from the evidence collected so far.');
      assert.equal(trace.final_synthesized_question, 'Explain MAPK inhibitor resistance with grounded mechanisms.');
    });

    test('science loop exit judge runtime uses a sub-agent to return an exit decision', async () => {
      const { createScienceLoopExitJudgeRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'loop-exit-judge.js'));
      const stages = [];
      const runtime = createScienceLoopExitJudgeRuntime({
        requestStructuredJsonPayload: async ({ stage, userPrompt }) => {
          stages.push(stage);
          if (stage === 'science_loop_current_scientific_state') {
            assert.match(String(userPrompt || ''), /Clarified request:\nFit this assay and explain the outliers\./);
            assert.match(String(userPrompt || ''), /Exit criteria:/);
            assert.match(String(userPrompt || ''), /Pre-synthesized question:/);
            assert.match(String(userPrompt || ''), /The assay trend looks real, but I still need a computation-backed fit/i);
            assert.match(String(userPrompt || ''), /Loaded assay data for fitting/i);
            assert.doesNotMatch(String(userPrompt || ''), /Original user message:/);
            assert.doesNotMatch(String(userPrompt || ''), /Clarification JSON:/);
            assert.doesNotMatch(String(userPrompt || ''), /Tool trace JSON:/);
            assert.doesNotMatch(String(userPrompt || ''), /Citations JSON:/);
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
          assert.match(String(userPrompt || ''), /Clarified request:\nFit this assay and explain the outliers\./);
          assert.match(String(userPrompt || ''), /Exit criteria:/);
          assert.match(String(userPrompt || ''), /Pre-synthesized question:/);
          assert.match(String(userPrompt || ''), /The assay trend looks real, but I still need a computation-backed fit/i);
          assert.doesNotMatch(String(userPrompt || ''), /Current scientific state JSON:/);
          assert.doesNotMatch(String(userPrompt || ''), /Clarification JSON:/);
          assert.doesNotMatch(String(userPrompt || ''), /Original user message:/);
          assert.doesNotMatch(String(userPrompt || ''), /Latest assistant text:/);
          assert.doesNotMatch(String(userPrompt || ''), /Tool trace JSON:/);
          assert.doesNotMatch(String(userPrompt || ''), /Citations JSON:/);
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
        evaluateScienceRound: async ({ roundsExecuted, preSynthesizedQuestion, toolTrace }) => {
          evaluationSnapshots.push({
            roundsExecuted,
            preSynthesizedQuestion,
            toolTrace: structuredClone(toolTrace || [])
          });
          if (roundsExecuted === 1) {
            assert.equal(toolOutputBatches.length, 1);
            assert.equal(toolOutputBatches[0].length, 2);
            assert.equal(toolTrace.length, 2);
            assert.equal(toolTrace.every((row) => row.round === 1), true);
            assert.equal(toolTrace.every((row) => row.multi_tool_round === true), true);
            assert.equal(toolTrace.every((row) => row.tool_count_in_round === 2), true);
            assert.match(preSynthesizedQuestion.tentative_answer.current_best_answer, /focused paper and a broader review/i);
            assert.equal(preSynthesizedQuestion.supporting_basis.some((item) => /Retrieved from literature-search \(pubmed\)/i.test(String(item))), true);
            assert.equal(preSynthesizedQuestion.supporting_basis.some((item) => /Retrieved from literature-search \(web\)/i.test(String(item))), true);
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
      assert.match(evaluationSnapshots[0].preSynthesizedQuestion.tentative_answer.current_best_answer, /focused paper and a broader review/i);
      assert.equal(evaluationSnapshots[0].preSynthesizedQuestion.supporting_basis.some((item) => /ERK signaling resumed after MAPK inhibitor escape/i.test(String(item))), true);
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

    test('science reasoning loop retries the tentative inference when logical verification is unstable', async () => {
      const feedbackMessages = [];
      const evaluatedQuestions = [];
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
        verifySciencePreSynthesizedQuestionLogic: async ({ latestAssistantText }) => (
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
        evaluateScienceRound: async ({ preSynthesizedQuestion }) => {
          evaluatedQuestions.push(preSynthesizedQuestion);
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
      assert.equal(evaluatedQuestions.length, 1);
      assert.equal(evaluatedQuestions[0].tentative_answer.current_best_answer, 'Pathway reactivation is supported, but alternatives still remain possible.');
      assert.equal(evaluatedQuestions[0].logical_verification.part_2.some((row) => row.stable === false), false);
      assert.equal(result.intermediate_states.some((state) => state.stage === 'science_inference_retry'), true);
    });

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
      assert.match(capturedSystemPrompt, /Reasoning effort: 0/);
      assert.match(capturedSystemPrompt, /direct answer only/i);
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
                decision_points: [
                  'Refine the query if the first literature pass is too broad or too sparse.'
                ],
                adaptation_notes: [
                  'Treat the route as guidance only.'
                ],
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
      assert.deepEqual(clarificationStages, ['science_input_clarification', 'science_route_planner', 'science_loop_exit_criteria', 'science_loop_logic_extraction']);
      assert.equal(capturedSessionMessage, 'Explain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty.');
      assert.match(capturedSystemPrompt, /Execution hints:/);
      assert.match(capturedSystemPrompt, /Retrieval preference:/);
      assert.match(capturedSystemPrompt, /Preferred tools:/);
      assert.match(capturedSystemPrompt, /The clarified execution request is provided separately as the session message\./);
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
      assert.match(feedbackMessages[0], /Gather deterministic compute evidence before interpreting the result\./i);
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
