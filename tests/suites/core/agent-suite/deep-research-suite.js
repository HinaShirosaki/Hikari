module.exports = function registerAgentDeepResearchSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('deep research step 1 clarifies a request with deterministic fallback', async () => {
      const { runStep1ClarifyQuestion } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'step-1-clarify-question.js'));
      const result = await runStep1ClarifyQuestion({
        intent: 'project_science_question',
        message: 'Compare the latest Atlas expression results and recommend the next experiment.'
      });
      assert.equal(result.request_type, 'comparative');
      assert.equal(result.time_sensitive, true);
      assert.equal(result.research_goal.includes('Atlas expression results'), true);
    });

    test('deep research step 2 asks one blocking follow-up for unresolved project scope', async () => {
      const { runStep2AskTargetedFollowUp } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'step-2-ask-targeted-follow-up.js'));
      const result = await runStep2AskTargetedFollowUp({
        intent: 'project_science_question',
        message: 'Why did expression drop in this project?',
        clarifyResult: {
          research_goal: 'Why did expression drop in this project?',
          missing_constraints: ['project scope'],
          should_ask_follow_up: true
        }
      });
      assert.equal(result.needs_follow_up, true);
      assert.match(String(result.question || ''), /Which project/i);
    });

    test('deep research step 3 drafts a structured fallback research plan', async () => {
      const { runStep3DraftResearchPlan } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'step-3-draft-research-plan.js'));
      const result = await runStep3DraftResearchPlan({
        intent: 'general_science_question',
        message: 'What drives MAPK inhibitor resistance?',
        clarifyResult: {
          research_goal: 'What drives MAPK inhibitor resistance?',
          request_type: 'analytical',
          time_sensitive: false
        },
        policy: {
          tool_scope: ['literature-search', 'sub-agent']
        }
      });
      assert.equal(result.goal, 'What drives MAPK inhibitor resistance?');
      assert.equal(result.key_subquestions.length >= 3, true);
      assert.equal(result.possible_tools_or_sources.includes('literature-search'), true);
      assert.equal(result.synthesis_checkpoints.length >= 2, true);
    });

    test('deep research context control preserves rolling summaries and section buffers', () => {
      const contextControl = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'context-control.js'));
      let state = contextControl.createContextControlState({
        objective_summary: 'Investigate expression drift.'
      });
      state = contextControl.updateContextControlState(state, {
        round: 1,
        tool_name: 'literature-search',
        tool_summary: 'Found two review papers.',
        evidence_rows: [
          { source: 'literature-search', pointer: 'paper-1', reason: 'Review evidence.' }
        ],
        section_buffers: [
          {
            section: 'Key Evidence',
            evidence: [{ source: 'literature-search', pointer: 'paper-1', reason: 'Review evidence.' }]
          }
        ]
      });
      const snapshot = contextControl.buildContextControlSnapshot(state, {
        maxEvidence: 5,
        maxSections: 3
      });
      assert.match(String(snapshot.rolling_summary || ''), /Investigate expression drift/i);
      assert.equal(snapshot.evidence_buffer.length, 1);
      assert.equal(snapshot.section_buffers[0].section, 'Key Evidence');
    });

    test('deep research accuracy preservation deduplicates citations and keeps uncertainty markers', () => {
      const accuracy = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'accuracy-preservation.js'));
      let state = accuracy.createAccuracyPreservationState();
      state = accuracy.updateAccuracyPreservationState(state, {
        citations: [
          { source: 'literature-search', pointer: 'paper-1', reason: 'Primary review.' },
          { source: 'literature-search', pointer: 'paper-1', reason: 'Duplicate review.' }
        ],
        assistant_text: 'The mechanism may involve compensatory signaling, but the evidence is limited.'
      });
      const snapshot = accuracy.buildAccuracyPreservationSnapshot(state);
      assert.equal(snapshot.citations.length, 1);
      assert.equal(snapshot.uncertainty_markers.length >= 1, true);
      assert.equal(snapshot.load_bearing_claims.length, 1);
    });

    test('deep research sub-agent usage rules and completion checker return deterministic fallback decisions', async () => {
      const subAgentUsage = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'sub-agent-usage.js'));
      assert.equal(subAgentUsage.shouldDelegateSubAgent({
        allowedToolNames: ['literature-search', 'sub-agent'],
        researchPlan: {
          key_subquestions: ['A', 'B', 'C']
        },
        roundsExecuted: 0,
        maxRounds: 4,
        toolTrace: []
      }), true);

      const check = await subAgentUsage.runCompletionCheck({
        intent: 'project_science_question',
        roundsExecuted: 0,
        maxRounds: 4,
        researchPlan: {
          possible_tools_or_sources: ['record-lookup', 'literature-search']
        },
        toolTrace: [],
        citations: []
      });
      assert.equal(check.satisfied, false);
      assert.equal(check.should_continue, true);
      assert.match(String(check.reason || ''), /No evidence|Internal project evidence/i);
    });

    test('deep research final synthesis quality helpers build outline and validate rendered sections', () => {
      const synthesisQuality = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'final-synthesis-quality.js'));
      const outline = synthesisQuality.buildDefaultAnswerOutline({
        intent: 'result_analysis',
        researchObjective: {
          request_type: 'analytical'
        }
      });
      const sectionEvidenceMap = synthesisQuality.mapEvidenceToOutlineSections({
        outline,
        citations: [
          { source: 'record-lookup', pointer: 'note-1', reason: 'Internal observation.' }
        ],
        accuracySnapshot: {
          contradictions: ['Signal was inconsistent across repeats.'],
          uncertainty_markers: ['Evidence remains limited.']
        },
        completionCheck: {
          missing_requirements: ['Need one more replicate.']
        }
      });
      const validation = synthesisQuality.validateSynthesisSections({
        outline,
        renderedSections: outline.sections.map((section) => ({
          section_id: section.id,
          text: `Rendered ${section.title}`
        }))
      });
      assert.equal(outline.sections.length >= 4, true);
      assert.equal(sectionEvidenceMap.length, outline.sections.length);
      assert.equal(validation.complete, true);
    });

    test('deep research step 4 executes one planned tool round and preserves citations', async () => {
      const { runStep4ExecutePlan } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'step-4-execute-plan.js'));
      const contextControl = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'context-control.js'));
      const accuracy = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'accuracy-preservation.js'));
      const subAgentUsage = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'sub-agent-usage.js'));
      let actionCalls = 0;
      const result = await runStep4ExecutePlan({
        intent: 'general_science_question',
        message: 'What drives MAPK inhibitor resistance?',
        parserPayload: {},
        researchObjective: {
          research_goal: 'What drives MAPK inhibitor resistance?'
        },
        researchPlan: {
          key_subquestions: ['Mechanism', 'Evidence'],
          possible_tools_or_sources: ['literature-search'],
          answer_sections: ['Direct Answer', 'Key Evidence']
        },
        runTool: async (toolName, args) => ({
          ok: true,
          tool_name: toolName,
          input: args,
          items: [{ id: 'paper-1', title: 'Resistance review' }],
          citations: [
            { source: 'literature-search', pointer: 'paper-1', reason: 'Review evidence.' }
          ],
          summary: 'Found one review paper.'
        }),
        runCompletionCheck: async () => ({
          satisfied: true,
          reason: 'Enough evidence for synthesis.',
          missing_requirements: [],
          should_continue: false,
          can_answer_with_limitations: true,
          next_action: null,
          delegate_sub_agent: false
        }),
        createContextControlState: contextControl.createContextControlState,
        updateContextControlState: contextControl.updateContextControlState,
        buildContextControlSnapshot: contextControl.buildContextControlSnapshot,
        createAccuracyPreservationState: accuracy.createAccuracyPreservationState,
        updateAccuracyPreservationState: accuracy.updateAccuracyPreservationState,
        buildAccuracyPreservationSnapshot: accuracy.buildAccuracyPreservationSnapshot,
        shouldDelegateSubAgent: subAgentUsage.shouldDelegateSubAgent,
        buildSubAgentInstruction: subAgentUsage.buildSubAgentInstruction
      }, {
        resolveToolDefinitions: () => [{
          name: 'literature-search',
          description: 'Search literature',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['query'],
            properties: {
              query: { type: 'string' }
            }
          }
        }],
        requestStructuredJsonPayload: async ({ stage }) => {
          if (stage === 'deep_research_step_4_next_action') {
            actionCalls += 1;
            return {
              ok: true,
              payload: {
                action: 'tool',
                reason: 'Need external evidence.',
                assistant_note: 'Run literature search first.',
                tool_name: 'literature-search',
                arguments: {
                  query: 'MAPK inhibitor resistance'
                },
                answer_fragment: null
              }
            };
          }
          return { ok: false, error: 'Unexpected stage.' };
        }
      });
      assert.equal(actionCalls, 1);
      assert.equal(result.rounds_executed, 1);
      assert.equal(result.tool_trace.length, 1);
      assert.equal(result.tool_trace[0].tool_name, 'literature-search');
      assert.equal(result.citations.length, 1);
      assert.equal(result.context_snapshot.evidence_buffer.length, 1);
    });

    test('deep research step 5 assembles the answer from an outline and rendered sections', async () => {
      const { runStep5AssembleFinalAnswer } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'step-5-assemble-final-answer.js'));
      const synthesisQuality = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'final-synthesis-quality.js'));
      const result = await runStep5AssembleFinalAnswer({
        intent: 'general_science_question',
        researchObjective: {
          research_goal: 'What drives MAPK inhibitor resistance?',
          request_type: 'analytical'
        },
        researchPlan: {
          answer_sections: ['Direct Answer', 'Key Evidence', 'Uncertainty and Gaps']
        },
        executionResult: {
          latest_assistant_text: 'Resistance often involves pathway reactivation.',
          citations: [
            { source: 'literature-search', pointer: 'paper-1', reason: 'Review evidence.' }
          ],
          completion_check: {
            missing_requirements: ['Need one more confirmatory source.']
          },
          accuracy_snapshot: {
            contradictions: ['Some reports emphasize bypass signaling.']
          }
        },
        buildDefaultAnswerOutline: synthesisQuality.buildDefaultAnswerOutline,
        mapEvidenceToOutlineSections: synthesisQuality.mapEvidenceToOutlineSections,
        validateSynthesisSections: synthesisQuality.validateSynthesisSections
      });
      assert.equal(result.answer_outline.sections.length >= 3, true);
      assert.equal(result.rendered_sections.length, result.answer_outline.sections.length);
      assert.match(String(result.answer || ''), /Direct Answer|Recommendation/);
      assert.equal(result.section_evidence_map.length, result.answer_outline.sections.length);
    });

    test('deep research runtime runs step 3 before step 4 and returns a compatible response envelope', async () => {
      const { createDeepResearchRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'deep-research', 'index.js'));
      const runtime = createDeepResearchRuntime({
        resolveToolDefinitions: () => [{
          name: 'literature-search',
          description: 'Search literature',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['query'],
            properties: {
              query: { type: 'string' }
            }
          }
        }],
        requestStructuredJsonPayload: async ({ stage }) => {
          if (stage === 'deep_research_step_4_next_action') {
            return {
              ok: true,
              payload: {
                action: 'tool',
                reason: 'Need external grounding.',
                assistant_note: 'Search the literature first.',
                tool_name: 'literature-search',
                arguments: {
                  query: 'MAPK inhibitor resistance'
                },
                answer_fragment: null
              }
            };
          }
          return {
            ok: false,
            error: 'Fallback path requested.'
          };
        },
        applyResponseLayerToOutput: ({ normalized }) => ({
          ...normalized,
          response_type: 'grounded_answer',
          confidence_label: 'medium',
          source_summary: {
            total_sources: Array.isArray(normalized.citations) ? normalized.citations.length : 0,
            groups: []
          },
          unresolved_fields: []
        }),
        applyValidationGateToOutput: ({ normalized }) => ({
          normalized,
          validation: {
            passed: true,
            forced_clarification: false,
            violations: [],
            failure_reasons: []
          },
          provenance: {
            source_evidence: [],
            unsupported_statement_count: 0
          }
        })
      });

      const result = await runtime.runGeneralScienceQuestion({
        provider: 'openai',
        endpoint: 'https://example.test',
        apiKey: 'key',
        model: 'gpt-test',
        message: 'What drives MAPK inhibitor resistance?',
        conversation: [],
        parserPayload: {
          primary_intent: 'general_science_question',
          needs_clarification: false,
          clarification_reason: null,
          entities: {}
        },
        routing: {
          intent: 'general_science_question',
          confidence: 0.62,
          entities: {},
          plan: {}
        },
        runTool: async (toolName, args) => ({
          ok: true,
          tool_name: toolName,
          input: args,
          items: [{ id: 'paper-1', title: 'Resistance review' }],
          citations: [
            { source: 'literature-search', pointer: 'paper-1', reason: 'Review evidence.' }
          ],
          summary: 'Found one review paper.'
        })
      });

      const step3Index = result.intermediate_states.findIndex((item) => String(item.stage || '') === 'step_3_plan');
      const step4Index = result.intermediate_states.findIndex((item) => String(item.stage || '') === 'step_4_execute');
      assert.equal(step3Index >= 0, true);
      assert.equal(step4Index > step3Index, true);
      assert.equal(result.execution_mode, 'deep_research');
      assert.equal(Array.isArray(result.citations), true);
      assert.equal(typeof result.answer, 'string');
    });
  }
};
