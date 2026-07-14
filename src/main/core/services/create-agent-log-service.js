'use strict';

function createAgentLogService({ fs, path, appendLogWithRotation, consoleObject = console } = {}) {
  async function appendAgentChatLogEntry(logPath, entry) {
    try {
      await appendLogWithRotation({
        logPath,
        entry
      });
    } catch (error) {
      consoleObject.error('Failed to append agent chat log entry:', error);
    }
  }

  async function ensureAgentChatLogFile(logPath) {
    try {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.appendFile(logPath, '', 'utf8');
    } catch (error) {
      consoleObject.error('Failed to initialize agent chat log file:', error);
    }
  }

  return {
    appendAgentChatLogEntry,
    ensureAgentChatLogFile
  };
}

module.exports = {
  createAgentLogService
};
