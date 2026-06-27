'use strict';

const { throwIfAgentRequestAborted } = require('../../helpers/agent/shared/agent-request-context.js');

function createAgentControllerCore({
  deps,
  cleanText,
  controllerUtils,
  observability,
  protocolNotebookRuntime,
  scienceReasoningLoopRuntime,
  codexAgentRuntime,
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
  const allowApiAgent = deps.ALLOW_API_AGENT !== false;
  const apiAgentController = allowApiAgent
    ? require('./api-agent-controller').createApiAgentController({
      deps,
      cleanText,
      controllerUtils,
      observability,
      protocolNotebookRuntime,
      scienceReasoningLoopRuntime,
      scienceMainUtils,
      agentToolRuntime,
      executeInventoryLookup,
      executeRecordLookup,
      agentChatLogRuntime,
      getDefaultDataFilePath,
      lifecycleService
    })
    : null;

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

  function normalizeHiddenContexts(rawContexts = []) {
    return asArray(rawContexts).map((context) => {
      const source = context && typeof context === 'object' ? context : {};
      const text = cleanText(source.text, 4000);
      if (!text) {
        return null;
      }
      return {
        kind: cleanText(source.kind || 'selection', 80),
        label: cleanText(source.label || 'Hidden context', 120),
        text,
        paperId: cleanText(source.paperId, 220),
        paperTitle: cleanText(source.paperTitle, 320),
        pageNumber: Number.isFinite(Number(source.pageNumber))
          ? Math.max(1, Math.round(Number(source.pageNumber)))
          : 0,
        notebookEntryId: cleanText(source.notebookEntryId, 220),
        projectName: cleanText(source.projectName, 220),
        protocolName: cleanText(source.protocolName, 220),
        assayId: cleanText(source.assayId, 220),
        assayName: cleanText(source.assayName, 320)
      };
    }).filter(Boolean).slice(0, 3);
  }

  function buildHiddenContextPrompt(hiddenContexts = []) {
    const rows = normalizeHiddenContexts(hiddenContexts).map((context, index) => {
      const isNotebookContext = context.kind === 'notebook-page' || Boolean(context.notebookEntryId);
      const isAssayContext = context.kind === 'assay-page' || context.kind === 'assay' || Boolean(context.assayId);
      const contentLabel = isNotebookContext
        ? 'Notebook page content:'
        : (isAssayContext ? 'Assay context:' : 'Selected text:');
      const sourceRows = [
        `Hidden context ${index + 1}: ${context.label}`,
        context.projectName ? `Project: ${context.projectName}` : '',
        context.protocolName ? `Protocol: ${context.protocolName}` : '',
        context.notebookEntryId ? `Notebook entry ID: ${context.notebookEntryId}` : '',
        context.assayName ? `Assay: ${context.assayName}` : '',
        context.assayId ? `Assay ID: ${context.assayId}` : '',
        context.paperTitle ? `Paper: ${context.paperTitle}` : '',
        context.pageNumber ? `Page: ${context.pageNumber}` : '',
        context.paperId ? `Paper ID: ${context.paperId}` : '',
        contentLabel,
        context.text
      ].filter(Boolean);
      return sourceRows.join('\n');
    });
    if (!rows.length) {
      return '';
    }
    return [
      'The following context was supplied by the UI and is not visible in the user composer. Use it as context for the next answer.',
      rows.join('\n\n')
    ].join('\n\n');
  }

  function composeAgentMessageWithHiddenContext(visibleMessage = '', hiddenContextText = '') {
    const visible = cleanText(visibleMessage, 3000);
    const hidden = cleanText(hiddenContextText, 12000);
    if (!hidden) {
      return visible;
    }
    return [
      hidden,
      visible ? `User question:\n${visible}` : ''
    ].filter(Boolean).join('\n\n');
  }

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
    const defaultDataFilePath = cleanText(
      typeof getDefaultDataFilePath === 'function' ? getDefaultDataFilePath() : '',
      1600
    );
    const snapshotInput = {
      ...rawSnapshot,
      ...(!cleanText(rawSnapshot?.data_file_path || rawSnapshot?.dataFilePath, 1600) && defaultDataFilePath
        ? { data_file_path: defaultDataFilePath }
        : {})
    };
    const snapshot = agentToolRuntime.normalizeAgentSnapshot(snapshotInput);
    const workspaceDir = process.cwd();
    const skillRuntimeInput = {
      workspaceDir,
      settings: rawSnapshot?.settings || {},
      snapshot: rawSnapshot,
      agent: payload?.agent && typeof payload.agent === 'object' ? payload.agent : {}
    };
    const listedSkills = typeof agentToolRuntime.listSkills === 'function'
      ? agentToolRuntime.listSkills(skillRuntimeInput)
      : [];
    const skillInvocation = typeof agentToolRuntime.parseSkillInvocation === 'function'
      ? agentToolRuntime.parseSkillInvocation(message, {
        ...skillRuntimeInput,
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
    const visibleEffectiveMessage = cleanText(
      skillInvocation.type === 'skill_prompt'
        ? skillInvocation.cleaned_message
        : message,
      3000
    ) || message;
    const hiddenContextText = buildHiddenContextPrompt(payload?.agent?.hiddenContexts);
    const effectiveMessage = composeAgentMessageWithHiddenContext(visibleEffectiveMessage, hiddenContextText) || message;
    const skillPromptPayload = typeof agentToolRuntime.buildSkillsPromptPayload === 'function'
      ? agentToolRuntime.buildSkillsPromptPayload({
        ...skillRuntimeInput,
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
    if (provider === deps.LLM_PROVIDERS.CODEX) {
      setCodexCliModel(model);
      setCodexCliReasoningEffort(reasoningEffort);
    }
    const conversation = controllerUtils.extractConversation(payload?.conversation);
    const latestConversationMessage = conversation[conversation.length - 1] || null;
    const hasLatestUserInConversation = Boolean(
      conversation.length > 0
      && latestConversationMessage.role === 'user'
      && (
        latestConversationMessage.text === effectiveMessage
        || latestConversationMessage.text === visibleEffectiveMessage
      )
    );
    const executionFlags = controllerUtils.resolveAgentExecutionFlags(payload, { settings: rawSnapshot?.settings || {} });
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
      ? [...conversation.slice(0, -1), { role: 'user', text: effectiveMessage }]
      : [...conversation, { role: 'user', text: effectiveMessage }];

    if (provider === deps.LLM_PROVIDERS.CODEX) {
      if (!codexAgentRuntime || typeof codexAgentRuntime.run !== 'function') {
        return {
          ok: false,
          provider,
          model: model || 'codex-default',
          error: 'Codex agent runtime is not configured.'
        };
      }
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'controller_codex_agent',
        status: 'ok',
        routing_intent: 'codex_agent',
        message: 'Routing request to the Codex-owned agent lifecycle.'
      });
      const codexResult = await codexAgentRuntime.run({
        provider,
        endpoint,
        apiKey,
        model,
        reasoningEffort,
        message: effectiveMessage,
        conversation: [],
        attachments,
        snapshot,
        dataFilePath: cleanText(snapshot?.data_file_path || defaultDataFilePath, 1600),
        fallbackDataFilePath: defaultDataFilePath,
        executionFlags,
        traceContext,
        projectId,
        projectName,
        skillPromptPayload,
        selectionInsight: payload?.agent?.selectionInsight || payload?.selectionInsight || null,
        agent: payload?.agent && typeof payload.agent === 'object' ? payload.agent : {},
        chatSessionId: cleanText(runtime?.chatSessionId, 120),
        codexSessionId: cleanText(runtime?.codexSessionId || runtime?.codex_session_id, 240),
        lifecycleRecorder,
        emitAgentProgress: runtime?.emitAgentProgress
      });
      throwIfAgentRequestAborted('Agent request stopped after Codex agent runtime.');
      if (executionFlags.developerMode === true && codexResult && typeof codexResult === 'object') {
        codexResult.developer_trace = asArray(traceContext?.rows);
      }
      return codexResult;
    }

    if (!apiAgentController) {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'controller_api_agent_disabled',
        status: 'failed',
        message: 'API agent support is disabled by the application feature flag.'
      });
      return {
        ok: false,
        provider: deps.LLM_PROVIDERS.CODEX,
        model: 'codex-default',
        error: 'API agent support is disabled. This build uses the Codex agent only.'
      };
    }

    return apiAgentController.run({
      payload,
      runtime,
      provider,
      endpoint,
      apiKey,
      model,
      effectiveMessage,
      promptConversation,
      attachments,
      snapshot,
      executionFlags,
      traceContext,
      projectId,
      projectName,
      skillPromptPayload,
      lifecycleRecorder
    });
  }

  async function runAgentController(payload, runtime = {}) {
    const lifecycleRecorder = runtime && typeof runtime === 'object'
      ? runtime.lifecycleRecorder
      : null;
    const provider = typeof controllerUtils.resolveAgentProvider === 'function'
      ? cleanText(controllerUtils.resolveAgentProvider(payload?.llm), 80)
      : '';
    const isCodexProvider = provider === deps.LLM_PROVIDERS.CODEX;
    if (isCodexProvider) {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'controller_codex_agent_selected',
        status: 'ok',
        message: 'Using Codex-owned agent controller path.'
      });
      return runAgentControllerCore(payload, runtime && typeof runtime === 'object' ? runtime : {});
    }
    observability.recordLifecycleEvent(lifecycleRecorder, {
      stage: allowApiAgent ? 'controller_intent_only_selected' : 'controller_api_agent_disabled',
      status: allowApiAgent ? 'ok' : 'failed',
      message: allowApiAgent
        ? 'Using modular API agent controller path.'
        : 'API agent support is disabled by the application feature flag.'
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
