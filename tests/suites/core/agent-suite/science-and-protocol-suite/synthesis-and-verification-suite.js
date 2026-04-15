module.exports = function registerSynthesisAndVerificationSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
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
        accumulatedCitations: [{ source: 'pubmed', pointer: 'PMID:1', reason: 'Mechanism paper.' }],
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
  }
};
