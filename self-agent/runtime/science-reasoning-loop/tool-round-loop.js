'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../../src/main/helpers/agent/shared/agent-llm-utils.js');
const { isAgentRequestAbortError } = require('../../../src/main/helpers/agent/shared/agent-request-context.js');
const { createScienceToolRoundSatisfactionRuntime } = require('./tool-round-satisfaction.js');

function createScienceToolRoundLoopRuntime(deps = {}) {
  const { asArray, cleanText, uniqueStrings, safeParseJson } = createAgentLlmRuntimeHelpers(deps);
  const extractAgentSessionFunctionCalls = typeof deps.extractAgentSessionFunctionCalls === 'function'
    ? deps.extractAgentSessionFunctionCalls
    : (() => []);
  const extractAgentSessionSchemaRequests = typeof deps.extractAgentSessionSchemaRequests === 'function'
    ? deps.extractAgentSessionSchemaRequests
    : (() => []);
  const extractAgentSessionText = typeof deps.extractAgentSessionText === 'function'
    ? deps.extractAgentSessionText
    : (() => '');
  const continueAgentSessionWithToolOutputs = typeof deps.continueAgentSessionWithToolOutputs === 'function'
    ? deps.continueAgentSessionWithToolOutputs
    : (async (session) => session);
  const continueAgentSessionWithUserMessage = typeof deps.continueAgentSessionWithUserMessage === 'function'
    ? deps.continueAgentSessionWithUserMessage
    : (async (session) => session);
  const recordLifecycleEvent = typeof deps.recordLifecycleEvent === 'function'
    ? deps.recordLifecycleEvent
    : (() => {});
  const askMainAgentToolRoundSatisfaction = typeof deps.askMainAgentToolRoundSatisfaction === 'function'
    ? deps.askMainAgentToolRoundSatisfaction
    : null;

  const {
    checkCurrentToolRoundSatisfaction
  } = createScienceToolRoundSatisfactionRuntime(deps);

  const {
    buildIntermediateState,
    buildSyntheticToolEnvelope,
    normalizeToolCall,
    validateArgumentsAgainstSchema
  } = deps.scienceLoopSupport || {};
  const {
    buildToolRoundThinkingTrace,
    buildRoundToolResult,
    buildToolTraceRenderOutputs
  } = deps.roundHelpers || {};
  const { normalizeCitations, normalizeLoadedContextBlocks } = deps.scienceLoopSupport || {};
  const { evaluateCurrentLoopState, continueAfterUnsatisfiedEvaluation } = deps.preSynthesisController || {};

  function listKnownToolNames(toolSchemaMap) {
    return (typeof toolSchemaMap.getCanonicalNames === 'function'
      ? toolSchemaMap.getCanonicalNames()
      : Array.from(toolSchemaMap.keys())
    ).slice(0, 12).join(', ');
  }

  function resolveCanonicalNameFn(toolSchemaMap) {
    return typeof toolSchemaMap.resolveCanonicalName === 'function'
      ? toolSchemaMap.resolveCanonicalName.bind(toolSchemaMap)
      : ((candidate) => (toolSchemaMap.has(candidate) ? candidate : ''));
  }

  async function runScienceToolRoundLoop(state) {
    const {
      intent, message, maxRounds, maxToolsPerRound,
      toolSchemaMap, toolDefinitionMap, allowedToolNamesLowerSet,
      executeTool, traceContext, lifecycleRecorder
    } = state;

    let schemaHydrationTurns = 0;
    const revealedToolSchemaNames = new Set();

    while (state.roundsExecuted < maxRounds && state.feedbackTurnsWithoutTool < maxRounds) {
      const rawCalls = asArray(extractAgentSessionFunctionCalls(state.currentSession)).map(normalizeToolCall);
      const resolveCanonicalToolName = resolveCanonicalNameFn(toolSchemaMap);
      const schemaRequests = asArray(extractAgentSessionSchemaRequests(state.currentSession))
        .map((request, index) => {
          const source = request && typeof request === 'object' ? request : { name: request };
          const originalName = cleanText(source.name || source.tool_name || source.tool, 120);
          const canonicalName = resolveCanonicalToolName(originalName);
          return {
            callId: cleanText(source.callId || source.call_id || source.id, 120)
              || `tool-schema-request-${state.roundsExecuted + 1}-${index + 1}`,
            originalName,
            name: canonicalName || originalName,
            isKnownTool: Boolean(canonicalName)
          };
        })
        .filter((request) => request.originalName || request.name);

      if (schemaRequests.length && !rawCalls.length) {
        schemaHydrationTurns += 1;
        if (schemaHydrationTurns > Math.max(4, maxRounds * 3)) {
          recordLifecycleEvent(lifecycleRecorder, {
            stage: 'science_tool_schema_budget_exhausted',
            status: 'failed',
            routing_intent: intent,
            message: 'Science reasoning loop exhausted its schema-request budget.',
            meta: { round: state.roundsExecuted }
          });
          break;
        }
        const knownNamesList = listKnownToolNames(toolSchemaMap);
        const schemaOutputs = schemaRequests.slice(0, maxToolsPerRound).map((request) => {
          const toolDefinition = request.isKnownTool ? toolDefinitionMap.get(request.name) : null;
          let output;
          if (!toolDefinition) {
            output = {
              ok: false,
              type: 'tool_schema',
              tool_name: request.originalName || request.name,
              error: `Unknown tool "${request.originalName || request.name}". Use one of the registered tools: ${knownNamesList || '(none available)'}.`
            };
          } else {
            const alreadyProvided = revealedToolSchemaNames.has(request.name.toLowerCase());
            revealedToolSchemaNames.add(request.name.toLowerCase());
            output = {
              ok: true,
              type: 'tool_schema',
              tool_name: request.name,
              already_provided: alreadyProvided,
              short_description: cleanText(toolDefinition.short_description || toolDefinition.description, 500),
              description: cleanText(toolDefinition.detailed_description || toolDefinition.description, 2400),
              input_schema: toolDefinition.parameters && typeof toolDefinition.parameters === 'object'
                ? toolDefinition.parameters
                : { type: 'object', additionalProperties: true, properties: {} }
            };
          }
          return {
            callId: request.callId,
            name: request.name,
            output: JSON.stringify(output)
          };
        });
        recordLifecycleEvent(lifecycleRecorder, {
          stage: 'science_tool_schema_requested',
          status: 'ok',
          routing_intent: intent,
          message: `Provided selected tool schema details for ${schemaOutputs.map((item) => item.name).join(', ')}.`,
          meta: {
            round: state.roundsExecuted,
            tool_names: schemaOutputs.map((item) => cleanText(item.name, 120)).filter(Boolean)
          }
        });
        state.currentSession = await continueAgentSessionWithToolOutputs(state.currentSession, schemaOutputs, traceContext);
        state.latestAssistantText = cleanText(extractAgentSessionText(state.currentSession), 12000);
        continue;
      }

      const canonicalCalls = rawCalls.map((call) => {
        const canonicalName = resolveCanonicalToolName(call.name);
        return {
          ...call,
          originalName: call.name,
          name: canonicalName || call.name,
          isKnownTool: Boolean(canonicalName)
        };
      });
      const validCalls = canonicalCalls.filter((call) => call.isKnownTool);
      const unknownCalls = canonicalCalls.filter((call) => !call.isKnownTool);

      if (!validCalls.length) {
        if (unknownCalls.length > 0) {
          const knownNamesList = listKnownToolNames(toolSchemaMap);
          const syntheticOutputs = unknownCalls.map((call) => {
            const parsedArgs = safeParseJson(call.argsText || '{}', {});
            const argsObject = parsedArgs && typeof parsedArgs === 'object' ? parsedArgs : {};
            return {
              callId: call.callId,
              name: call.originalName || call.name,
              output: JSON.stringify(buildSyntheticToolEnvelope(
                call.originalName || call.name,
                argsObject,
                state.roundsExecuted,
                `Unknown tool "${call.originalName || call.name}". Use one of the registered tools: ${knownNamesList || '(none available)'}.`
              ))
            };
          });
          state.currentSession = await continueAgentSessionWithToolOutputs(state.currentSession, syntheticOutputs, traceContext);
          state.latestAssistantText = cleanText(extractAgentSessionText(state.currentSession), 12000);
          state.feedbackTurnsWithoutTool += 1;
          if (state.roundsExecuted >= maxRounds || state.feedbackTurnsWithoutTool >= maxRounds) {
            recordLifecycleEvent(lifecycleRecorder, {
              stage: 'science_budget_exhausted',
              status: 'failed',
              routing_intent: intent,
              message: 'Science reasoning loop exhausted its budget after repeated unknown-tool attempts.',
              meta: { round: state.roundsExecuted }
            });
            break;
          }
          continue;
        }

        await evaluateCurrentLoopState(state, {
          latestToolResult: null,
          includePreSynthesisState: false
        });

        if (state.finalEvaluation.satisfied === true) {
          recordLifecycleEvent(lifecycleRecorder, {
            stage: 'science_evaluator_satisfied',
            status: 'ok',
            routing_intent: intent,
            message: cleanText(state.finalEvaluation.reason, 320) || 'Evaluator marked current evidence as sufficient.',
            meta: {
              round: state.roundsExecuted,
              thinking_trace: cleanText(state.finalEvaluation?.trace_sentence, 420)
            }
          });
          break;
        }
        if (state.finalEvaluation?.should_continue === false) {
          recordLifecycleEvent(lifecycleRecorder, {
            stage: 'science_evaluator_stop',
            status: 'ok',
            routing_intent: intent,
            message: cleanText(state.finalEvaluation.reason, 320)
              || 'Evaluator requested to stop the loop without additional tool rounds.',
            meta: {
              round: state.roundsExecuted,
              thinking_trace: cleanText(state.finalEvaluation?.trace_sentence, 420)
            }
          });
          break;
        }
        state.feedbackTurnsWithoutTool += 1;
        if (!(await continueAfterUnsatisfiedEvaluation(state))) {
          break;
        }
        continue;
      }

      state.feedbackTurnsWithoutTool = 0;
      const selectedCalls = validCalls.slice(0, maxToolsPerRound).map((call) => {
        const parsedArgs = safeParseJson(call.argsText || '{}', {});
        const argsObject = parsedArgs && typeof parsedArgs === 'object' ? parsedArgs : {};
        return {
          ...call,
          argsObject,
          validation: validateArgumentsAgainstSchema(toolSchemaMap.get(call.name), argsObject)
        };
      });
      const deferredValidCalls = validCalls.slice(maxToolsPerRound).map((call) => {
        const parsedArgs = safeParseJson(call.argsText || '{}', {});
        const argsObject = parsedArgs && typeof parsedArgs === 'object' ? parsedArgs : {};
        return { ...call, argsObject };
      });
      const unknownResolvedCalls = unknownCalls.map((call) => {
        const parsedArgs = safeParseJson(call.argsText || '{}', {});
        const argsObject = parsedArgs && typeof parsedArgs === 'object' ? parsedArgs : {};
        return { ...call, argsObject };
      });
      const multiToolRound = selectedCalls.length > 1;
      const truncatedMultiCall = deferredValidCalls.length > 0;
      const assistantBeforeTool = cleanText(state.latestAssistantText, 4000);
      state.roundsExecuted += 1;
      const selectedToolNames = selectedCalls.map((call) => cleanText(call.name, 120)).filter(Boolean);

      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'science_round_started',
        status: 'started',
        routing_intent: intent,
        tool_name: multiToolRound ? 'parallel-tool-round' : selectedToolNames[0],
        message: `Science reasoning round ${state.roundsExecuted} started with ${selectedToolNames.join(', ')}.`,
        meta: {
          round: state.roundsExecuted,
          multi_tool_round: multiToolRound,
          tool_count: selectedCalls.length,
          tool_names: selectedToolNames,
          truncated_multi_call: truncatedMultiCall,
          thinking_trace: buildToolRoundThinkingTrace(selectedCalls)
        }
      });

      const executedCalls = await Promise.all(selectedCalls.map(async (selectedCall, index) => {
        let toolEnvelope;
        if (!selectedCall.validation.ok) {
          toolEnvelope = buildSyntheticToolEnvelope(
            selectedCall.name,
            selectedCall.argsObject,
            state.roundsExecuted,
            cleanText(selectedCall.validation.error, 320) || 'Tool arguments failed schema validation.'
          );
        } else if (!allowedToolNamesLowerSet.has(selectedCall.name.toLowerCase())) {
          toolEnvelope = buildSyntheticToolEnvelope(
            selectedCall.name,
            selectedCall.argsObject,
            state.roundsExecuted,
            `Tool ${selectedCall.name} is not allowed for ${intent}.`
          );
        } else {
          try {
            toolEnvelope = await executeTool(selectedCall.name, selectedCall.argsObject, {
              allowWriteTools: false,
              traceContext,
              lifecycleRecorder
            });
          } catch (error) {
            if (isAgentRequestAbortError(error)) {
              throw error;
            }
            toolEnvelope = buildSyntheticToolEnvelope(
              selectedCall.name,
              selectedCall.argsObject,
              state.roundsExecuted,
              cleanText(String(error?.message || error), 320) || 'Tool execution failed.'
            );
          }
        }
        return {
          selectedCall,
          toolEnvelope,
          tool_index_in_round: index + 1,
          tool_count_in_round: selectedCalls.length
        };
      }));
      const roundToolResult = buildRoundToolResult(executedCalls);
      const roundEvidence = normalizeCitations(roundToolResult?.citations, 8);
      const roundSucceeded = executedCalls.some((entry) => entry?.toolEnvelope?.ok === true);

      executedCalls.forEach((entry) => {
        const selectedCall = entry.selectedCall;
        const toolEnvelope = entry.toolEnvelope;
        const normalizedTraceRow = {
          round: state.roundsExecuted,
          call_id: selectedCall.callId,
          tool_name: cleanText(selectedCall.name, 120),
          input: selectedCall.argsObject,
          ok: toolEnvelope?.ok === true,
          status: cleanText(toolEnvelope?.result?.status, 40),
          run_id: cleanText(toolEnvelope?.result?.run_id, 120),
          summary: cleanText(toolEnvelope?.summary, 320)
            || cleanText(toolEnvelope?.error, 320)
            || 'No summary was generated.',
          multi_tool_round: multiToolRound,
          tool_index_in_round: entry.tool_index_in_round,
          tool_count_in_round: entry.tool_count_in_round,
          truncated_multi_call: truncatedMultiCall,
          error: cleanText(toolEnvelope?.error || toolEnvelope?.result?.error, 1200),
          stdout: cleanText(toolEnvelope?.result?.stdout, 12000),
          stderr: cleanText(toolEnvelope?.result?.stderr, 12000),
          render_outputs: buildToolTraceRenderOutputs(toolEnvelope?.result?.render_outputs),
          citations: normalizeCitations(toolEnvelope?.citations || toolEnvelope?.result?.citations, 8),
          loaded_context_blocks: normalizeLoadedContextBlocks(
            toolEnvelope?.loaded_context_blocks || toolEnvelope?.result?.loaded_context_blocks,
            6
          )
        };
        state.toolTrace.push(normalizedTraceRow);
        normalizedTraceRow.citations.forEach((citation) => {
          const source = cleanText(citation?.source, 120).toLowerCase();
          const pointer = cleanText(citation?.pointer, 220).toLowerCase();
          if (!source && !pointer) {
            return;
          }
          const key = `${source}::${pointer}`;
          if (!state.accumulatedCitationKeys.has(key)) {
            state.accumulatedCitationKeys.add(key);
            state.accumulatedCitations.push(citation);
          }
        });
      });

      state.intermediateStates.push(buildIntermediateState(
        'science_tool_round',
        multiToolRound
          ? `Executed ${selectedCalls.length} tools in round ${state.roundsExecuted}.`
          : `Executed ${selectedToolNames[0]} in round ${state.roundsExecuted}.`,
        {
          assumptions: [
            multiToolRound
              ? `Executed ${selectedCalls.length} independent tool calls in parallel for this round.`
              : `Executed ${selectedToolNames[0]} for this round.`,
            truncatedMultiCall
              ? `Additional valid tool calls were deferred because the round hit the per-round cap of ${maxToolsPerRound}.`
              : '',
            roundSucceeded
              ? 'This round returned usable tool evidence.'
              : 'This round did not return usable tool evidence.'
          ].filter(Boolean),
          evidence: roundEvidence,
          proposed_actions: executedCalls.slice(0, 4).map((entry) => ({
            action_type: 'read',
            tool_name: cleanText(entry?.selectedCall?.name, 120),
            risk_level: 'low',
            reason: cleanText(entry?.toolEnvelope?.summary || entry?.toolEnvelope?.error, 260)
          })).filter((entry) => entry.tool_name || entry.reason),
          confidence: roundSucceeded ? 0.66 : 0.42
        }
      ));

      const knownNamesListForRound = listKnownToolNames(toolSchemaMap);
      const deferredSyntheticOutputs = deferredValidCalls.map((call) => ({
        callId: call.callId,
        name: call.name,
        output: JSON.stringify(buildSyntheticToolEnvelope(
          call.name,
          call.argsObject,
          state.roundsExecuted,
          `Tool call deferred: per-round cap of ${maxToolsPerRound} was reached. Re-issue this call on the next turn if still needed.`
        ))
      }));
      const unknownSyntheticOutputs = unknownResolvedCalls.map((call) => ({
        callId: call.callId,
        name: call.originalName || call.name,
        output: JSON.stringify(buildSyntheticToolEnvelope(
          call.originalName || call.name,
          call.argsObject,
          state.roundsExecuted,
          `Unknown tool "${call.originalName || call.name}". Use one of the registered tools: ${knownNamesListForRound || '(none available)'}.`
        ))
      }));
      state.currentSession = await continueAgentSessionWithToolOutputs(state.currentSession, [
        ...executedCalls.map((entry) => ({
          callId: entry.selectedCall.callId,
          name: entry.selectedCall.name,
          output: JSON.stringify(entry.toolEnvelope || {})
        })),
        ...deferredSyntheticOutputs,
        ...unknownSyntheticOutputs
      ], traceContext);
      state.latestAssistantText = cleanText(extractAgentSessionText(state.currentSession), 12000);
      state.toolRoundArtifacts.push({
        round: state.roundsExecuted,
        tool_name: multiToolRound ? 'parallel-tool-round' : cleanText(selectedToolNames[0], 120),
        tool_arguments: multiToolRound ? { tool_names: selectedToolNames } : selectedCalls[0]?.argsObject,
        tool_calls: executedCalls.map((entry) => ({
          tool_name: cleanText(entry?.selectedCall?.name, 120),
          tool_arguments: entry?.selectedCall?.argsObject,
          tool_summary: cleanText(entry?.toolEnvelope?.summary, 600),
          tool_error: cleanText(entry?.toolEnvelope?.error || entry?.toolEnvelope?.result?.error, 1200)
        })),
        assistant_before_tool: assistantBeforeTool,
        tool_summary: cleanText(roundToolResult?.summary, 600),
        tool_error: cleanText(roundToolResult?.error, 1200),
        assistant_after_tool: cleanText(state.latestAssistantText, 4000)
      });
      const assistantAfterToolRound = cleanText(state.latestAssistantText, 12000);
      const toolRoundSatisfaction = await checkCurrentToolRoundSatisfaction({
        askMainAgentToolRoundSatisfaction,
        continueAgentSessionWithUserMessage,
        extractAgentSessionText,
        extractAgentSessionFunctionCalls,
        normalizeToolCall,
        toolSchemaMap,
        session: state.currentSession,
        assistantTextForRound: assistantAfterToolRound,
        roundsExecuted: state.roundsExecuted,
        maxRounds,
        traceContext
      });
      if (state.toolRoundArtifacts.length) {
        state.toolRoundArtifacts[state.toolRoundArtifacts.length - 1].main_agent_satisfaction = {
          satisfied: toolRoundSatisfaction.satisfied === true,
          reason: cleanText(toolRoundSatisfaction.reason, 320)
        };
      }
      state.intermediateStates.push(buildIntermediateState(
        'science_tool_round_satisfaction',
        toolRoundSatisfaction.satisfied === true
          ? 'Main agent committed to a synthesis-ready answer after the latest tool round.'
          : 'Main agent committed to another tool round before synthesizing.',
        {
          assumptions: [
            cleanText(toolRoundSatisfaction.reason, 320)
              || (
                toolRoundSatisfaction.satisfied === true
                  ? 'The model produced a synthesis-ready draft instead of another tool call.'
                  : 'The model emitted another tool call instead of a synthesis-ready draft.'
              )
          ],
          evidence: roundEvidence,
          open_questions: toolRoundSatisfaction.satisfied === true
            ? []
            : uniqueStrings([
              'Another tool round is queued before synthesis.'
            ], 4),
          confidence: toolRoundSatisfaction.satisfied === true
            ? (roundSucceeded ? 0.66 : 0.54)
            : 0.44
        }
      ));
      recordLifecycleEvent(lifecycleRecorder, {
        stage: toolRoundSatisfaction.satisfied === true
          ? 'science_tool_round_satisfied'
          : 'science_tool_round_unsatisfied',
        status: toolRoundSatisfaction.satisfied === true ? 'ok' : 'started',
        routing_intent: intent,
        tool_name: multiToolRound ? 'parallel-tool-round' : selectedToolNames[0],
        message: cleanText(toolRoundSatisfaction.reason, 320)
          || (
            toolRoundSatisfaction.satisfied === true
              ? 'Main agent committed to a synthesis-ready answer.'
              : 'Main agent committed to another tool round before synthesizing.'
          ),
        meta: {
          round: state.roundsExecuted,
          tool_names: selectedToolNames,
          pending_tool_names: asArray(toolRoundSatisfaction.pendingValidToolCalls)
            .map((call) => cleanText(call?.name, 120))
            .filter(Boolean),
          thinking_trace: cleanText(toolRoundSatisfaction.trace_sentence, 420)
        }
      });
      if (toolRoundSatisfaction.satisfied !== true && state.roundsExecuted < maxRounds) {
        state.currentSession = toolRoundSatisfaction.session || state.currentSession;
        state.latestAssistantText = cleanText(toolRoundSatisfaction.latestAssistantText, 12000) || assistantAfterToolRound;
        continue;
      }
      await evaluateCurrentLoopState(state, {
        latestToolResult: roundToolResult,
        includePreSynthesisState: true
      });
      if (state.toolRoundArtifacts.length) {
        state.toolRoundArtifacts[state.toolRoundArtifacts.length - 1].assistant_after_tool = cleanText(state.latestAssistantText, 4000);
      }

      if (state.finalEvaluation.satisfied === true) {
        recordLifecycleEvent(lifecycleRecorder, {
          stage: 'science_evaluator_satisfied',
          status: 'ok',
          routing_intent: intent,
          tool_name: multiToolRound ? 'parallel-tool-round' : selectedToolNames[0],
          message: cleanText(state.finalEvaluation.reason, 320) || 'Evaluator marked current evidence as sufficient.',
          meta: {
            round: state.roundsExecuted,
            tool_names: selectedToolNames,
            thinking_trace: cleanText(state.finalEvaluation?.trace_sentence, 420)
          }
        });
        break;
      }

      if (state.finalEvaluation?.should_continue === false) {
        recordLifecycleEvent(lifecycleRecorder, {
          stage: 'science_evaluator_stop',
          status: 'ok',
          routing_intent: intent,
          tool_name: multiToolRound ? 'parallel-tool-round' : selectedToolNames[0],
          message: cleanText(state.finalEvaluation.reason, 320)
            || 'Evaluator requested to stop the loop without additional tool rounds.',
          meta: {
            round: state.roundsExecuted,
            tool_names: selectedToolNames,
            thinking_trace: cleanText(state.finalEvaluation?.trace_sentence, 420)
          }
        });
        break;
      }

      if (!(await continueAfterUnsatisfiedEvaluation(state))) {
        break;
      }
    }
  }

  return { runScienceToolRoundLoop };
}

module.exports = {
  createScienceToolRoundLoopRuntime
};
