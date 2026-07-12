module.exports = function registerPromptAndFallbackSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('agent system prompt can include a paper rail session prompt', () => {
      const { createAgentRuntimeSupport } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'runtime',
        'agent-runtime-support.js'
      ));
      const runtime = createAgentRuntimeSupport({
        renderPromptTemplate: (template, vars = {}) => String(template || '').replace('{{projectScope}}', vars.projectScope || '')
      });
      const systemPrompt = runtime.buildAgentSystemPrompt('Atlas', {
        agent: {
          sessionPrompt: 'Paper agent session: read the transformed markdown paper.md before answering.'
        }
      });
      assert.match(systemPrompt, /Scoped project: Atlas/);
      assert.match(systemPrompt, /Paper agent session/);
      assert.match(systemPrompt, /transformed markdown paper\.md/);
    });

    test('science prompt builders render compact summaries instead of JSON payload blocks', () => {
      const { createScienceLoopSupport } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'support.js'));
      const { createScienceInputClarificationRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'input-clarification.js'));
      const { createAgentRoutePlannerRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'agent-route-planner.js'));
      const { createScienceLoopExitCriteriaRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'loop-exit-criteria.js'));
      const { createScienceLoopExitJudgeRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'loop-exit-judge.js'));
      const { createScienceFinalSynthesisRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'final-synthesis.js'));
      const { createScienceThinkingTraceRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'thinking-trace.js'));

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
      const preSynthesizedAnswer = {
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
      const judgePrompt = judgeRuntime.buildJudgeMessage({
        intent: 'general_science_question',
        exitCriteria,
        preSynthesizedAnswer,
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
        preSynthesizedAnswer,
        evaluation,
        status: 'partial',
        finalAnswer: 'Pathway reactivation and compensatory signaling are likely important.'
      });

      assert.match(systemPrompt, /Execution hints:/);
      assert.match(systemPrompt, /Preferred tools:/);
      assert.match(systemPrompt, /The clarified execution request is provided separately as the session message\./);
      assert.doesNotMatch(systemPrompt, /Intent:/);
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
      assert.match(judgePrompt, /Clarified request:\nExplain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty\./);
      assert.match(judgePrompt, /Exit criteria:/);
      assert.match(judgePrompt, /Pre-synthesized answer:/);
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
      assert.match(synthesisPrompt, /Use the collected evidence and tool trace as provenance anchors\./);
      assert.match(synthesisPrompt, /stable background knowledge needed to answer/i);
      assert.match(synthesisPrompt, /Keep caveats proportionate/i);
      assert.doesNotMatch(synthesisPrompt, /Original user message:/);
      assert.doesNotMatch(synthesisPrompt, /Clarification JSON:/);
      assert.doesNotMatch(synthesisPrompt, /Parser payload JSON:/);
      assert.doesNotMatch(synthesisPrompt, /Evaluator JSON:/);
      assert.doesNotMatch(synthesisPrompt, /Citations JSON:/);
      assert.doesNotMatch(synthesisPrompt, /Tool trace JSON:/);
      assert.doesNotMatch(synthesisPrompt, /Return JSON only/i);
      assert.doesNotMatch(synthesisPrompt, /Answer using only the evidence and tool trace/i);
      assert.match(thinkingTracePrompt, /Tool rounds JSON:/);
      assert.match(routePlanPrompt, /Explain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty\./);
      assert.match(thinkingTracePrompt, /Explain MAPK inhibitor resistance with literature-backed mechanisms and note any uncertainty\./);
    });

    test('science fallback exit criteria stay generic and do not inject intent-specific evidence requirements', () => {
      const { createScienceLoopExitCriteriaRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'loop-exit-criteria.js'));
      const { createScienceLoopExitJudgeRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'loop-exit-judge.js'));

      const criteriaRuntime = createScienceLoopExitCriteriaRuntime({
        requestStructuredJsonPayload: async () => ({ ok: false, error: 'force fallback' })
      });
      const judgeRuntime = createScienceLoopExitJudgeRuntime();

      const generalCriteria = criteriaRuntime.buildFallbackExitCriteria({
        intent: 'general_science_question',
        message: 'What are the latest findings on MAPK inhibitor resistance?',
        clarifiedInput: 'What are the latest findings on MAPK inhibitor resistance?',
        policy: {
          tool_scope: ['literature-search', 'web-search']
        }
      });
      assert.equal(generalCriteria.required_evidence.some((item) => /external citation-backed source/i.test(String(item))), false);
      assert.equal(generalCriteria.continue_when.some((item) => /blocking gap remains/i.test(String(item))), true);

      const projectCriteria = criteriaRuntime.buildFallbackExitCriteria({
        intent: 'project_science_question',
        message: 'Why did Atlas expression drop after transfection?',
        clarifiedInput: 'Why did Atlas expression drop after transfection?'
      });
      assert.equal(projectCriteria.required_evidence.some((item) => /internal project-linked source/i.test(String(item))), false);
      assert.equal(projectCriteria.continue_when.some((item) => /blocking gap remains/i.test(String(item))), true);

      const analysisCriteria = criteriaRuntime.buildFallbackExitCriteria({
        intent: 'result_analysis',
        message: 'Calculate the fold change from 2 to 4.',
        clarifiedInput: 'Calculate the fold change from 2 to 4.',
        policy: {
          require_compute_for_numeric_queries: true
        }
      });
      assert.equal(analysisCriteria.required_evidence.some((item) => /deterministic computation/i.test(String(item))), false);
      assert.equal(analysisCriteria.continue_when.some((item) => /blocking gap remains/i.test(String(item))), true);

      const generalFallback = judgeRuntime.buildFallbackEvaluation({
        intent: 'general_science_question',
        message: 'What are the latest findings on MAPK inhibitor resistance?',
        exitCriteria: {
          required_evidence: [],
          continue_when: ['A blocking evidence gap still prevents a grounded answer.'],
          preferred_next_tools: ['literature-search']
        },
        toolTrace: [{ tool_name: 'notebook-lookup', ok: true }],
        citations: [],
        roundsExecuted: 1,
        maxRounds: 4
      });
      assert.equal(generalFallback.missing_requirements.some((item) => /external citation-backed source/i.test(String(item))), false);

      const projectFallback = judgeRuntime.buildFallbackEvaluation({
        intent: 'project_science_question',
        message: 'Why did Atlas expression drop after transfection?',
        exitCriteria: {
          required_evidence: [],
          continue_when: ['A blocking evidence gap still prevents a grounded answer.'],
          preferred_next_tools: ['notebook-lookup']
        },
        toolTrace: [{ tool_name: 'notebook-lookup', ok: true }],
        citations: [],
        roundsExecuted: 1,
        maxRounds: 4
      });
      assert.equal(projectFallback.missing_requirements.some((item) => /internal project citation/i.test(String(item))), false);

      const analysisFallback = judgeRuntime.buildFallbackEvaluation({
        intent: 'result_analysis',
        message: 'Calculate the fold change from 2 to 4.',
        exitCriteria: {
          required_evidence: [],
          continue_when: ['A blocking evidence gap still prevents a grounded answer.'],
          preferred_next_tools: ['notebook-lookup']
        },
        toolTrace: [{ tool_name: 'notebook-lookup', ok: true }],
        citations: [],
        roundsExecuted: 1,
        maxRounds: 4
      });
      assert.equal(analysisFallback.missing_requirements.some((item) => /python sandbox computation step/i.test(String(item))), false);
    });
  }
};
