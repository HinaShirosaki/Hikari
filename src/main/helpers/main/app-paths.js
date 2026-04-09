'use strict';

function defaultCleanText(value, _maxLength = 500) {
  const text = String(value || '').trim();
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
  const defaultDataFileName = String(deps.defaultDataFileName || 'enana-data.json').trim() || 'enana-data.json';
  const telegramConfigFileName = String(deps.telegramConfigFileName || 'telegram-bot.json').trim() || 'telegram-bot.json';
  const agentChatLogFileName = String(deps.agentChatLogFileName || 'agent-chat.log').trim() || 'agent-chat.log';

  function getUserDataPath() {
    try {
      return app?.getPath('userData') || '';
    } catch {
      return '';
    }
  }

  function getCodexCliWorkingDirectory() {
    return getUserDataPath() || processObject.cwd();
  }

  function getDefaultDataFilePath() {
    return path.join(app.getPath('userData'), defaultDataFileName);
  }

  function getTelegramConfigPath() {
    return path.join(app.getPath('userData'), telegramConfigFileName);
  }

  function getAgentChatLogPath() {
    const override = String(processObject.env.ENANA_AGENT_CHAT_LOG_PATH || '').trim();
    if (override) {
      return override;
    }

    const userDataPath = getUserDataPath();
    if (userDataPath) {
      return path.join(userDataPath, agentChatLogFileName);
    }

    return path.join(projectRoot, 'data', agentChatLogFileName);
  }

  function getAgentPythonSandboxRoot() {
    const override = String(processObject.env.ENANA_AGENT_PYTHON_SANDBOX_ROOT || '').trim();
    if (override) {
      return path.resolve(override);
    }

    const userDataPath = getUserDataPath();
    if (userDataPath) {
      return path.join(userDataPath, 'agent-python-sandbox');
    }

    return path.join(projectRoot, 'tmp', 'agent-python-sandbox');
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
    getCodexCliWorkingDirectory,
    getDefaultDataFilePath,
    getTelegramConfigPath,
    getAgentChatLogPath,
    getAgentPythonSandboxRoot,
    getAgentChatSessionStoragePath
  };
}

module.exports = {
  createMainAppPaths
};
