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
  const fs = deps.fs || require('node:fs');
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

  // App-owned config, logs, tmp and the storage-root pointer live in Electron's
  // userData (AppData / Application Support). User content lives in the
  // storage root the user picks in Settings.
  function getDefaultAppDataRoot() {
    const override = String(processObject.env.HIKARI_APP_DATA_ROOT || '').trim();
    if (override) {
      return path.resolve(override);
    }

    return getUserDataPath() || path.join(projectRoot || processObject.cwd(), 'data');
  }

  function getCodexCliHomePath() {
    const override = String(processObject.env.HIKARI_CODEX_HOME || '').trim();
    if (override) {
      return path.resolve(override);
    }

    return path.join(getDefaultAppDataRoot(), 'Config', 'codex-cli-home');
  }

  function getCodexCliWorkingDirectory() {
    return getDefaultAppDataRoot();
  }

  function getDefaultDataFilePath() {
    return path.join(getDefaultAppDataRoot(), defaultDataFileName);
  }

  // The user's storage root, seeded from the pointer file so services that
  // start before the renderer reports it already resolve the right folder.
  let storageRoot = null;

  function getStorageRoot() {
    if (storageRoot === null) {
      try {
        const pointer = JSON.parse(fs.readFileSync(getStorageRootPointerPath(), 'utf8'));
        storageRoot = cleanText(pointer?.storagePath, 2400);
      } catch {
        storageRoot = '';
      }
    }
    return storageRoot;
  }

  // Returns true when the root actually changed so callers can reload.
  function setStorageRoot(value) {
    const next = cleanText(value, 2400);
    if (next === getStorageRoot()) {
      return false;
    }
    storageRoot = next;
    return true;
  }

  // Scheduled tasks, the genome library and agent memory travel with the
  // storage root. ponytail: before a root is chosen they sit in userData and
  // stay there.
  function getStorageDataRoot() {
    return getStorageRoot() || getDefaultAppDataRoot();
  }

  function getScheduledTasksPath() {
    const override = String(processObject.env.HIKARI_SCHEDULED_TASKS_PATH || '').trim();
    if (override) {
      return path.resolve(override);
    }
    return path.join(getStorageDataRoot(), 'Config', scheduledTasksFileName);
  }

  function getGenomeLibraryPath() {
    return path.join(getStorageDataRoot(), 'Config', genomeLibraryFileName);
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

    // Same hidden folder the per-project research memory cache uses.
    return path.join(getStorageDataRoot(), '.hikari', 'agent-memory.json');
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
    getStorageRoot,
    setStorageRoot,
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
