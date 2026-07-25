'use strict';

const path = require('node:path');
const {
  buildCodexMcpContext,
  createCodexAgentRuntime
} = require('../../agent/codex-agent/runtime.js');
const {
  buildCodexSubAgentPrompt
} = require('../../agent/tools/agent-sub-agent.js');
const {
  sanitizeProjectMemoryFolderName
} = require('../../storage/storage-memory.js');
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

function normalizeStringList(value, cleanText, maxItems = 12) {
  const values = [];
  function add(entry) {
    if (Array.isArray(entry)) {
      entry.forEach(add);
      return;
    }
    String(entry || '')
      .split(/[;\n]+/u)
      .map((item) => cleanText(item, 240))
      .filter(Boolean)
      .forEach((item) => values.push(item));
  }
  add(value);
  const seen = new Set();
  return values.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, maxItems);
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
    await workspaceInitializer.initialize({
      cwd: input.cwd,
      envOverrides: input.envOverrides
    });
    return requestCodexCliText(input);
  }

  async function runScheduledTask(task = {}) {
    const project = ensurePlainObject(task.project);
    const execution = ensurePlainObject(task.execution);
    const metadata = ensurePlainObject(task.metadata);
    const paperFinding = ensurePlainObject(metadata.paper_finding);
    const projectName = cleanText(project.name, 320);
    const projectDescription = cleanText(
      project.description || paperFinding.project_description,
      12000
    );
    const preferredJournals = normalizeStringList(
      paperFinding.preferred_journals,
      cleanText
    );
    const taskType = cleanText(task.task_type || task.taskType, 80).toLowerCase();
    const dataFilePath = cleanText(project.data_file_path, 2400);
    const storagePath = cleanText(project.storage_path, 2400)
      || (dataFilePath ? path.dirname(path.resolve(dataFilePath)) : '');
    const cwd = cleanText(project.cwd, 2400)
      || (storagePath && projectName
        ? path.join(
          storagePath,
          'Project',
          sanitizeProjectMemoryFolderName(projectName, 'Untitled_Project')
        )
        : '');
    const snapshot = {
      settings: {
        ...(storagePath
          ? { storagePath }
          : {}),
        ...(preferredJournals.length
          ? {
            preferredJournals,
            preferredJournal: preferredJournals.join('; ')
          }
          : {})
      },
      projects: project.id || project.name
        ? [{
          ...(cleanText(project.id, 220) ? { id: cleanText(project.id, 220) } : {}),
          name: projectName || 'Untitled Project',
          ...(projectDescription ? { description: projectDescription } : {})
        }]
        : [],
      scheduled_task: {
        id: cleanText(task.id, 160),
        task_type: taskType,
        deny_paper_download: taskType === 'paper_finding'
      },
      ...(dataFilePath
        ? { data_file_path: dataFilePath }
        : {})
    };
    return codexAgentRuntime.run({
      message: cleanText(task.prompt, 120000),
      model: cleanText(execution.model, 120),
      reasoningEffort: cleanText(execution.reasoning_effort, 40),
      enableWebSearch: execution.enable_web_search !== false,
      timeoutMs: execution.timeout_ms,
      cwd,
      projectId: cleanText(project.id, 220),
      projectName,
      dataFilePath,
      fallbackDataFilePath: dataFilePath,
      snapshot,
      traceContext: {
        requestId: `scheduled-task:${cleanText(task.id, 160)}`
      }
    });
  }

  async function runSubAgentTurn(turnInput = {}) {
    const turnMetadata = ensurePlainObject(turnInput.metadata);
    const agentMetadata = ensurePlainObject(turnInput?.agent?.metadata);
    const timeoutMs = Number(
      turnMetadata.timeout_ms
        ?? turnMetadata.timeoutMs
        ?? agentMetadata.timeout_ms
        ?? agentMetadata.timeoutMs
    );
    const cwd = cleanText(
      turnMetadata.cwd || agentMetadata.cwd || getCodexCliWorkingDirectory(),
      2400
    );
    const model = cleanText(turnMetadata.model || agentMetadata.model, 120);
    const reasoningEffort = cleanText(
      turnMetadata.reasoning_effort
        || turnMetadata.reasoningEffort
        || agentMetadata.reasoning_effort
        || agentMetadata.reasoningEffort,
      40
    );
    const project = ensurePlainObject(
      Object.keys(ensurePlainObject(turnMetadata.project)).length
        ? turnMetadata.project
        : agentMetadata.project
    );
    const traceContext = {
      requestId: cleanText(
        turnMetadata.parent_request_id
          || turnMetadata.parentRequestId
          || agentMetadata.parent_request_id
          || agentMetadata.parentRequestId,
        160
      )
    };
    const sourceSnapshot = ensurePlainObject(
      turnInput.snapshot
        || turnInput.stateSnapshot
        || turnInput.state_snapshot
        || turnMetadata.snapshot
        || turnMetadata.stateSnapshot
        || turnMetadata.state_snapshot
        || agentMetadata.snapshot
        || agentMetadata.stateSnapshot
        || agentMetadata.state_snapshot
    );
    const dataFilePath = cleanText(
      turnMetadata.data_file_path
        || turnMetadata.dataFilePath
        || agentMetadata.data_file_path
        || agentMetadata.dataFilePath
        || sourceSnapshot.data_file_path
        || sourceSnapshot.dataFilePath,
      2000
    );
    const fallbackDataFilePath = cleanText(
      turnMetadata.fallback_data_file_path
        || turnMetadata.fallbackDataFilePath
        || agentMetadata.fallback_data_file_path
        || agentMetadata.fallbackDataFilePath
        || sourceSnapshot.fallback_data_file_path
        || sourceSnapshot.fallbackDataFilePath
        || dataFilePath,
      2000
    );
    const mcpContextJson = JSON.stringify(buildCodexMcpContext({
      cwd,
      model,
      message: cleanText(turnInput.message, 3200),
      conversation: (Array.isArray(turnInput.messages) ? turnInput.messages : []).map((entry) => ({
        role: cleanText(entry?.role, 40),
        text: cleanText(entry?.text || entry?.content || entry?.message, 3200)
      })),
      projectId: cleanText(
        turnMetadata.project_id
          || turnMetadata.projectId
          || project.id
          || project.projectId
          || agentMetadata.project_id
          || agentMetadata.projectId,
        120
      ),
      projectName: cleanText(
        turnMetadata.project_name
          || turnMetadata.projectName
          || project.name
          || project.projectName
          || agentMetadata.project_name
          || agentMetadata.projectName,
        220
      ),
      ...(dataFilePath ? { dataFilePath } : {}),
      ...(fallbackDataFilePath ? { fallbackDataFilePath } : {}),
      snapshot: sourceSnapshot,
      traceContext
    }, { cleanText }));
    const envOverrides = {
      HIKARI_AGENT_MCP_REQUEST_CONTEXT: mcpContextJson,
      HIKARI_CODEX_REQUEST_CONTEXT: mcpContextJson
    };
    await workspaceInitializer.initialize({
      cwd,
      envOverrides
    });
    const result = await requestCodexCliText({
      prompt: buildCodexSubAgentPrompt(turnInput),
      cwd,
      model,
      reasoningEffort,
      enableWebSearch: turnMetadata.enable_web_search === true
        || turnMetadata.enableWebSearch === true
        || agentMetadata.enable_web_search === true
        || agentMetadata.enableWebSearch === true,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180000,
      resumeSessionId: cleanText(
        agentMetadata.codex_session_id
          || agentMetadata.codexSessionId
          || agentMetadata.session_id
          || agentMetadata.sessionId,
        240
      ),
      returnMetadata: true,
      envOverrides
    });
    const resultMetadata = ensurePlainObject(result?.metadata);
    const assistantMessage = cleanText(
      typeof result === 'string' ? result : (result?.text || result?.assistant_message || result?.message),
      20000
    );
    if (!assistantMessage) {
      throw new Error('Codex sub-agent returned an empty response.');
    }
    const codexSessionId = cleanText(
      resultMetadata.session_id
        || resultMetadata.sessionId
        || resultMetadata.resumed_session_id
        || resultMetadata.resumedSessionId
        || agentMetadata.codex_session_id
        || agentMetadata.codexSessionId,
      240
    );
    return {
      assistant_message: assistantMessage,
      summary: cleanText(assistantMessage, 500),
      metadata: {
        provider: 'codex-cli',
        provider_ok: true,
        real_codex_sub_agent: true,
        codex_session_id: codexSessionId,
        command: cleanText(resultMetadata.command, 80)
      }
    };
  }

  const codexAgentRuntime = createCodexAgentRuntime({
    cleanText,
    requestCodexAgentText,
    recordAgentLlmTrace: agentFoundation.controllerUtils.recordAgentLlmTrace,
    recordLifecycleEvent: agentFoundation.observability.recordLifecycleEvent,
    getWorkingDirectory: getCodexCliWorkingDirectory,
    prepareProjectWorkspace,
    runTool: agentFoundation.agentToolRuntime.runAgentTool
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
    const runtimeHome = cleanText(
      initialization?.runtime_home || processObject.env.HIKARI_CODEX_HOME,
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
