'use strict';

function createAgentIntentDispatcher({
  deps,
  cleanText,
  observability,
  protocolNotebookRuntime,
  scienceReasoningLoopRuntime,
  deepResearchRuntime,
  scienceMainUtils,
  agentToolRuntime,
  executeInventoryLookup,
  executeRecordLookup,
  getDefaultDataFilePath,
  lifecycleService
} = {}) {
  const { asArray, createLifecycleToolRunner } = lifecycleService;

  function buildParserDirectScienceResult({
    parserPayload = {},
    routing = {},
    intent = '',
    message = ''
  } = {}) {
    const finalSynthesizedQuestion = cleanText(message, 3200)
      || 'What is the best direct answer to this science question?';
    const fallbackDecisionRecord = {
      assumptions: [
        `${cleanText(intent, 80) || 'science'} was answered directly by the intent parser at reasoning_effort=0.`
      ],
      open_questions: [],
      verification_notes: [
        'No reasoning loop or retrieval tool was executed.'
      ]
    };
    const responseLayer = typeof scienceMainUtils.applyResponseLayerToOutput === 'function'
      ? scienceMainUtils.applyResponseLayerToOutput({
        normalized: {
          answer: cleanText(parserPayload?.direct_answer, 12000)
            || 'No direct answer was returned by the intent parser.',
          confidence: cleanText(intent, 80) === 'general_science_question' ? 0.68 : 0.62,
          citations: [],
          decisionRecord: fallbackDecisionRecord
        },
        routing,
        notebookDraft: null,
        toolTrace: []
      })
      : {
        answer: cleanText(parserPayload?.direct_answer, 12000)
          || 'No direct answer was returned by the intent parser.',
        confidence: cleanText(intent, 80) === 'general_science_question' ? 0.68 : 0.62,
        decisionRecord: fallbackDecisionRecord,
        response_type: 'factual_answer',
        confidence_label: 'medium',
        source_summary: {
          total_sources: 0,
          groups: []
        },
        unresolved_fields: []
      };
    const validated = typeof scienceMainUtils.applyValidationGateToOutput === 'function'
      ? scienceMainUtils.applyValidationGateToOutput({
        routing,
        normalized: responseLayer,
        notebookDraft: null,
        toolTrace: []
      })
      : {
        routing,
        normalized: responseLayer,
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
      };

    return {
      status: 'completed',
      answer: cleanText(validated?.normalized?.answer, 12000),
      execution_mode: 'intent_parser',
      confidence: Number.isFinite(Number(validated?.normalized?.confidence))
        ? Number(validated.normalized.confidence)
        : (cleanText(intent, 80) === 'general_science_question' ? 0.68 : 0.62),
      citations: [],
      decision_record: validated?.normalized?.decisionRecord || fallbackDecisionRecord,
      response_type: cleanText(validated?.normalized?.response_type, 80),
      confidence_label: cleanText(validated?.normalized?.confidence_label, 40),
      source_summary: validated?.normalized?.source_summary && typeof validated.normalized.source_summary === 'object'
        ? validated.normalized.source_summary
        : { total_sources: 0, groups: [] },
      unresolved_fields: asArray(validated?.normalized?.unresolved_fields).map((item) => cleanText(item, 180)).filter(Boolean),
      validation: validated?.validation && typeof validated.validation === 'object'
        ? validated.validation
        : {
          passed: true,
          forced_clarification: false,
          violations: [],
          failure_reasons: []
        },
      provenance: validated?.provenance && typeof validated.provenance === 'object'
        ? validated.provenance
        : {
          source_evidence: [],
          unsupported_statement_count: 0
        },
      rounds_executed: 0,
      follow_up_questions: [],
      reasoning_effort: Number.isFinite(Number(parserPayload?.reasoning_effort))
        ? Number(parserPayload.reasoning_effort)
        : 0,
      thinking_trace: {
        intent_parse_question: cleanText(parserPayload?.reasoning_summary, 420)
          || `This is a ${cleanText(intent, 80).replace(/_/g, ' ') || 'science question'}.`,
        question_clarifier: `The user wants to understand: ${finalSynthesizedQuestion}`,
        criteria_generate: 'I do not need a separate evidence loop for this direct-answer request.',
        tool_rounds: [],
        pre_synthesize_answer: cleanText(parserPayload?.direct_answer, 420)
          || 'I can answer this request directly.',
        judge: 'I can answer this directly without additional tool evidence.',
        final_synthesize: 'I am returning the direct answer without tool use.',
        final_synthesized_question: finalSynthesizedQuestion
      },
      final_synthesized_question: finalSynthesizedQuestion
    };
  }

  function getParserProjectEntityName(parserPayload = {}) {
    return cleanText(
      parserPayload?.entities?.project_name || parserPayload?.entities?.project,
      220
    );
  }

  function parseCompactList(value, max = 12) {
    const source = Array.isArray(value)
      ? value
      : String(value || '').split(/\s*(?:,|;|\n|(?:\band\b)|(?:\bor\b))\s*/i);
    const seen = new Set();
    const output = [];
    source.forEach((item) => {
      const normalized = cleanText(item, 120);
      if (!normalized) {
        return;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key) || output.length >= max) {
        return;
      }
      seen.add(key);
      output.push(normalized);
    });
    return output;
  }

  async function dispatchIntent({
    payload,
    context,
    result
  }) {
    const {
      provider,
      endpoint,
      apiKey,
      model,
      message,
      promptConversation,
      snapshot,
      projectId,
      projectName,
      parserPayload,
      traceContext,
      lifecycleRecorder,
      deepResearchEnabled
    } = context;

    const sessionKey = protocolNotebookRuntime.buildSessionKey({
      projectId,
      projectName,
      parserPayload
    });
    const hasPendingProtocolSession = protocolNotebookRuntime.hasPendingSession(sessionKey);
    const trackedToolRunnerContext = {
      snapshot,
      allowWriteTools: false,
      lifecycleRecorder,
      provider,
      endpoint,
      apiKey,
      model,
      message,
      conversation: promptConversation,
      parserPayload,
      traceContext,
      project: {
        id: cleanText(projectId, 120),
        name: cleanText(projectName || getParserProjectEntityName(parserPayload), 220)
      }
    };

    if (parserPayload.primary_intent === 'protocol_to_notebook') {
      let protocolNotebookResult;
      if (parserPayload.needs_clarification === true) {
        const clarificationQuestion = cleanText(parserPayload.clarification_reason, 280)
          || 'Please provide more detail so I can match the protocol and fill the notebook placeholders.';
        protocolNotebookResult = {
          status: 'needs_more_info',
          candidate_matches: [],
          selected_protocol: null,
          missing_placeholders: [],
          follow_up_questions: [clarificationQuestion],
          project_name: cleanText(projectName || getParserProjectEntityName(parserPayload), 220),
          notebook: null
        };
        protocolNotebookRuntime.setPendingSession(sessionKey, {
          created_at: new Date().toISOString(),
          selected_protocol: null,
          project: {
            id: projectId,
            name: cleanText(projectName || getParserProjectEntityName(parserPayload), 220),
            resolution_source: 'clarification'
          },
          candidate_matches: [],
          known_values: {},
          missing_placeholders: [],
          follow_up_questions: [clarificationQuestion]
        });
      } else {
        protocolNotebookResult = await protocolNotebookRuntime.runFlow({
          provider,
          endpoint,
          apiKey,
          model,
          message,
          conversation: promptConversation,
          snapshot,
          parserPayload,
          projectId,
          projectName,
          traceContext,
          lifecycleRecorder
        });
      }

      result.protocol_to_notebook = protocolNotebookResult;
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'protocol_to_notebook_completed',
        status: cleanText(protocolNotebookResult?.status, 40) === 'completed' ? 'ok' : 'pending',
        routing_intent: 'protocol_to_notebook',
        message: `Protocol-to-notebook status=${cleanText(protocolNotebookResult?.status, 40) || 'unknown'}.`,
        meta: {
          selected_protocol_id: cleanText(protocolNotebookResult?.selected_protocol?.id, 120),
          missing_placeholder_count: asArray(protocolNotebookResult?.missing_placeholders).length
        }
      });
      return result;
    }

    if (hasPendingProtocolSession) {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'protocol_to_notebook_followup',
        status: 'ok',
        routing_intent: cleanText(parserPayload.primary_intent, 80) || 'unclear',
        message: 'Continuing protocol-to-notebook session using follow-up message context.'
      });
      const protocolNotebookResult = await protocolNotebookRuntime.runFlow({
        provider,
        endpoint,
        apiKey,
        model,
        message,
        conversation: promptConversation,
        snapshot,
        parserPayload,
        projectId,
        projectName,
        traceContext,
        lifecycleRecorder
      });
      result.protocol_to_notebook = protocolNotebookResult;
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'protocol_to_notebook_completed',
        status: cleanText(protocolNotebookResult?.status, 40) === 'completed' ? 'ok' : 'pending',
        routing_intent: 'protocol_to_notebook',
        message: `Protocol-to-notebook status=${cleanText(protocolNotebookResult?.status, 40) || 'unknown'}.`,
        meta: {
          selected_protocol_id: cleanText(protocolNotebookResult?.selected_protocol?.id, 120),
          missing_placeholder_count: asArray(protocolNotebookResult?.missing_placeholders).length,
          resumed_from_pending: true
        }
      });
      return result;
    }

    protocolNotebookRuntime.clearPendingSession(sessionKey);

    if (parserPayload.primary_intent === 'inventory_lookup') {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'inventory_lookup_started',
        status: 'started',
        routing_intent: 'inventory_lookup',
        message: 'Executing inventory lookup runtime.'
      });
      if (parserPayload.needs_clarification === true) {
        result.inventory_lookup = {
          status: 'needs_more_info',
          query: '',
          terms_used: [],
          source: 'parser_only',
          backfilled_sql: false,
          items: [],
          follow_up_questions: [
            cleanText(parserPayload.clarification_reason, 280)
              || 'Please provide the sample/reagent name so I can run inventory lookup.'
          ]
        };
      } else {
        const inventoryLookupResult = await executeInventoryLookup({
          message,
          parserPayload,
          snapshot,
          dataFilePath: cleanText(snapshot?.data_file_path, 1600),
          fallbackDataFilePath: getDefaultDataFilePath(),
          limit: 8
        });
        result.inventory_lookup = inventoryLookupResult;
        if (inventoryLookupResult.backfilled_sql === true) {
          observability.recordLifecycleEvent(lifecycleRecorder, {
            stage: 'inventory_lookup_backfilled',
            status: 'ok',
            routing_intent: 'inventory_lookup',
            message: 'SQLite inventory index was backfilled from hydrated snapshot.'
          });
        }
      }
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'inventory_lookup_completed',
        status: cleanText(result.inventory_lookup?.status, 40) === 'matched' ? 'ok' : 'pending',
        routing_intent: 'inventory_lookup',
        message: `Inventory lookup status=${cleanText(result.inventory_lookup?.status, 40) || 'unknown'}.`,
        meta: {
          source: cleanText(result.inventory_lookup?.source, 80),
          item_count: asArray(result.inventory_lookup?.items).length,
          backfilled_sql: result.inventory_lookup?.backfilled_sql === true
        }
      });
      return result;
    }

    if (parserPayload.primary_intent === 'record_lookup') {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'record_lookup_started',
        status: 'started',
        routing_intent: 'record_lookup',
        message: 'Executing project record lookup runtime.'
      });
      if (parserPayload.needs_clarification === true) {
        result.record_lookup = {
          status: 'needs_more_info',
          query: '',
          source: 'parser_only',
          backfilled_sql: false,
          items: [],
          follow_up_questions: [
            cleanText(parserPayload.clarification_reason, 280)
              || 'Please provide what record you want to search (project/protocol/notebook/assay/gel).'
          ]
        };
      } else {
        const recordLookupResult = await executeRecordLookup({
          message,
          parserPayload,
          snapshot,
          dataFilePath: cleanText(snapshot?.data_file_path, 1600),
          fallbackDataFilePath: getDefaultDataFilePath(),
          limit: 8
        });
        result.record_lookup = recordLookupResult;
        if (recordLookupResult.backfilled_sql === true) {
          observability.recordLifecycleEvent(lifecycleRecorder, {
            stage: 'record_lookup_backfilled',
            status: 'ok',
            routing_intent: 'record_lookup',
            message: 'SQLite record index was backfilled from hydrated snapshot.'
          });
        }
      }
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'record_lookup_completed',
        status: cleanText(result.record_lookup?.status, 40) === 'matched' ? 'ok' : 'pending',
        routing_intent: 'record_lookup',
        message: `Record lookup status=${cleanText(result.record_lookup?.status, 40) || 'unknown'}.`,
        meta: {
          source: cleanText(result.record_lookup?.source, 80),
          item_count: asArray(result.record_lookup?.items).length,
          backfilled_sql: result.record_lookup?.backfilled_sql === true
        }
      });
      return result;
    }

    if (parserPayload.primary_intent === 'purchase_recommendation') {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'purchase_recommendation_started',
        status: 'started',
        routing_intent: 'purchase_recommendation',
        message: 'Executing purchase recommendation runtime.'
      });
      if (parserPayload.needs_clarification === true) {
        result.purchase_recommendation = {
          status: 'needs_more_info',
          query: '',
          source: 'parser_only',
          filters: {
            required_terms: [],
            excluded_terms: [],
            budget_preference: ''
          },
          items: [],
          follow_up_questions: [
            cleanText(parserPayload.clarification_reason, 280)
              || 'Please tell me what item you want to buy.'
          ],
          summary: 'More detail is required before I can recommend a purchasable product.'
        };
      } else {
        const runTrackedTool = createLifecycleToolRunner(trackedToolRunnerContext);
        const purchaseRecommendationTool = await runTrackedTool('purchase-recommendation', {
          query: cleanText(parserPayload?.entities?.product_query || message, 600),
          message: cleanText(message, 1200),
          required_terms: parseCompactList(parserPayload?.entities?.required_attributes, 12),
          excluded_terms: parseCompactList(parserPayload?.entities?.excluded_attributes, 12),
          budget_preference: cleanText(parserPayload?.entities?.budget_preference, 80)
        }, {
          allowWriteTools: false
        });
        const toolResult = purchaseRecommendationTool?.result && typeof purchaseRecommendationTool.result === 'object'
          ? purchaseRecommendationTool.result
          : {};
        result.purchase_recommendation = purchaseRecommendationTool?.ok === false
          ? {
            status: 'no_match',
            query: cleanText(parserPayload?.entities?.product_query || message, 320),
            source: 'web',
            filters: {
              required_terms: [],
              excluded_terms: [],
              budget_preference: ''
            },
            items: [],
            follow_up_questions: [
              cleanText(purchaseRecommendationTool?.error, 280)
                || 'The purchase recommendation search could not be completed.'
            ],
            summary: cleanText(purchaseRecommendationTool?.error, 320)
              || 'The purchase recommendation search could not be completed.'
          }
          : toolResult;
      }
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'purchase_recommendation_completed',
        status: cleanText(result.purchase_recommendation?.status, 40) === 'matched' ? 'ok' : 'pending',
        routing_intent: 'purchase_recommendation',
        message: `Purchase recommendation status=${cleanText(result.purchase_recommendation?.status, 40) || 'unknown'}.`,
        meta: {
          source: cleanText(result.purchase_recommendation?.source, 80),
          item_count: asArray(result.purchase_recommendation?.items).length,
          budget_preference: cleanText(result.purchase_recommendation?.filters?.budget_preference, 80)
        }
      });
      return result;
    }

    if (parserPayload.primary_intent === 'notebook_draft') {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'notebook_draft_started',
        status: 'started',
        routing_intent: 'notebook_draft',
        message: 'Executing planned notebook draft runtime.'
      });
      if (parserPayload.needs_clarification === true) {
        result.notebook_draft = {
          status: 'needs_more_info',
          project_name: '',
          selected_protocol: null,
          source_workflow: null,
          missing_placeholders: [],
          follow_up_questions: [
            cleanText(parserPayload.clarification_reason, 280)
              || 'Please tell me which project or workflow should receive the planned notebook draft.'
          ],
          proposal_summary: '',
          proposal: null,
          notebook: null,
          summary: 'More detail is required before planning the next notebook draft.'
        };
        result.notebookDraft = null;
      } else {
        const runTrackedTool = createLifecycleToolRunner(trackedToolRunnerContext);
        const notebookDraftTool = await runTrackedTool('notebook-draft', {
          project: {
            id: cleanText(projectId, 120),
            name: cleanText(projectName, 220)
          },
          protocol_candidates: asArray(parserPayload.protocol_candidates)
        }, {
          allowWriteTools: false
        });
        const toolResult = notebookDraftTool?.result && typeof notebookDraftTool.result === 'object'
          ? notebookDraftTool.result
          : {};
        result.notebook_draft = notebookDraftTool?.ok === false
          ? {
            status: 'needs_more_info',
            project_name: '',
            selected_protocol: null,
            source_workflow: null,
            missing_placeholders: [],
            follow_up_questions: [
              cleanText(notebookDraftTool?.error, 280) || 'The planned notebook draft could not be prepared.'
            ],
            proposal_summary: '',
            proposal: null,
            notebook: null,
            summary: cleanText(notebookDraftTool?.error, 320) || 'The planned notebook draft could not be prepared.'
          }
          : toolResult;
        result.notebookDraft = result.notebook_draft?.notebook && typeof result.notebook_draft.notebook === 'object'
          ? result.notebook_draft.notebook
          : null;
      }
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'notebook_draft_completed',
        status: cleanText(result.notebook_draft?.status, 40) === 'proposal_ready' ? 'ok' : 'pending',
        routing_intent: 'notebook_draft',
        message: `Notebook-draft status=${cleanText(result.notebook_draft?.status, 40) || 'unknown'}.`,
        meta: {
          selected_protocol_id: cleanText(result.notebook_draft?.selected_protocol?.id, 120),
          missing_placeholder_count: asArray(result.notebook_draft?.missing_placeholders).length,
          proposal_id: cleanText(result.notebook_draft?.proposal?.proposal_id, 160)
        }
      });
      return result;
    }

    const routing = scienceMainUtils.buildScienceRoutingFromParser(parserPayload);
    const scienceIntent = cleanText(routing?.intent, 80) || cleanText(parserPayload.primary_intent, 80);
    if ([
      'general_science_question',
      'project_science_question',
      'result_analysis'
    ].includes(scienceIntent)) {
      const parserIntent = cleanText(parserPayload.primary_intent, 80);
      const routingReasoningEffort = Number(routing?.plan?.reasoning_effort);
      const parserDirectScienceAnswer = routingReasoningEffort === 0
        ? cleanText(parserPayload?.direct_answer, 12000)
        : '';
      const runTrackedTool = createLifecycleToolRunner(trackedToolRunnerContext);

      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_intent_start',
        status: 'started',
        routing_intent: scienceIntent,
        message: parserDirectScienceAnswer
          ? `Using parser-direct answer path for ${scienceIntent}.`
          : (parserIntent && parserIntent !== scienceIntent
            ? `Routing ${parserIntent} through ${scienceIntent} with reasoning_effort=${routingReasoningEffort || 0}.`
            : '')
            || (deepResearchEnabled === true && deepResearchRuntime
              ? `Dispatching ${scienceIntent} into the deep research pipeline.`
              : `Dispatching ${scienceIntent} into the shared science reasoning loop.`)
      });

      if (parserDirectScienceAnswer) {
        if (scienceIntent === 'general_science_question') {
          result.general_science_question = buildParserDirectScienceResult({
            parserPayload,
            routing,
            intent: scienceIntent,
            message
          });
        } else {
          result.project_science_question = buildParserDirectScienceResult({
            parserPayload,
            routing,
            intent: scienceIntent,
            message
          });
        }
      } else {
        const resolvedProjectEvidence = scienceIntent === 'project_science_question'
          ? scienceMainUtils.retrieveProjectEvidence({
            message,
            entities: routing.entities,
            selectedProjectId: projectId,
            selectedProjectName: projectName,
            snapshot,
            maxPerSource: 3,
            allowAmbiguousScope: false
          })
          : null;
        const resolvedProject = scienceIntent === 'project_science_question'
          ? (resolvedProjectEvidence?.selected_project && typeof resolvedProjectEvidence.selected_project === 'object'
            ? resolvedProjectEvidence.selected_project
            : (projectId || projectName
              ? {
                id: projectId,
                name: projectName,
                resolution_source: 'controller_context'
              }
              : null))
          : null;
        const scienceInput = {
          provider,
          endpoint,
          apiKey,
          model,
          message,
          conversation: promptConversation,
          hasLatestUserInConversation: true,
          parserPayload,
          routing,
          project: resolvedProject,
          projectEvidence: resolvedProjectEvidence,
          projectResolutionQuestion: resolvedProjectEvidence?.clarification_question,
          snapshot,
          traceContext,
          lifecycleRecorder,
          baseSystemPrompt: agentToolRuntime.buildAgentSystemPrompt(
            context.projectName
              || resolvedProject?.name
              || getParserProjectEntityName(parserPayload),
            {
              agent: {
                skillsCatalogPrompt: cleanText(context?.skillPromptPayload?.skills_catalog_prompt, 16000),
                activeSkillsPrompt: cleanText(context?.skillPromptPayload?.active_skills_prompt, 24000)
              }
            }
          ),
          runTool: async (toolName, args, options = {}) => runTrackedTool(toolName, args, options),
          deepResearchEnabled
        };

        if (deepResearchEnabled === true && deepResearchRuntime) {
          if (scienceIntent === 'general_science_question') {
            result.general_science_question = await deepResearchRuntime.runGeneralScienceQuestion(scienceInput);
          } else if (scienceIntent === 'project_science_question') {
            result.project_science_question = await deepResearchRuntime.runProjectScienceQuestion(scienceInput);
          } else {
            result.result_analysis = await deepResearchRuntime.runResultAnalysis(scienceInput);
          }
        } else if (scienceIntent === 'general_science_question') {
          result.general_science_question = await scienceReasoningLoopRuntime.runGeneralScienceQuestion(scienceInput);
        } else if (scienceIntent === 'project_science_question') {
          result.project_science_question = await scienceReasoningLoopRuntime.runProjectScienceQuestion(scienceInput);
        } else {
          result.result_analysis = await scienceReasoningLoopRuntime.runResultAnalysis(scienceInput);
        }
      }

      const sciencePayload = result.general_science_question
        || result.project_science_question
        || result.result_analysis;
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_intent_completed',
        status: cleanText(sciencePayload?.status, 40) === 'completed' ? 'ok' : 'pending',
        routing_intent: scienceIntent,
        message: `${scienceIntent} status=${cleanText(sciencePayload?.status, 40) || 'unknown'}.`,
        meta: {
          rounds_executed: Number(sciencePayload?.rounds_executed) || 0,
          citation_count: asArray(sciencePayload?.citations).length
        }
      });
    }

    return result;
  }

  return {
    dispatchIntent
  };
}

module.exports = {
  createAgentIntentDispatcher
};
