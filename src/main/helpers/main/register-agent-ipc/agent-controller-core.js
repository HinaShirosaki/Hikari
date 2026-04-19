'use strict';

const { createAgentIntentDispatcher } = require('./agent-intent-dispatcher');
const { createAgentOpenContextRuntime } = require('./agent-open-context-runtime');
const { throwIfAgentRequestAborted } = require('../../agent/shared/agent-request-context.js');

function createAgentControllerCore({
  deps,
  cleanText,
  controllerUtils,
  observability,
  protocolNotebookRuntime,
  scienceReasoningLoopRuntime,
  deepResearchRuntime,
  scienceMainUtils,
  agentToolRuntime,
  executeInventoryLookup,
  executeRecordLookup,
  agentChatLogRuntime,
  getAgentChatLogPath,
  getDefaultDataFilePath,
  setCodexCliModel,
  setCodexCliReasoningEffort,
  lifecycleService
} = {}) {
  const { normalizeJsonPayload, asArray } = lifecycleService;
  const openContextRuntime = createAgentOpenContextRuntime({
    cleanText,
    observability,
    protocolNotebookRuntime,
    executeInventoryLookup,
    executeRecordLookup,
    getDefaultDataFilePath,
    agentChatLogRuntime
  });

  function normalizeAttachments(rawAttachments = []) {
    return asArray(rawAttachments).map((attachment) => {
      const source = attachment && typeof attachment === 'object' ? attachment : {};
      return {
        id: cleanText(source.id, 120),
        name: cleanText(source.name, 240),
        mimeType: cleanText(source.mimeType || source.mime_type, 160),
        kind: cleanText(source.kind, 40),
        size: Number.isFinite(Number(source.size)) ? Number(source.size) : 0,
        dataUrl: cleanText(source.dataUrl || source.data_url, 400000)
      };
    }).filter((attachment) => attachment.name && attachment.dataUrl);
  }
  const intentDispatcher = createAgentIntentDispatcher({
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
  });

  function buildSkillCommandParserPayload({
    skillName = '',
    toolName = '',
    reasoningSummary = ''
  } = {}) {
    return {
      primary_intent: 'skill_command',
      reasoning_effort: 0,
      direct_answer: null,
      needs_clarification: false,
      clarification_reason: null,
      entities: {
        skill_name: cleanText(skillName, 160),
        command_tool: cleanText(toolName, 120)
      },
      inventory_search: {
        normalized_query: null,
        candidate_terms: [],
        aliases: [],
        search_mode: null
      },
      protocol_candidates: [],
      reasoning_summary: cleanText(reasoningSummary, 1200) || 'Handled as a direct skill command.'
    };
  }

  function buildSkillListText(skills = []) {
    const rows = asArray(skills).map((skill) => {
      const name = cleanText(skill?.name, 160);
      const description = cleanText(skill?.description, 320);
      const commandName = cleanText(skill?.command_name, 60);
      if (!name) {
        return '';
      }
      return [
        `- ${name}${commandName ? ` (/${commandName})` : ''}`,
        description ? `  ${description}` : ''
      ].filter(Boolean).join('\n');
    }).filter(Boolean);
    return rows.length
      ? `Available skills:\n${rows.join('\n')}`
      : 'No eligible skills were found in the current workspace.';
  }

  function buildSkillCommandResult({
    parser,
    status = '',
    skillName = '',
    commandName = '',
    toolName = '',
    rawInput = '',
    summary = '',
    result = null,
    availableSkills = []
  } = {}) {
    return {
      ok: true,
      parser,
      skill_command: {
        status: cleanText(status, 40) || 'completed',
        skill_name: cleanText(skillName, 160),
        command_name: cleanText(commandName, 80),
        tool_name: cleanText(toolName, 120),
        raw_input: cleanText(rawInput, 12000),
        summary: cleanText(summary, 4000),
        result: result && typeof result === 'object' ? result : null,
        available_skills: asArray(availableSkills).map((skill) => ({
          name: cleanText(skill?.name, 160),
          description: cleanText(skill?.description, 320),
          command_name: cleanText(skill?.command_name, 60),
          path: cleanText(skill?.path, 1200)
        })).filter((skill) => skill.name)
      }
    };
  }

  async function runAgentControllerCore(payload, runtime = {}) {
    throwIfAgentRequestAborted('Agent request stopped before controller startup.');
    const lifecycleRecorder = runtime && typeof runtime === 'object'
      ? runtime.lifecycleRecorder
      : null;
    const message = cleanText(payload?.message, 3000);
    if (!message) {
      throw new Error('Message is required.');
    }
    const rawSnapshot = normalizeJsonPayload(payload?.stateSnapshot, {});
    const snapshot = agentToolRuntime.normalizeAgentSnapshot(rawSnapshot);
    const workspaceDir = process.cwd();
    const listedSkills = typeof agentToolRuntime.listSkills === 'function'
      ? agentToolRuntime.listSkills({ workspaceDir })
      : [];
    const skillInvocation = typeof agentToolRuntime.parseSkillInvocation === 'function'
      ? agentToolRuntime.parseSkillInvocation(message, {
        workspaceDir
      })
      : {
        type: 'none',
        active_skill_names: [],
        cleaned_message: message
      };

    if (skillInvocation.type === 'list_skills') {
      const summary = buildSkillListText(listedSkills);
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'skill_command_completed',
        status: 'ok',
        routing_intent: 'skill_command',
        message: 'Listed eligible skills for the current workspace.',
        meta: {
          skill_count: listedSkills.length
        }
      });
      return buildSkillCommandResult({
        parser: buildSkillCommandParserPayload({
          reasoningSummary: 'Listed the eligible skills in the current workspace.'
        }),
        status: 'listed',
        commandName: 'skills',
        summary,
        availableSkills: listedSkills
      });
    }

    if (skillInvocation.type === 'unknown_skill') {
      return buildSkillCommandResult({
        parser: buildSkillCommandParserPayload({
          reasoningSummary: 'The requested skill could not be resolved.'
        }),
        status: 'error',
        commandName: 'skill',
        summary: listedSkills.length
          ? `I could not find that skill.\n\n${buildSkillListText(listedSkills)}`
          : 'I could not find that skill, and no eligible skills are available right now.',
        availableSkills: listedSkills
      });
    }

    if (skillInvocation.type === 'direct_tool') {
      const toolEnvelope = await agentToolRuntime.runAgentTool(
        skillInvocation.tool_name,
        {
          command: cleanText(skillInvocation.raw_args, 12000),
          commandName: cleanText(skillInvocation.command_name, 80),
          skillName: cleanText(skillInvocation.skill?.name, 160)
        },
        snapshot,
        {
          allowWriteTools: true,
          cwd: workspaceDir
        }
      );
      const toolResult = toolEnvelope?.result && typeof toolEnvelope.result === 'object'
        ? toolEnvelope.result
        : {};
      const status = cleanText(toolResult.status, 40)
        || (toolEnvelope?.ok === false ? 'error' : 'completed');
      const summary = cleanText(toolResult.summary || toolEnvelope?.summary, 4000)
        || 'Skill command completed.';
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'skill_command_completed',
        status: status === 'completed' || status === 'listed' ? 'ok' : 'pending',
        routing_intent: 'skill_command',
        tool_name: cleanText(skillInvocation.tool_name, 120),
        message: summary,
        meta: {
          skill_name: cleanText(skillInvocation.skill?.name, 160),
          command_name: cleanText(skillInvocation.command_name, 80)
        }
      });
      return buildSkillCommandResult({
        parser: buildSkillCommandParserPayload({
          skillName: skillInvocation.skill?.name,
          toolName: skillInvocation.tool_name,
          reasoningSummary: `Dispatched the ${cleanText(skillInvocation.skill?.name, 160) || 'requested'} skill directly to the ${cleanText(skillInvocation.tool_name, 120) || 'tool'} tool.`
        }),
        status,
        skillName: skillInvocation.skill?.name,
        commandName: skillInvocation.command_name,
        toolName: skillInvocation.tool_name,
        rawInput: skillInvocation.raw_args,
        summary,
        result: toolResult,
        availableSkills: listedSkills
      });
    }
    const effectiveMessage = cleanText(
      skillInvocation.type === 'skill_prompt'
        ? skillInvocation.cleaned_message
        : message,
      3000
    ) || message;
    const skillPromptPayload = typeof agentToolRuntime.buildSkillsPromptPayload === 'function'
      ? agentToolRuntime.buildSkillsPromptPayload({
        workspaceDir,
        activeSkillNames: skillInvocation.active_skill_names
      })
      : {
        skills_catalog_prompt: '',
        active_skills_prompt: ''
      };

    const llmSource = typeof controllerUtils.resolveAgentLlmSource === 'function'
      ? controllerUtils.resolveAgentLlmSource(payload?.llm)
      : {
        provider: controllerUtils.resolveAgentProvider(payload?.llm),
        endpoint: controllerUtils.resolveAgentEndpoint(payload?.llm, ''),
        apiKey: controllerUtils.resolveAgentApiKey(payload?.llm),
        model: controllerUtils.resolveAgentModel(payload?.llm, '')
      };
    const provider = cleanText(llmSource?.provider, 80);
    const endpoint = cleanText(llmSource?.endpoint, 2000);
    const apiKey = cleanText(llmSource?.apiKey, 400);
    const model = cleanText(llmSource?.model, 120);
    const reasoningEffort = cleanText(payload?.llm?.reasoningEffort, 40).toLowerCase();
    if (provider !== deps.LLM_PROVIDERS.CODEX && !apiKey) {
      throw new Error('Missing LLM API key. Set it in Settings > LLM Model & API, or use LLM_API_KEY / ENANA_LLM_API_KEY.');
    }
    if (provider === deps.LLM_PROVIDERS.CODEX) {
      setCodexCliModel(model);
      setCodexCliReasoningEffort(reasoningEffort);
    }
    const conversation = controllerUtils.extractConversation(payload?.conversation);
    const hasLatestUserInConversation = Boolean(
      conversation.length > 0
      && conversation[conversation.length - 1].role === 'user'
      && conversation[conversation.length - 1].text === effectiveMessage
    );
    const executionFlags = controllerUtils.resolveAgentExecutionFlags(payload, { settings: rawSnapshot?.settings || {} });
    const deepResearchEnabled = payload?.agent?.deepResearchEnabled === true;
    const traceContext = controllerUtils.createAgentLlmTraceContext({
      enabled: executionFlags.developerMode === true,
      requestId: cleanText(runtime?.requestId, 80),
      logPath: getAgentChatLogPath(),
      provider,
      model
    });
    if (runtime && typeof runtime === 'object') {
      runtime.traceContext = traceContext;
    }
    const projectId = cleanText(payload?.projectId, 80);
    const projectName = cleanText(payload?.projectName, 180);
    const attachments = normalizeAttachments(payload?.attachments);
    const promptConversation = hasLatestUserInConversation
      ? conversation
      : [...conversation, { role: 'user', text: effectiveMessage }];

    observability.recordLifecycleEvent(lifecycleRecorder, {
      stage: 'controller_intent_only',
      status: 'ok',
      message: 'Running parser-first intent phraser pipeline.'
    });

    const parserBypass = await openContextRuntime.resolveParserBypass({
      projectId,
      projectName,
      chatSessionId: cleanText(runtime?.chatSessionId, 120),
      chatSessionStoragePath: cleanText(runtime?.chatSessionStoragePath, 2400)
    });
    const parserWasSkipped = Boolean(parserBypass?.ok === true && parserBypass?.payload);
    const parserResult = parserWasSkipped
      ? {
        ok: true,
        payload: parserBypass.payload
      }
      : await controllerUtils.requestIntentParserPayload({
        message: effectiveMessage,
        conversation: promptConversation,
        projectName,
        traceContext
      });
    throwIfAgentRequestAborted('Agent request stopped after intent parsing.');
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
      message: parserWasSkipped
        ? cleanText(parserBypass?.message, 320) || 'Skipped intent parser because the context is still open.'
        : `Intent parser returned primary_intent=${cleanText(parserResult.payload.primary_intent, 80) || 'unknown'}.`,
      meta: {
        needs_clarification: parserResult.payload.needs_clarification === true,
        skipped: parserWasSkipped === true,
        resumed_from_pending: parserBypass?.meta?.resumed_from_pending === true
      }
    });

    const result = {
      ok: true,
      parser: parserResult.payload
    };

    await intentDispatcher.dispatchIntent({
      payload,
      context: {
        provider,
        endpoint,
        apiKey,
        model,
        message: effectiveMessage,
        promptConversation,
        attachments,
        snapshot,
        executionFlags,
        deepResearchEnabled,
        traceContext,
        projectId,
        projectName,
        skillPromptPayload,
        parserPayload: parserResult.payload,
        lifecycleRecorder
      },
      result
    });
    throwIfAgentRequestAborted('Agent request stopped before finalizing agent response.');

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
    return runAgentControllerCore(payload, runtime && typeof runtime === 'object' ? runtime : {});
  }

  return {
    runAgentController,
    runAgentControllerCore
  };
}

module.exports = {
  createAgentControllerCore
};
