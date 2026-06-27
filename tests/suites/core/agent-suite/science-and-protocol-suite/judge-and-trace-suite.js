module.exports = function registerJudgeAndTraceSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('science loop exit judge prompt checks sufficiency instead of reflexive conservatism', () => {
      const { createScienceLoopExitJudgeRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'loop-exit-judge.js'));
      const runtime = createScienceLoopExitJudgeRuntime();
      const systemPrompt = runtime.buildJudgeSystemPrompt();

      assert.match(systemPrompt, /Judge sufficiency, not perfection/i);
      assert.match(systemPrompt, /Continue only when a missing requirement is truly blocking/i);
      assert.match(systemPrompt, /Do not require exhaustive literature coverage/i);
      assert.match(systemPrompt, /citation-backed anchors plus well-established background knowledge can be enough/i);
      assert.doesNotMatch(systemPrompt, /Be conservative/i);
    });

    test('science loop exit judge message carries the last 20 supporting basis and context entries', () => {
      const { createScienceLoopExitJudgeRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'loop-exit-judge.js'));
      const runtime = createScienceLoopExitJudgeRuntime();
      const labels = Array.from({ length: 21 }, (_, index) => String(index + 1).padStart(2, '0'));
      const message = runtime.buildJudgeMessage({
        message: 'Explain rabbit antibody maturation in GALT.',
        exitCriteria: {
          exit_conditions: ['The answer explains the main mechanism.'],
          required_evidence: [],
          continue_when: [],
          can_exit_with_limitations_when: [],
          preferred_next_tools: []
        },
        preSynthesizedAnswer: {
          tentative_answer: {
            current_best_answer: 'Rabbit GALT diversification is explainable from the gathered evidence.'
          },
          supporting_basis: labels.map((label) => `basis-${label}`),
          unresolved_issues: []
        },
        toolTrace: labels.map((label) => ({
          tool_name: `tool-${label}`,
          ok: true,
          summary: `summary-${label}`,
          loaded_context_blocks: [{
            paper_title: `Paper ${label}`,
            section_label: 'Abstract',
            excerpt: `excerpt-${label}`,
            relevance_reason: `reason-${label}`
          }]
        })),
        roundsExecuted: 21,
        maxRounds: 21
      });

      assert.doesNotMatch(message, /basis-01\b/);
      assert.match(message, /basis-02\b/);
      assert.match(message, /basis-21\b/);
      assert.doesNotMatch(message, /excerpt-01\b/);
      assert.match(message, /excerpt-02\b/);
      assert.match(message, /excerpt-21\b/);
    });

    test('science loop exit judge fallback uses only supplied exit criteria as blocking requirements', () => {
      const { createScienceLoopExitJudgeRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'loop-exit-judge.js'));
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
        preSynthesizedAnswer: {
          tentative_answer: {
            current_best_answer: 'The assay trend looks directionally real, but broader review context is still missing.'
          },
          supporting_basis: ['Loaded the assay record and attached notes.'],
          unresolved_issues: ['Broader review context is still missing from the synthesized answer.']
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

    test('science loop pre-synthesized answer runtime compacts the current best answer, basis, and gaps', () => {
      const { createScienceLoopPreSynthesizedAnswerRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'pre-synthesized-answer.js'));
      const runtime = createScienceLoopPreSynthesizedAnswerRuntime();

      const preSynthesizedAnswer = runtime.buildPreSynthesizedAnswer({
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

      assert.equal(preSynthesizedAnswer.tentative_answer.current_best_answer, 'The assay trend looks directionally real, but the answer is still provisional.');
      assert.equal(preSynthesizedAnswer.supporting_basis.some((item) => /Located the assay record/i.test(String(item))), true);
      assert.equal(preSynthesizedAnswer.supporting_basis.some((item) => /Replicate A tracked the expected upward trend/i.test(String(item))), true);
      assert.equal(preSynthesizedAnswer.unresolved_issues.some((item) => /Latest tool issue: Python fit has not been executed yet/i.test(String(item))), true);
      assert.equal(preSynthesizedAnswer.unresolved_issues.some((item) => /No citation-backed evidence has been collected yet/i.test(String(item))), true);
    });

    test('science thinking trace runtime reuses per-step trace sentences without another llm call', async () => {
      const { createScienceThinkingTraceRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'thinking-trace.js'));
      const runtime = createScienceThinkingTraceRuntime();

      const trace = await runtime.generateThinkingTrace({
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
        preSynthesizedAnswer: {
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
      const { createScienceLoopExitJudgeRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'loop-exit-judge.js'));
      const stages = [];
      const runtime = createScienceLoopExitJudgeRuntime({
        requestStructuredJsonPayload: async ({ stage, userPrompt }) => {
          stages.push(stage);
          assert.equal(stage, 'science_loop_exit_judge_sub_agent');
          assert.match(String(userPrompt || ''), /Clarified request:\nFit this assay and explain the outliers\./);
          assert.match(String(userPrompt || ''), /Exit criteria:/);
          assert.match(String(userPrompt || ''), /Pre-synthesized answer:/);
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

      assert.deepEqual(stages, ['science_loop_exit_judge_sub_agent']);
      assert.equal(judged.evaluation.satisfied, false);
      assert.equal(judged.evaluation.should_continue, true);
      assert.equal(judged.evaluation.next_tool_hint.tool_name, 'python-sandbox');
      assert.equal(judged.pre_synthesized_answer.tentative_answer.current_best_answer, 'The assay trend looks real, but I still need a computation-backed fit.');
      assert.equal(judged.pre_synthesized_answer.supporting_basis.some((item) => /Loaded assay data for fitting/i.test(String(item))), true);
      assert.equal(judged.sub_agent !== null, true);
      assert.equal(judged.sub_agent.last_response.output.satisfied, false);
    });
  }
};
