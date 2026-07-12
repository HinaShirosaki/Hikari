module.exports = function registerRoutePlanningSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('science loop exit criteria runtime generates structured criteria with llm output', async () => {
      const { createScienceLoopExitCriteriaRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'loop-exit-criteria.js'));
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
              required_evidence: ['One computation-backed evidence step is required.'],
              continue_when: ['The requested computation has not been executed yet.'],
              can_exit_with_limitations_when: ['A best-effort answer is acceptable if the missing context is stated explicitly.'],
              preferred_next_tools: ['python-sandbox', 'notebook-lookup'],
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
          tool_scope: ['python-sandbox', 'notebook-lookup']
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
      const { createAgentRoutePlannerRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'agent-route-planner.js'));
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
              decision_points: ['If the first paper is too narrow, refine the search before answering.'],
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
      const { createAgentRoutePlannerRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'agent-route-planner.js'));
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

    test('science route planner prompt and fallback preserve trailing allowed retrieval tools', () => {
      const { createAgentRoutePlannerRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'agent-route-planner.js'));
      const runtime = createAgentRoutePlannerRuntime();
      const allowedToolNames = [
        'inventory-lookup',
        'notebook-lookup',
        'protocol-matching',
        'notebook-generation',
        'notebook-draft',
        'python-sandbox',
        'web-search',
        'literature-search'
      ];

      const prompt = runtime.buildRoutePlanPrompt({
        intent: 'general_science_question',
        reasoningEffort: 1,
        message: 'What is sgRNA?',
        clarifiedInput: 'Explain what sgRNA is with grounded citations.',
        allowedToolNames
      });
      const fallback = runtime.buildFallbackRoutePlan({
        intent: 'general_science_question',
        message: 'What is sgRNA?',
        clarifiedInput: 'Explain what sgRNA is with grounded citations.',
        allowedToolNames
      });

      assert.match(
        prompt,
        /Allowed tools: inventory-lookup \| notebook-lookup \| protocol-matching \| notebook-generation \| notebook-draft \| python-sandbox \| web-search \| literature-search/
      );
      assert.deepEqual(
        fallback.tool_call_suggestions.map((item) => item.tool_name),
        allowedToolNames
      );
    });

    test('science exit criteria prompt and fallback preserve trailing allowed retrieval tools', () => {
      const { createScienceLoopExitCriteriaRuntime } = require(path.join(__dirname, 'self-agent', 'runtime', 'science-reasoning-loop', 'loop-exit-criteria.js'));
      const runtime = createScienceLoopExitCriteriaRuntime();
      const allowedToolNames = [
        'inventory-lookup',
        'notebook-lookup',
        'protocol-matching',
        'notebook-generation',
        'notebook-draft',
        'python-sandbox',
        'web-search',
        'literature-search'
      ];

      const prompt = runtime.buildExitCriteriaPrompt({
        intent: 'general_science_question',
        message: 'What is sgRNA?',
        clarifiedInput: 'Explain what sgRNA is with grounded citations.',
        allowedToolNames
      });
      const fallback = runtime.buildFallbackExitCriteria({
        intent: 'general_science_question',
        message: 'What is sgRNA?',
        clarifiedInput: 'Explain what sgRNA is with grounded citations.',
        allowedToolNames
      });

      assert.match(
        prompt,
        /Allowed tools: inventory-lookup \| notebook-lookup \| protocol-matching \| notebook-generation \| notebook-draft \| python-sandbox \| web-search \| literature-search/
      );
      assert.deepEqual(fallback.preferred_next_tools, allowedToolNames);
    });
  }
};
