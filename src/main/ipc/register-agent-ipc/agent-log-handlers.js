'use strict';

const { AGENT } = require('../../../shared/ipc/channels');

function registerAgentLogHandlers({
  ipcMain,
  cleanText,
  observability,
  agentChatLogRuntime,
  getAgentChatLogPath,
  getAgentChatSessionStoragePath,
  agentToolRuntime,
  agentToolSmokeTestRuntime,
  codexAgentRuntime,
  protocolGenerationRuntime,
  controllerUtils,
  lifecycleService
} = {}) {
  const { normalizeJsonPayload, asArray } = lifecycleService;

  function normalizeProtocolGenerationEditorDraft(rawDraft) {
    const source = rawDraft && typeof rawDraft === 'object'
      ? rawDraft
      : {};
    return {
      title: cleanText(source?.title || source?.name, 220),
      purpose: cleanText(source?.purpose, 600),
      method_text: cleanText(source?.methodText || source?.method_text, 12000),
      materials: asArray(source?.materials).map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 80),
      steps: asArray(source?.steps).map((item) => cleanText(item, 2000)).filter(Boolean).slice(0, 120),
      troubleshooting: cleanText(source?.troubleshooting, 2400)
    };
  }

  function summarizeAttachments(payloadAttachments = []) {
    return asArray(payloadAttachments).map((attachment) => {
      const source = attachment && typeof attachment === 'object' ? attachment : {};
      return {
        id: cleanText(source.id, 120),
        name: cleanText(source.name, 240),
        mime_type: cleanText(source.mimeType || source.mime_type, 160),
        kind: cleanText(source.kind, 40),
        size: Number.isFinite(Number(source.size)) ? Number(source.size) : 0
      };
    }).filter((attachment) => attachment.name);
  }

  function buildPromptConversation({ payload, message }) {
    const conversation = typeof controllerUtils.extractConversation === 'function'
      ? controllerUtils.extractConversation(payload?.conversation)
      : asArray(payload?.conversation).map((entry) => ({
        role: entry?.role === 'assistant' ? 'assistant' : 'user',
        text: cleanText(entry?.text || entry?.content || entry?.message, 2500)
      })).filter((entry) => entry.text);
    const hasLatestUserInConversation = Boolean(
      conversation.length > 0
      && conversation[conversation.length - 1].role === 'user'
      && conversation[conversation.length - 1].text === message
    );
    return hasLatestUserInConversation
      ? conversation
      : [...conversation, { role: 'user', text: message }];
  }

  function buildDeveloperContextPreview(normalizedPayload = {}) {
    const rawSnapshot = normalizeJsonPayload(normalizedPayload?.stateSnapshot, {});
    const snapshot = typeof agentToolRuntime.normalizeAgentSnapshot === 'function'
      ? agentToolRuntime.normalizeAgentSnapshot(rawSnapshot)
      : rawSnapshot;
    const message = cleanText(normalizedPayload?.message, 3000);
    const workspaceDir = process.cwd();
    const skillRuntimeInput = {
      workspaceDir,
      settings: rawSnapshot?.settings || {},
      snapshot: rawSnapshot,
      agent: normalizedPayload?.agent && typeof normalizedPayload.agent === 'object'
        ? normalizedPayload.agent
        : {}
    };
    const skillInvocation = typeof agentToolRuntime.parseSkillInvocation === 'function'
      ? agentToolRuntime.parseSkillInvocation(message, skillRuntimeInput)
      : {
        type: 'none',
        active_skill_names: [],
        cleaned_message: message
      };
    const effectiveMessage = cleanText(
      skillInvocation?.type === 'skill_prompt'
        ? skillInvocation.cleaned_message
        : message,
      3000
    ) || message;
    const skillPromptPayload = typeof agentToolRuntime.buildSkillsPromptPayload === 'function'
      ? agentToolRuntime.buildSkillsPromptPayload({
        ...skillRuntimeInput,
        workspaceDir,
        activeSkillNames: asArray(skillInvocation?.active_skill_names)
      })
      : {
        skills_catalog_prompt: '',
        active_skills_prompt: ''
      };
    const llmSource = typeof controllerUtils.resolveAgentLlmSource === 'function'
      ? controllerUtils.resolveAgentLlmSource(normalizedPayload?.llm)
      : {
        provider: cleanText(normalizedPayload?.llm?.provider, 80),
        endpoint: cleanText(normalizedPayload?.llm?.apiEndpoint || normalizedPayload?.llm?.endpoint, 2000),
        apiKey: cleanText(normalizedPayload?.llm?.apiKey, 400),
        model: cleanText(normalizedPayload?.llm?.model, 120)
      };
    const provider = cleanText(llmSource?.provider, 80);
    const model = cleanText(llmSource?.model, 120);
    const projectId = cleanText(normalizedPayload?.projectId || normalizedPayload?.project_id, 120);
    const projectName = cleanText(normalizedPayload?.projectName || normalizedPayload?.project_name, 220);
    const promptConversation = buildPromptConversation({
      payload: normalizedPayload,
      message: effectiveMessage
    });
    const attachments = summarizeAttachments(normalizedPayload?.attachments);
    const agentFlags = {
      developerMode: normalizedPayload?.agent?.developerMode === true
    };
    const llmSummary = typeof controllerUtils.summarizeLlmForAgentLog === 'function'
      ? controllerUtils.summarizeLlmForAgentLog(normalizedPayload?.llm)
      : {
        provider,
        model,
        endpoint: cleanText(llmSource?.endpoint, 2000),
        hasApiKey: Boolean(cleanText(llmSource?.apiKey, 400))
      };
    const baseSystemPrompt = typeof agentToolRuntime.buildAgentSystemPrompt === 'function'
      ? agentToolRuntime.buildAgentSystemPrompt(projectName, {
        agent: {
          skillsCatalogPrompt: cleanText(skillPromptPayload.skills_catalog_prompt, 16000),
          activeSkillsPrompt: cleanText(skillPromptPayload.active_skills_prompt, 24000)
        }
      })
      : '';
    const codexPrompt = provider === 'codex'
      && codexAgentRuntime
      && typeof codexAgentRuntime.buildPrompt === 'function'
      ? codexAgentRuntime.buildPrompt({
        provider,
        model,
        reasoningEffort: cleanText(normalizedPayload?.llm?.reasoningEffort, 40).toLowerCase(),
        message: effectiveMessage,
        conversation: promptConversation,
        attachments: asArray(normalizedPayload?.attachments),
        snapshot,
        executionFlags: {
          developerMode: agentFlags.developerMode
        },
        projectId,
        projectName,
        skillPromptPayload,
        selectionInsight: normalizedPayload?.agent?.selectionInsight || normalizedPayload?.selectionInsight || null
      })
      : '';

    return {
      ok: true,
      updated_at: new Date().toISOString(),
      provider,
      model,
      project: {
        id: projectId,
        name: projectName
      },
      request: {
        message: effectiveMessage,
        original_message: message,
        conversation: promptConversation,
        attachments
      },
      prompt: {
        kind: provider === 'codex' ? 'codex_agent_prompt' : 'agent_runtime_prompt',
        system_prompt: codexPrompt || baseSystemPrompt,
        parser_system_prompt: provider === 'codex' ? '' : 'Return valid JSON only.',
        skills_catalog_prompt: cleanText(skillPromptPayload.skills_catalog_prompt, 16000),
        active_skills_prompt: cleanText(skillPromptPayload.active_skills_prompt, 24000)
      },
      skill_invocation: {
        type: cleanText(skillInvocation?.type, 80),
        active_skill_names: asArray(skillInvocation?.active_skill_names).map((item) => cleanText(item, 160)).filter(Boolean),
        command_name: cleanText(skillInvocation?.command_name, 80),
        skill_name: cleanText(skillInvocation?.skill?.name, 160)
      },
      mcp_context: provider === 'codex'
        ? {
          provider: 'codex',
          model,
          cwd: workspaceDir,
          message: cleanText(effectiveMessage, 3200),
          conversation: promptConversation.slice(-12),
          project: {
            id: projectId,
            name: projectName
          },
          dataFilePath: cleanText(snapshot?.data_file_path || snapshot?.dataFilePath, 2000)
        }
        : null,
      llm: llmSummary,
      agent: agentFlags,
      state_snapshot: snapshot
    };
  }

  function resolveExternalSkillsEnabled(normalizedPayload = {}, rawSnapshot = {}) {
    const agentSettings = rawSnapshot?.settings?.agent && typeof rawSnapshot.settings.agent === 'object'
      ? rawSnapshot.settings.agent
      : {};
    const payloadAgent = normalizedPayload?.agent && typeof normalizedPayload.agent === 'object'
      ? normalizedPayload.agent
      : {};
    const candidates = [
      payloadAgent.externalSkillsEnabled,
      payloadAgent.external_skills_enabled,
      agentSettings.externalSkillsEnabled,
      agentSettings.external_skills_enabled
    ];
    const explicit = candidates.find((item) => typeof item === 'boolean');
    return explicit === undefined ? true : explicit !== false;
  }

  function summarizeExternalSkill(skill = {}) {
    const source = skill && typeof skill === 'object' ? skill : {};
    return {
      name: cleanText(source.name, 160),
      description: cleanText(source.description, 600),
      command_name: cleanText(source.command_name, 80),
      path: cleanText(source.path, 1600),
      directory: cleanText(source.directory, 1600),
      homepage: cleanText(source.homepage, 1200),
      eligible: source.eligible !== false,
      settings_enabled: source.settings_enabled !== false,
      enabled: source.enabled === true,
      disabled_reason: cleanText(source.disabled_reason, 320),
      user_invocable: source.user_invocable !== false,
      disable_model_invocation: source.disable_model_invocation === true
    };
  }

  ipcMain.handle(AGENT.LIST_SKILLS, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const rawSnapshot = normalizeJsonPayload(normalizedPayload?.stateSnapshot, {});
    const workspaceDir = process.cwd();
    if (!agentToolRuntime || typeof agentToolRuntime.listSkills !== 'function') {
      return {
        ok: false,
        error: 'Agent skill runtime is unavailable.',
        external_skills_enabled: resolveExternalSkillsEnabled(normalizedPayload, rawSnapshot),
        skills: []
      };
    }

    try {
      const skills = agentToolRuntime.listSkills({
        workspaceDir,
        includeIneligible: true,
        includeDisabled: true,
        settings: rawSnapshot?.settings || {},
        snapshot: rawSnapshot,
        agent: normalizedPayload?.agent && typeof normalizedPayload.agent === 'object'
          ? normalizedPayload.agent
          : {}
      }).map(summarizeExternalSkill).filter((skill) => skill.name);
      return {
        ok: true,
        external_skills_enabled: resolveExternalSkillsEnabled(normalizedPayload, rawSnapshot),
        skill_count: skills.length,
        skills
      };
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400) || 'Failed to list external skills.',
        external_skills_enabled: resolveExternalSkillsEnabled(normalizedPayload, rawSnapshot),
        skills: []
      };
    }
  });

  ipcMain.handle(AGENT.CHAT_LOG_CREATE_SESSION, async (_event, payload) => {
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

  ipcMain.handle(AGENT.CHAT_LOG_LIST_SESSIONS, async (_event, payload) => {
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

  ipcMain.handle(AGENT.CHAT_LOG_GET_SESSION, async (_event, payload) => {
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

  ipcMain.handle(AGENT.DEVELOPER_CONTEXT_PREVIEW, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const executionFlags = controllerUtils.resolveAgentExecutionFlags(
      normalizedPayload,
      normalizeJsonPayload(normalizedPayload?.stateSnapshot, {})
    );
    if (executionFlags.developerMode !== true) {
      return {
        ok: false,
        status: 'error',
        summary: 'Agent developer mode must be enabled to inspect agent-visible context.',
        error: 'Agent developer mode must be enabled to inspect agent-visible context.'
      };
    }

    try {
      return buildDeveloperContextPreview(normalizedPayload);
    } catch (error) {
      const message = cleanText(error?.message || error, 600) || 'Failed to build agent-visible context preview.';
      return {
        ok: false,
        status: 'error',
        summary: message,
        error: message
      };
    }
  });

  ipcMain.handle(AGENT.DEVELOPER_TEST_TOOLS, async (_event, payload) => {
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

  ipcMain.handle(AGENT.GENERATE_PROTOCOL, async (_event, payload) => {
    if (!protocolGenerationRuntime || typeof protocolGenerationRuntime.generateProtocol !== 'function') {
      return {
        ok: false,
        error: 'Protocol generation runtime is unavailable.'
      };
    }

    const normalizedPayload = normalizeJsonPayload(payload, {});
    const editorDraft = normalizeProtocolGenerationEditorDraft(normalizedPayload?.editorDraft);
    const requestMessage = cleanText(normalizedPayload?.message, 3000);
    const protocolJson = cleanText(normalizedPayload?.protocolJson || normalizedPayload?.protocol_json, 200000);
    const resultSummary = cleanText(
      normalizedPayload?.resultSummary || normalizedPayload?.result_summary || requestMessage,
      3000
    );
    const hasEditorContext = Boolean(
      editorDraft.title
      || editorDraft.purpose
      || editorDraft.method_text
      || editorDraft.materials.length
      || editorDraft.steps.length
      || editorDraft.troubleshooting
    );
    if (!protocolJson && !requestMessage && !hasEditorContext) {
      return {
        ok: false,
        error: 'Provide protocol JSON or editor protocol content before preparing a protocol.'
      };
    }

    try {
      const result = await protocolGenerationRuntime.generateProtocol({
        ...(hasEditorContext ? {
          protocol: {
            name: editorDraft.title,
            purpose: editorDraft.purpose,
            materials: editorDraft.materials,
            steps: editorDraft.steps,
            troubleshooting: editorDraft.troubleshooting
          }
        } : {
          protocol_json: protocolJson || requestMessage
        }),
        result_summary: resultSummary
      });

      if (!result?.ok || !result.protocol) {
        return {
          ok: false,
          error: cleanText(result?.error, 600) || 'Protocol generation failed.'
        };
      }

      return {
        ok: true,
        protocol: result.protocol,
        summary: cleanText(result?.summary, 320)
      };
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 600) || 'Protocol generation failed.'
      };
    }
  });

  ipcMain.handle(AGENT.LOGS_LIST_REQUESTS, async () => {
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

  ipcMain.handle(AGENT.LOGS_REPLAY, async (_event, payload) => {
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
  registerAgentLogHandlers
};
