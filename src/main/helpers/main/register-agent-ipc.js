'use strict';

function registerAgentIpc(deps = {}) {
  const ipcMain = deps.ipcMain;
  const controllerUtils = deps.controllerUtils || {};
  const observability = deps.observability || {};
  const protocolNotebookRuntime = deps.protocolNotebookRuntime;
  const scienceReasoningLoopRuntime = deps.scienceReasoningLoopRuntime;
  const deepResearchRuntime = deps.deepResearchRuntime;
  const scienceMainUtils = deps.scienceMainUtils || {};
  const agentToolRuntime = deps.agentToolRuntime || {};
  const agentChatLogRuntime = deps.agentChatLogRuntime;
  const agentToolSmokeTestRuntime = deps.agentToolSmokeTestRuntime;
  const executeInventoryLookup = deps.executeInventoryLookup;
  const executeRecordLookup = deps.executeRecordLookup;
  const getAgentChatLogPath = deps.getAgentChatLogPath;
  const getAgentChatSessionStoragePath = deps.getAgentChatSessionStoragePath;

  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, maxLength = 2000) => {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      if (text.length <= maxLength) {
        return text;
      }
      return `${text.slice(0, maxLength)}...`;
    });

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeJsonPayload(payload, fallback = {}) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload;
    }
    try {
      const parsed = JSON.parse(String(payload || ''));
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function createLifecycleToolRunner({
    snapshot,
    allowWriteTools = false,
    lifecycleRecorder
  }) {
    return async (toolName, args, options = {}) => {
      const normalizedArgs = typeof agentToolRuntime.normalizeToolInvocationArgs === 'function'
        ? agentToolRuntime.normalizeToolInvocationArgs(args)
        : args;
      const effectiveAllowWrite = options?.allowWriteTools === true || allowWriteTools === true;
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'tool_call_started',
        status: 'started',
        tool_name: toolName,
        tool_args: normalizedArgs,
        message: `Started tool call for ${cleanText(toolName, 120) || 'unknown_tool'}.`
      });
      try {
        const result = await agentToolRuntime.runAgentTool(toolName, normalizedArgs, snapshot, {
          ...options,
          allowWriteTools: effectiveAllowWrite,
          requestId: cleanText(lifecycleRecorder?.requestId, 80)
        });
        if (result?.ok === false) {
          observability.recordLifecycleEvent(lifecycleRecorder, {
            stage: 'tool_call_failed',
            status: 'failed',
            tool_name: toolName,
            tool_args: normalizedArgs,
            tool_output: result,
            message: cleanText(result?.error || result?.summary, 320) || 'Tool call returned an error envelope.'
          });
        } else {
          observability.recordLifecycleEvent(lifecycleRecorder, {
            stage: 'tool_call_completed',
            status: 'ok',
            tool_name: toolName,
            tool_args: normalizedArgs,
            tool_output: result,
            message: cleanText(result?.summary, 280) || 'Tool call completed.'
          });
        }
        return result;
      } catch (error) {
        const message = cleanText(String(error?.message || error), 320) || 'Tool call failed.';
        observability.recordLifecycleEvent(lifecycleRecorder, {
          stage: 'tool_call_failed',
          status: 'failed',
          tool_name: toolName,
          tool_args: normalizedArgs,
          message
        });
        throw error;
      }
    };
  }

  async function flushLifecycleRecorderEvents(logPath, lifecycleRecorder) {
    const recorder = lifecycleRecorder && typeof lifecycleRecorder === 'object'
      ? lifecycleRecorder
      : null;
    if (!recorder) {
      return;
    }
    const start = Number.isFinite(Number(recorder.flushed_count))
      ? Number(recorder.flushed_count)
      : 0;
    const events = asArray(recorder.events);
    for (let index = start; index < events.length; index += 1) {
      await deps.appendAgentChatLogEntry(logPath, controllerUtils.formatAgentChatLogEntry(events[index]));
    }
    recorder.flushed_count = events.length;
  }

  async function runAgentControllerCore(payload, runtime = {}) {
    const lifecycleRecorder = runtime && typeof runtime === 'object'
      ? runtime.lifecycleRecorder
      : null;
    const message = cleanText(payload?.message, 3000);
    if (!message) {
      throw new Error('Message is required.');
    }

    const provider = controllerUtils.resolveAgentProvider(payload?.llm);
    const endpoint = controllerUtils.resolveAgentEndpoint(payload?.llm, provider);
    const model = controllerUtils.resolveAgentModel(payload?.llm, provider);
    const apiKey = provider === deps.LLM_PROVIDERS.CODEX ? '' : controllerUtils.resolveAgentApiKey(payload?.llm);
    if (provider !== deps.LLM_PROVIDERS.CODEX && !apiKey) {
      throw new Error('Missing LLM API key. Set it in Settings > LLM Model & API, or use LLM_API_KEY / ENANA_LLM_API_KEY.');
    }
    const conversation = controllerUtils.extractConversation(payload?.conversation);
    const hasLatestUserInConversation = Boolean(
      conversation.length > 0
      && conversation[conversation.length - 1].role === 'user'
      && conversation[conversation.length - 1].text === message
    );
    const rawSnapshot = normalizeJsonPayload(payload?.stateSnapshot, {});
    const snapshot = agentToolRuntime.normalizeAgentSnapshot(rawSnapshot);
    const executionFlags = controllerUtils.resolveAgentExecutionFlags(payload, { settings: rawSnapshot?.settings || {} });
    const deepResearchEnabled = payload?.agent?.deepResearchEnabled === true;
    const traceContext = controllerUtils.createAgentLlmTraceContext({
      enabled: executionFlags.developerMode === true,
      requestId: cleanText(runtime?.requestId, 80),
      logPath: getAgentChatLogPath(),
      provider,
      model
    });
    const projectId = cleanText(payload?.projectId, 80);
    const projectName = cleanText(payload?.projectName, 180);
    const promptConversation = hasLatestUserInConversation
      ? conversation
      : [...conversation, { role: 'user', text: message }];

    observability.recordLifecycleEvent(lifecycleRecorder, {
      stage: 'controller_intent_only',
      status: 'ok',
      message: 'Running parser-first intent phraser pipeline.'
    });

    const parserResult = await controllerUtils.requestIntentParserPayload({
      provider,
      endpoint,
      apiKey,
      model,
      message,
      conversation: promptConversation,
      projectName,
      traceContext
    });
    if (!parserResult?.ok || !parserResult?.payload) {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'parser_completed',
        status: 'failed',
        message: cleanText(parserResult?.error || 'Malformed parser output.', 320),
        failure_reasons: ['intent_parser_failed']
      });
      return {
        ok: false,
        provider,
        model: model || (provider === deps.LLM_PROVIDERS.CODEX ? 'codex-default' : ''),
        error: cleanText(`Intent parser failed: ${parserResult?.error || 'Malformed parser output.'}`, 360)
      };
    }
    observability.recordLifecycleEvent(lifecycleRecorder, {
      stage: 'parser_completed',
      status: 'ok',
      routing_intent: cleanText(parserResult.payload.primary_intent, 80) || 'unclear',
      message: `Intent parser returned primary_intent=${cleanText(parserResult.payload.primary_intent, 80) || 'unknown'}.`,
      meta: {
        needs_clarification: parserResult.payload.needs_clarification === true
      }
    });

    const result = {
      ok: true,
      parser: parserResult.payload
    };
    const sessionKey = protocolNotebookRuntime.buildSessionKey({
      projectId,
      projectName,
      parserPayload: parserResult.payload
    });
    const hasPendingProtocolSession = protocolNotebookRuntime.hasPendingSession(sessionKey);

    if (parserResult.payload.primary_intent === 'protocol_to_notebook') {
      let protocolNotebookResult;
      if (parserResult.payload.needs_clarification === true) {
        const clarificationQuestion = cleanText(parserResult.payload.clarification_reason, 280)
          || 'Please provide more detail so I can match the protocol and fill the notebook placeholders.';
        protocolNotebookResult = {
          status: 'needs_more_info',
          candidate_matches: [],
          selected_protocol: null,
          missing_placeholders: [],
          follow_up_questions: [clarificationQuestion],
          project_name: cleanText(projectName || parserResult.payload?.entities?.project_name, 220),
          notebook: null
        };
        protocolNotebookRuntime.setPendingSession(sessionKey, {
          created_at: new Date().toISOString(),
          selected_protocol: null,
          project: {
            id: projectId,
            name: cleanText(projectName || parserResult.payload?.entities?.project_name, 220),
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
          parserPayload: parserResult.payload,
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
    } else if (hasPendingProtocolSession) {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'protocol_to_notebook_followup',
        status: 'ok',
        routing_intent: cleanText(parserResult.payload.primary_intent, 80) || 'unclear',
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
        parserPayload: parserResult.payload,
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
    } else {
      protocolNotebookRuntime.clearPendingSession(sessionKey);
      if (parserResult.payload.primary_intent === 'inventory_lookup') {
        observability.recordLifecycleEvent(lifecycleRecorder, {
          stage: 'inventory_lookup_started',
          status: 'started',
          routing_intent: 'inventory_lookup',
          message: 'Executing inventory lookup runtime.'
        });
        if (parserResult.payload.needs_clarification === true) {
          result.inventory_lookup = {
            status: 'needs_more_info',
            query: '',
            terms_used: [],
            source: 'parser_only',
            backfilled_sql: false,
            items: [],
            follow_up_questions: [
              cleanText(parserResult.payload.clarification_reason, 280)
                || 'Please provide the sample/reagent name so I can run inventory lookup.'
            ]
          };
        } else {
          const inventoryLookupResult = await executeInventoryLookup({
            message,
            parserPayload: parserResult.payload,
            snapshot,
            dataFilePath: cleanText(snapshot?.data_file_path, 1600),
            fallbackDataFilePath: deps.getDefaultDataFilePath(),
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
      } else if (parserResult.payload.primary_intent === 'record_lookup') {
        observability.recordLifecycleEvent(lifecycleRecorder, {
          stage: 'record_lookup_started',
          status: 'started',
          routing_intent: 'record_lookup',
          message: 'Executing project record lookup runtime.'
        });
        if (parserResult.payload.needs_clarification === true) {
          result.record_lookup = {
            status: 'needs_more_info',
            query: '',
            source: 'parser_only',
            backfilled_sql: false,
            items: [],
            follow_up_questions: [
              cleanText(parserResult.payload.clarification_reason, 280)
                || 'Please provide what record you want to search (project/protocol/notebook/assay/gel).'
            ]
          };
        } else {
          const recordLookupResult = await executeRecordLookup({
            message,
            parserPayload: parserResult.payload,
            snapshot,
            dataFilePath: cleanText(snapshot?.data_file_path, 1600),
            fallbackDataFilePath: deps.getDefaultDataFilePath(),
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
      } else if ([
        'general_science_question',
        'project_science_question',
        'result_analysis'
      ].includes(parserResult.payload.primary_intent)) {
        const scienceIntent = cleanText(parserResult.payload.primary_intent, 80);
        const routing = scienceMainUtils.buildScienceRoutingFromParser(parserResult.payload);
        const runTrackedTool = createLifecycleToolRunner({
          snapshot,
          allowWriteTools: false,
          lifecycleRecorder
        });
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

        observability.recordLifecycleEvent(lifecycleRecorder, {
          stage: 'science_intent_start',
          status: 'started',
          routing_intent: scienceIntent,
          message: deepResearchEnabled === true && deepResearchRuntime
            ? `Dispatching ${scienceIntent} into the deep research pipeline.`
            : `Dispatching ${scienceIntent} into the shared science reasoning loop.`
        });

        const scienceInput = {
          provider,
          endpoint,
          apiKey,
          model,
          message,
          conversation: promptConversation,
          hasLatestUserInConversation: true,
          parserPayload: parserResult.payload,
          routing,
          project: resolvedProject,
          projectEvidence: resolvedProjectEvidence,
          projectResolutionQuestion: resolvedProjectEvidence?.clarification_question,
          snapshot,
          traceContext,
          lifecycleRecorder,
          baseSystemPrompt: agentToolRuntime.buildAgentSystemPrompt(
            projectName
              || resolvedProject?.name
              || parserResult.payload?.entities?.project_name,
            null
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
    }

    if (executionFlags.developerMode === true) {
      result.developer_trace = asArray(traceContext?.rows);
    }
    return result;
  }

  async function runAgentController(payload, runtime = {}) {
    const lifecycleRecorder = runtime && typeof runtime === 'object'
      ? runtime.lifecycleRecorder
      : null;
    observability.recordLifecycleEvent(lifecycleRecorder, {
      stage: 'controller_intent_only_selected',
      status: 'ok',
      message: 'Using intent-only parser controller path.'
    });
    return runAgentControllerCore(payload, { ...runtime });
  }

  ipcMain.handle('agent:chat', async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const executionFlags = controllerUtils.resolveAgentExecutionFlags(
      normalizedPayload,
      normalizeJsonPayload(normalizedPayload?.stateSnapshot, {})
    );
    const requestId = controllerUtils.buildAgentLogRequestId();
    const logPath = getAgentChatLogPath();
    const chatSessionStoragePath = getAgentChatSessionStoragePath(normalizedPayload);
    const requestedChatSessionId = cleanText(normalizedPayload?.chatSessionId || normalizedPayload?.sessionId, 120);
    const requestTimestamp = new Date().toISOString();
    const lifecycleRecorder = observability.createLifecycleRecorder({ requestId });
    let chatSession = null;

    const appendChatSessionRowsSafe = async (rows = []) => {
      if (!chatSessionStoragePath || !chatSession?.id) {
        return;
      }
      try {
        const appended = await agentChatLogRuntime.appendRows(chatSessionStoragePath, chatSession.id, rows);
        if (appended?.session && typeof appended.session === 'object') {
          chatSession = appended.session;
        }
      } catch (error) {
        console.error('Failed to append agent chat session rows:', error);
      }
    };

    const ensureChatSessionSafe = async () => {
      if (!chatSessionStoragePath) {
        return null;
      }
      try {
        const ensured = await agentChatLogRuntime.ensureSession({
          storagePath: chatSessionStoragePath,
          sessionId: requestedChatSessionId,
          title: cleanText(normalizedPayload?.message, 220) || 'New Chat',
          projectId: cleanText(normalizedPayload?.projectId, 80),
          projectName: cleanText(normalizedPayload?.projectName, 180)
        });
        chatSession = ensured?.session && typeof ensured.session === 'object'
          ? ensured.session
          : null;
        return chatSession;
      } catch (error) {
        console.error('Failed to ensure agent chat session:', error);
        return null;
      }
    };

    await ensureChatSessionSafe();
    observability.recordLifecycleEvent(lifecycleRecorder, {
      stage: 'request_received',
      status: 'ok',
      message: cleanText(normalizedPayload?.message, 320),
      meta: {
        project_id: cleanText(normalizedPayload?.projectId, 80),
        project_name: cleanText(normalizedPayload?.projectName, 180),
        allow_write_tools: normalizedPayload?.allowWriteTools === true,
        provider: cleanText(normalizedPayload?.llm?.provider, 80),
        developer_mode: executionFlags.developerMode === true,
        deep_research_enabled: normalizedPayload?.agent?.deepResearchEnabled === true
      }
    });
    const requestLogEntry = controllerUtils.formatAgentChatLogEntry({
      type: 'agent-chat-request',
      requestId,
      timestamp: requestTimestamp,
      projectId: cleanText(normalizedPayload?.projectId, 80),
      projectName: cleanText(normalizedPayload?.projectName, 180),
      dataFilePath: cleanText(
        normalizedPayload?.stateSnapshot?.data_file_path || normalizedPayload?.stateSnapshot?.dataFilePath,
        1600
      ),
      allowWriteTools: normalizedPayload?.allowWriteTools === true,
      message: cleanText(normalizedPayload?.message, 3000),
      conversation: controllerUtils.extractConversation(normalizedPayload?.conversation),
      llm: controllerUtils.summarizeLlmForAgentLog(normalizedPayload?.llm),
      agent: {
        developerMode: executionFlags.developerMode === true,
        deepResearchEnabled: normalizedPayload?.agent?.deepResearchEnabled === true
      }
    });
    await deps.appendAgentChatLogEntry(logPath, requestLogEntry);
    if (chatSession?.id) {
      await appendChatSessionRowsSafe([
        {
          type: 'user-message',
          session_id: chatSession.id,
          message_id: `user-${requestId}`,
          timestamp: requestTimestamp,
          text: cleanText(normalizedPayload?.message, 24000),
          project_id: cleanText(normalizedPayload?.projectId, 80),
          project_name: cleanText(normalizedPayload?.projectName, 180)
        },
        {
          ...requestLogEntry,
          session_id: chatSession.id
        }
      ]);
    }

    try {
      const result = await runAgentController(normalizedPayload, {
        requestId,
        lifecycleRecorder
      });
      const failureReasons = observability.classifyFailureReasons({
        result,
        lifecycleEvents: lifecycleRecorder.events
      });
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'response_emitted',
        status: result?.ok === true ? 'ok' : 'error',
        response_type: result?.protocol_to_notebook
          ? 'protocol_to_notebook'
          : (result?.inventory_lookup
            ? 'inventory_lookup'
            : (result?.record_lookup
              ? 'record_lookup'
              : (result?.general_science_question
                ? 'general_science_question'
                : (result?.project_science_question
                  ? 'project_science_question'
                  : (result?.result_analysis ? 'result_analysis' : 'intent_parser'))))),
        routing_intent: cleanText(result?.parser?.primary_intent, 80) || 'unclear',
        failure_reasons: failureReasons,
        message: result?.ok === true
          ? 'Agent response emitted to renderer.'
          : cleanText(result?.error, 320) || 'Agent response emitted with error.'
      });
      const responseTimestamp = new Date().toISOString();
      const resultLogEntry = controllerUtils.formatAgentChatLogEntry({
        type: 'agent-chat-result',
        requestId,
        timestamp: responseTimestamp,
        failure_reasons: failureReasons,
        ...controllerUtils.summarizeAgentResultForLog(result)
      });
      await flushLifecycleRecorderEvents(logPath, lifecycleRecorder);
      await deps.appendAgentChatLogEntry(logPath, resultLogEntry);
      if (chatSession?.id) {
        const assistantMessage = agentChatLogRuntime.buildAssistantMessageFromResult({
          result,
          requestText: cleanText(normalizedPayload?.message, 3000),
          messageId: `assistant-${requestId}`,
          timestamp: responseTimestamp
        });
        await appendChatSessionRowsSafe([
          ...asArray(lifecycleRecorder.events).map((event) => ({
            ...controllerUtils.formatAgentChatLogEntry(event),
            session_id: chatSession.id
          })),
          {
            ...resultLogEntry,
            session_id: chatSession.id
          },
          {
            type: 'assistant-message',
            session_id: chatSession.id,
            message_id: cleanText(assistantMessage.id, 120),
            timestamp: cleanText(assistantMessage.createdAt, 80) || responseTimestamp,
            text: cleanText(assistantMessage.text, 24000),
            meta: assistantMessage.meta
          }
        ]);
      }
      return chatSession
        ? {
          ...result,
          chat_session: chatSession
        }
        : result;
    } catch (error) {
      const errorMessage = String(error?.message || error);
      const failureReasons = observability.classifyFailureReasons({
        error: errorMessage,
        lifecycleEvents: lifecycleRecorder.events
      });
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'controller_error',
        status: 'failed',
        failure_reasons: failureReasons,
        message: cleanText(errorMessage, 320)
      });
      const errorTimestamp = new Date().toISOString();
      const errorLogEntry = controllerUtils.formatAgentChatLogEntry({
        type: 'agent-chat-error',
        requestId,
        timestamp: errorTimestamp,
        ok: false,
        failure_reasons: failureReasons,
        error: cleanText(errorMessage, 2000)
      });
      await flushLifecycleRecorderEvents(logPath, lifecycleRecorder);
      await deps.appendAgentChatLogEntry(logPath, errorLogEntry);
      if (chatSession?.id) {
        const assistantMessage = agentChatLogRuntime.buildAssistantMessageFromError({
          errorMessage,
          requestText: cleanText(normalizedPayload?.message, 3000),
          messageId: `assistant-${requestId}`,
          timestamp: errorTimestamp
        });
        await appendChatSessionRowsSafe([
          ...asArray(lifecycleRecorder.events).map((event) => ({
            ...controllerUtils.formatAgentChatLogEntry(event),
            session_id: chatSession.id
          })),
          {
            ...errorLogEntry,
            session_id: chatSession.id
          },
          {
            type: 'assistant-message',
            session_id: chatSession.id,
            message_id: cleanText(assistantMessage.id, 120),
            timestamp: cleanText(assistantMessage.createdAt, 80) || errorTimestamp,
            text: cleanText(assistantMessage.text, 24000),
            meta: assistantMessage.meta
          }
        ]);
      }
      return chatSession
        ? { ok: false, error: errorMessage, chat_session: chatSession }
        : { ok: false, error: errorMessage };
    }
  });

  ipcMain.handle('agent:chat-log:create-session', async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const storagePath = getAgentChatSessionStoragePath(normalizedPayload);
    if (!storagePath) {
      return {
        ok: false,
        error: 'Missing storage path.'
      };
    }
    try {
      return await agentChatLogRuntime.createSession({
        storagePath,
        sessionId: cleanText(normalizedPayload?.sessionId || normalizedPayload?.session_id, 120),
        title: cleanText(normalizedPayload?.title, 220) || 'New Chat',
        projectId: cleanText(normalizedPayload?.projectId || normalizedPayload?.project_id, 120),
        projectName: cleanText(normalizedPayload?.projectName || normalizedPayload?.project_name, 220)
      });
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400)
      };
    }
  });

  ipcMain.handle('agent:chat-log:list-sessions', async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const storagePath = getAgentChatSessionStoragePath(normalizedPayload);
    if (!storagePath) {
      return {
        ok: true,
        items: []
      };
    }
    try {
      return await agentChatLogRuntime.listSessions({
        storagePath,
        limit: Math.max(1, Number(normalizedPayload?.limit) || 200)
      });
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400)
      };
    }
  });

  ipcMain.handle('agent:chat-log:get-session', async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const storagePath = getAgentChatSessionStoragePath(normalizedPayload);
    const sessionId = cleanText(normalizedPayload?.sessionId || normalizedPayload?.session_id, 120);
    if (!storagePath) {
      return {
        ok: false,
        error: 'Missing storage path.'
      };
    }
    if (!sessionId) {
      return {
        ok: false,
        error: 'sessionId is required.'
      };
    }
    try {
      return await agentChatLogRuntime.getSession({
        storagePath,
        sessionId,
        includeRows: normalizedPayload?.includeRows === true
      });
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400)
      };
    }
  });

  ipcMain.handle('agent:developer:test-tools', async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const executionFlags = controllerUtils.resolveAgentExecutionFlags(
      normalizedPayload,
      normalizeJsonPayload(normalizedPayload?.stateSnapshot, {})
    );
    if (executionFlags.developerMode !== true) {
      return {
        ok: false,
        status: 'error',
        tool_count: 0,
        passed_count: 0,
        failed_count: 0,
        items: [],
        summary: 'Agent developer mode must be enabled to run manual tool smoke tests.',
        error: 'Agent developer mode must be enabled to run manual tool smoke tests.'
      };
    }

    try {
      const toolName = cleanText(normalizedPayload?.toolName || normalizedPayload?.tool_name, 120);
      const requestMessage = cleanText(normalizedPayload?.message, 3000);
      if (toolName) {
        return await agentToolSmokeTestRuntime.runTool({
          toolName,
          message: requestMessage,
          stateSnapshot: agentToolRuntime.normalizeAgentSnapshot(normalizeJsonPayload(normalizedPayload?.stateSnapshot, {})),
          projectId: cleanText(normalizedPayload?.projectId, 80),
          projectName: cleanText(normalizedPayload?.projectName, 180)
        });
      }
      return await agentToolSmokeTestRuntime.runAllTools({
        stateSnapshot: agentToolRuntime.normalizeAgentSnapshot(normalizeJsonPayload(normalizedPayload?.stateSnapshot, {})),
        projectId: cleanText(normalizedPayload?.projectId, 80),
        projectName: cleanText(normalizedPayload?.projectName, 180)
      });
    } catch (error) {
      const message = cleanText(error?.message || error, 600) || 'Manual tool smoke test failed.';
      return {
        ok: false,
        status: 'error',
        tool_count: 0,
        passed_count: 0,
        failed_count: 0,
        items: [],
        summary: message,
        error: message
      };
    }
  });

  ipcMain.handle('agent:logs:list-requests', async () => {
    try {
      const rows = await observability.readLifecycleLogs({
        logPath: getAgentChatLogPath(),
        limit: 8000
      });
      const byRequest = new Map();

      rows.forEach((row) => {
        const requestId = cleanText(row?.requestId, 80);
        if (!requestId) {
          return;
        }
        const existing = byRequest.get(requestId) || {
          requestId,
          message: '',
          projectId: '',
          projectName: '',
          provider: '',
          model: '',
          response_type: '',
          ok: null,
          failure_reasons: [],
          started_at: '',
          ended_at: '',
          stages: []
        };
        const type = cleanText(row?.type, 80);
        const timestamp = cleanText(row?.timestamp, 80);
        if (!existing.started_at && timestamp) {
          existing.started_at = timestamp;
        }
        if (timestamp) {
          existing.ended_at = timestamp;
        }

        if (type === 'agent-chat-request') {
          existing.message = cleanText(row?.message, 320);
          existing.projectId = cleanText(row?.projectId, 80);
          existing.projectName = cleanText(row?.projectName, 180);
          existing.provider = cleanText(row?.llm?.provider, 80);
        } else if (type === 'agent-chat-result') {
          existing.ok = row?.ok === true;
          existing.model = cleanText(row?.model, 120);
          existing.response_type = cleanText(row?.response_type, 80);
          existing.failure_reasons = Array.from(new Set([...asArray(existing.failure_reasons), ...asArray(row?.failure_reasons)])).slice(0, 20);
        } else if (type === 'agent-chat-error') {
          existing.ok = false;
          existing.failure_reasons = Array.from(new Set([...asArray(existing.failure_reasons), ...asArray(row?.failure_reasons)])).slice(0, 20);
        } else if (type === 'agent-lifecycle') {
          const stage = cleanText(row?.stage, 40);
          if (stage && !existing.stages.includes(stage)) {
            existing.stages.push(stage);
          }
          existing.failure_reasons = Array.from(new Set([...asArray(existing.failure_reasons), ...asArray(row?.failure_reasons)])).slice(0, 20);
        }
        byRequest.set(requestId, existing);
      });

      const items = Array.from(byRequest.values())
        .sort((a, b) => {
          const left = Date.parse(a.ended_at || a.started_at || '') || 0;
          const right = Date.parse(b.ended_at || b.started_at || '') || 0;
          return right - left;
        })
        .slice(0, 200);

      return {
        ok: true,
        items
      };
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400)
      };
    }
  });

  ipcMain.handle('agent:logs:replay', async (_event, payload) => {
    const requestId = cleanText(payload?.requestId, 80);
    if (!requestId) {
      return {
        ok: false,
        error: 'requestId is required.'
      };
    }
    try {
      return await observability.replayRequestLifecycle({
        requestId,
        logPath: getAgentChatLogPath()
      });
    } catch (error) {
      return {
        ok: false,
        requestId,
        error: cleanText(error?.message || error, 2400)
      };
    }
  });
}

module.exports = {
  registerAgentIpc
};
