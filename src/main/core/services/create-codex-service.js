'use strict';

const path = require('node:path');
const {
  createCodexAgentRuntime
} = require('../../agent/codex-agent/runtime.js');
const {
  sanitizeProjectMemoryFolderName
} = require('../../project-memory');
const {
  createCodexSubAgentTurnRunner
} = require('../../agent/tools/sub-agent/codex-turn-runner.js');
const {
  createCodexScheduledTaskRunner
} = require('../../scheduled-tasks/codex-task-runner.js');
const {
  resolveCodexCliRuntimeHomeDirectory
} = require('../../lib/codex-cli-provider');
const {
  createCodexWorkspaceInitializer
} = require('./create-codex-workspace-initializer.js');
const {
  buildHikariCodexDesktopMcpSetupPrompt
} = require('../../agent/codex-agent/desktop-mcp-prompt.js');
const {
  CODEX_CONFIG_FILE
} = require('../../lib/codex-cli-provider/constants.js');

function ensurePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function createMainCodexService({
  cleanText,
  requestCodexCliText,
  getCodexCliWorkingDirectory,
  getDefaultDataFilePath,
  getCodexCliHomePath,
  getBundlePaths,
  syncBundleFromSnapshot,
  mcpService,
  agentFoundation,
  fileAccess,
  processObject = process,
  createWorkspaceInitializer = createCodexWorkspaceInitializer
} = {}) {
  if (!String(processObject.env.HIKARI_CODEX_HOME || '').trim()) {
    processObject.env.HIKARI_CODEX_HOME = getCodexCliHomePath()
      || resolveCodexCliRuntimeHomeDirectory(getCodexCliWorkingDirectory());
  }
  const workspaceInitializer = createWorkspaceInitializer({
    cleanText,
    mcpHost: mcpService?.mcpHost,
    getCodexCliWorkingDirectory,
    getBundlePaths
  });

  function findProjectForCodexWorkspace(snapshot = {}, {
    projectId = '',
    projectName = ''
  } = {}) {
    const selectedProjectId = cleanText(projectId, 220);
    const selectedProjectName = cleanText(projectName, 320);
    const projects = (Array.isArray(snapshot.projects) ? snapshot.projects : [])
      .map((project) => ensurePlainObject(project));
    const matchedProjectById = selectedProjectId
      ? projects.find((project) => cleanText(project.id, 220) === selectedProjectId)
      : null;
    const matchedProjectByName = !matchedProjectById && selectedProjectName
      ? projects.find((project) => cleanText(project.name, 320) === selectedProjectName)
      : null;
    const matchedProject = matchedProjectById || matchedProjectByName || null;
    const name = cleanText(matchedProject?.name || selectedProjectName, 320);
    const id = cleanText(matchedProject?.id || selectedProjectId, 220);
    if (!name && !id) {
      return null;
    }
    return {
      id,
      name: name || 'Untitled Project',
      projects
    };
  }

  async function prepareProjectWorkspace(input = {}) {
    const snapshot = ensurePlainObject(input.snapshot);
    const project = findProjectForCodexWorkspace(snapshot, {
      projectId: input.projectId || input.project_id,
      projectName: input.projectName || input.project_name
    });
    if (!project) {
      return '';
    }

    const snapshotSettings = ensurePlainObject(snapshot.settings);
    const storagePath = cleanText(
      snapshotSettings.storagePath
        || snapshotSettings.storage_path
        || snapshot.storagePath
        || snapshot.storage_path
        || input.storagePath
        || input.storage_path,
      2400
    );
    const dataFilePath = cleanText(
      input.dataFilePath
        || input.data_file_path
        || snapshot.data_file_path
        || getDefaultDataFilePath(),
      2400
    );
    const fallbackDataFilePath = cleanText(
      input.fallbackDataFilePath
        || input.fallback_data_file_path
        || getDefaultDataFilePath(),
      2400
    );
    const hasSelectedProject = project.projects.some((entry) => (
      (project.id && cleanText(entry.id, 220) === project.id)
      || (project.name && cleanText(entry.name, 320) === project.name)
    ));
    const syncSnapshot = {
      ...snapshot,
      settings: {
        ...snapshotSettings,
        ...(storagePath ? { storagePath } : {})
      },
      projects: hasSelectedProject
        ? project.projects
        : [
          ...project.projects,
          {
            ...(project.id ? { id: project.id } : {}),
            name: project.name
          }
        ]
    };

    let bundlePaths = null;
    try {
      const syncResult = await syncBundleFromSnapshot({
        dataFilePath,
        fallbackDataFilePath,
        snapshot: syncSnapshot
      });
      bundlePaths = syncResult?.bundlePaths || null;
    } catch {
      bundlePaths = null;
    }
    if (!bundlePaths) {
      try {
        bundlePaths = getBundlePaths({
          dataFilePath,
          fallbackDataFilePath,
          storagePath
        });
      } catch {
        bundlePaths = null;
      }
    }

    const storageRootPath = cleanText(bundlePaths?.storageRootPath, 2400)
      || (dataFilePath ? path.dirname(path.resolve(dataFilePath)) : '');
    if (!storageRootPath) {
      return '';
    }
    return path.join(
      storageRootPath,
      'Project',
      sanitizeProjectMemoryFolderName(project.name, 'Untitled_Project')
    );
  }

  async function requestCodexAgentText(input = {}) {
    const envOverrides = { ...input.envOverrides };
    let context = {};
    try { context = ensurePlainObject(JSON.parse(envOverrides.HIKARI_AGENT_MCP_REQUEST_CONTEXT || envOverrides.HIKARI_CODEX_REQUEST_CONTEXT || '{}')); } catch { /* no file grant */ }
    const agentSettings = context.snapshot?.settings?.agent || {};
    const disabled = agentSettings.disabledMcpToolNames || agentSettings.disabled_mcp_tool_names || [];
    const session = await fileAccess?.beginSession({
      id: context.chatSessionId || context.traceRequestId,
      write: Boolean(context.chatSessionId) && !context.snapshot?.scheduled_task && !context.snapshot?.scheduledTask,
      enabled: !disabled.includes('workspace_files')
    });
    // Never persist a live capability in shared Codex config/request context.
    // The provider binds it to this CLI invocation via a per-process override.
    delete context.fileAccessToken;
    envOverrides.HIKARI_FILE_ACCESS_TOKEN = session?.ok ? session.token : '';
    envOverrides.HIKARI_AGENT_MCP_REQUEST_CONTEXT = JSON.stringify(context);
    envOverrides.HIKARI_CODEX_REQUEST_CONTEXT = JSON.stringify(context);
    try {
      await workspaceInitializer.initialize({ cwd: input.cwd, envOverrides });
      return await requestCodexCliText({ ...input, envOverrides });
    } finally { if (session?.token) fileAccess.endSession(session.token); }
  }

  const codexAgentRuntime = createCodexAgentRuntime({
    cleanText,
    requestCodexAgentText,
    recordAgentLlmTrace: agentFoundation.controllerUtils.recordAgentLlmTrace,
    recordLifecycleEvent: agentFoundation.observability.recordLifecycleEvent,
    getWorkingDirectory: getCodexCliWorkingDirectory,
    prepareProjectWorkspace,
    requestPluginCanvas: mcpService?.requestPluginCanvas,
    runTool: agentFoundation.agentToolRuntime.runAgentTool
  });
  const runScheduledTask = createCodexScheduledTaskRunner({ cleanText, codexAgentRuntime });
  const runSubAgentTurn = createCodexSubAgentTurnRunner({
    cleanText,
    requestCodexCliText,
    getCodexCliWorkingDirectory,
    workspaceInitializer
  });

  async function initialize(input = {}) {
    return workspaceInitializer.initialize(input);
  }

  async function getCodexDesktopMcpSetupPrompt(input = {}) {
    const storagePath = cleanText(input.storagePath, 2400);
    const dataFilePath = cleanText(
      input.dataFilePath || (storagePath ? '' : getDefaultDataFilePath()),
      2400
    );
    const initialization = await workspaceInitializer.initialize({
      cwd: getCodexCliWorkingDirectory(),
      dataFilePath,
      fallbackDataFilePath: dataFilePath,
      snapshot: {
        settings: {
          ...(storagePath ? { storagePath } : {})
        },
        ...(dataFilePath ? { data_file_path: dataFilePath } : {})
      }
    });
    if (initialization?.ok !== true) {
      return { ok: false, error: initialization?.error || 'Hikari could not initialize its Codex MCP connection.' };
    }
    const runtimeHome = cleanText(
      initialization.runtime_home,
      2400
    );
    const managedConfigPath = runtimeHome ? path.join(runtimeHome, CODEX_CONFIG_FILE) : '';
    const prompt = buildHikariCodexDesktopMcpSetupPrompt({ managedConfigPath });
    if (!prompt) {
      return {
        ok: false,
        error: 'Hikari could not prepare its live Codex MCP configuration.'
      };
    }
    return {
      ok: true,
      prompt,
      managedConfigPath,
      requiresRestart: true
    };
  }

  return {
    codexAgentRuntime,
    getCodexDesktopMcpSetupPrompt,
    getLastInitialization: workspaceInitializer.getLastResult,
    initialize,
    prepareProjectWorkspace,
    requestCodexAgentText,
    runScheduledTask,
    runSubAgentTurn,
    runtimeHome: processObject.env.HIKARI_CODEX_HOME
  };
}

module.exports = {
  createMainCodexService
};
