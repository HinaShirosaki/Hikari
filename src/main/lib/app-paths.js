'use strict';

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function createMainAppPaths(deps = {}) {
  const app = deps.app;
  const path = deps.path;
  const processObject = deps.processObject || process;
  const projectRoot = String(deps.projectRoot || processObject.cwd() || '').trim();
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const defaultDataFileName = String(deps.defaultDataFileName || 'hikari-data.json').trim() || 'hikari-data.json';
  const scheduledTasksFileName = String(deps.scheduledTasksFileName || 'scheduled-tasks.json').trim()
    || 'scheduled-tasks.json';
  const genomeLibraryFileName = String(deps.genomeLibraryFileName || 'genome-library.json').trim() || 'genome-library.json';
  const agentChatLogFileName = String(deps.agentChatLogFileName || 'agent-chat.log').trim() || 'agent-chat.log';

  function getUserDataPath() {
    try {
      return app?.getPath('userData') || '';
    } catch {
      return '';
    }
  }

  function getDocumentsPath() {
    try {
      return app?.getPath('documents') || '';
    } catch {
      return '';
    }
  }

  function getDefaultAppDataRoot() {
    const override = String(processObject.env.HIKARI_APP_DATA_ROOT || '').trim();
    if (override) {
      return path.resolve(override);
    }

    const documentsPath = getDocumentsPath();
    if (documentsPath) {
      return path.join(documentsPath, 'Hikari');
    }

    return path.join(projectRoot || processObject.cwd(), 'data');
  }

  function getCodexCliHomePath() {
    const override = String(processObject.env.HIKARI_CODEX_HOME || '').trim();
    if (override) {
      return path.resolve(override);
    }

    const userDataPath = getUserDataPath();
    if (userDataPath) {
      return path.join(userDataPath, 'Config', 'codex-cli-home');
    }

    return path.join(getDefaultAppDataRoot(), 'Config', 'codex-cli-home');
  }

  function getCodexCliWorkingDirectory() {
    const userDataPath = getUserDataPath();
    if (userDataPath) {
      return userDataPath;
    }
    return getDefaultAppDataRoot() || processObject.cwd();
  }

  function getDefaultDataFilePath() {
    return path.join(getDefaultAppDataRoot(), defaultDataFileName);
  }

  function getScheduledTasksPath() {
    const override = String(processObject.env.HIKARI_SCHEDULED_TASKS_PATH || '').trim();
    if (override) {
      return path.resolve(override);
    }
    return path.join(getDefaultAppDataRoot(), 'Config', scheduledTasksFileName);
  }

  function getGenomeLibraryPath() {
    return path.join(getDefaultAppDataRoot(), 'Config', genomeLibraryFileName);
  }

  // The workspace root otherwise lives only in renderer localStorage, which the
  // app cannot recover once it is cleared. Auto-save mirrors it here so startup
  // can find the workspace again.
  function getStorageRootPointerPath() {
    return path.join(getDefaultAppDataRoot(), 'Config', 'last-storage-root.json');
  }

  function getErrorLogPath() {
    return path.join(getDefaultAppDataRoot(), 'Logs', 'errors.log');
  }

  function getAgentChatLogPath() {
    const override = String(processObject.env.HIKARI_AGENT_CHAT_LOG_PATH || '').trim();
    if (override) {
      return override;
    }

    return path.join(getDefaultAppDataRoot(), 'Logs', agentChatLogFileName);
  }

  function getAgentPythonSandboxRoot() {
    const override = String(processObject.env.HIKARI_AGENT_PYTHON_SANDBOX_ROOT || '').trim();
    if (override) {
      return path.resolve(override);
    }

    return path.join(getDefaultAppDataRoot(), 'Tmp', 'agent-python-sandbox');
  }

  function getAgentMemoryFilePath() {
    const override = String(processObject.env.HIKARI_AGENT_MEMORY_PATH || '').trim();
    if (override) {
      return path.resolve(override);
    }

    return path.join(getDefaultAppDataRoot(), 'Agent', 'memory.json');
  }

  function getAgentChatSessionStoragePath(payload) {
    return cleanText(
      payload?.stateSnapshot?.settings?.storagePath
        || payload?.stateSnapshot?.storagePath
        || payload?.storagePath,
      2000
    );
  }

  return {
    getCodexCliHomePath,
    getCodexCliWorkingDirectory,
    getDefaultDataFilePath,
    getStorageRootPointerPath,
    getUserDataPath,
    getScheduledTasksPath,
    getGenomeLibraryPath,
    getAgentChatLogPath,
    getErrorLogPath,
    getAgentPythonSandboxRoot,
    getAgentMemoryFilePath,
    getAgentChatSessionStoragePath
  };
}

module.exports = {
  createMainAppPaths
};
