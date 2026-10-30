'use strict';

const { AGENT } = require('../../../shared/ipc/channels');

function registerAgentLogHandlers({
  ipcMain,
  cleanText,
  getStorageRoot = () => '',
  agentChatLogRuntime,
  getAgentChatSessionStoragePath,
  agentToolRuntime,
  runAgentController,
  lifecycleService
} = {}) {
  const { normalizeJsonPayload } = lifecycleService;

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
    const workspaceDir = getStorageRoot() || process.cwd();
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

  ipcMain.handle(AGENT.GENERATE_PROTOCOL, async (_event, payload) => {
    if (typeof runAgentController !== 'function') {
      return {
        ok: false,
        error: 'Codex agent runtime is unavailable.'
      };
    }

    const normalizedPayload = normalizeJsonPayload(payload, {});
    const message = cleanText(normalizedPayload?.message, 24000);
    if (!message) {
      return {
        ok: false,
        error: 'Provide a protocol request before starting the Codex agent.'
      };
    }

    const llm = {
      ...normalizeJsonPayload(normalizedPayload?.llm, {}),
      provider: 'codex',
      apiEndpoint: '',
      apiKey: ''
    };

    try {
      const result = await runAgentController({
        ...normalizedPayload,
        message,
        llm,
        allowWriteTools: true
      });
      const protocolGeneration = normalizeJsonPayload(result?.protocol_generation, {});
      const protocol = normalizeJsonPayload(protocolGeneration.protocol, null);

      if (!result?.ok || !protocol) {
        return {
          ok: false,
          error: cleanText(result?.error || result?.codex_agent?.answer, 1200)
            || 'The Codex agent completed without returning a protocol for review.'
        };
      }

      return {
        ...result,
        protocol,
        summary: cleanText(protocolGeneration.summary || result?.codex_agent?.answer, 500)
      };
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 1200) || 'Protocol generation failed.'
      };
    }
  });
}

module.exports = {
  registerAgentLogHandlers
};
