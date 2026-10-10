'use strict';

const {
  buildHikariCodexAgentsInstructions
} = require('../agent/codex-agent/agent-instructions.js');
const { OPENAI_CODEX_LOGIN_URL } = require('./codex-cli-provider/constants');
const {
  buildCodexCliExecArgs,
  buildCodexCliExecResumeArgs
} = require('./codex-cli-provider/args');
const {
  getCodexCliCatalog,
  requestCodexCliCatalog
} = require('./codex-cli-provider/catalog');
const {
  getCodexCliModel,
  getCodexCliReasoningEffort,
  prepareCodexRuntime,
  setCodexCliModel,
  setCodexCliReasoningEffort
} = require('./codex-cli-provider/runtime-gateway');
const {
  extractCodexJsonEventProgress,
  extractCodexJsonEventThinking,
  extractCodexJsonEventToolCall
} = require('./codex-cli-provider/event-progress');
const { extractCodexJsonEventText } = require('./codex-cli-provider/event-text');
const {
  ensureCodexCliAgentsFile,
  ensureCodexCliGlobalAgentsFile,
  ensureCodexCliProjectSkillFolder
} = require('./codex-cli-provider/guidance');
const {
  clearCodexCliStoredLogin,
  extractCodexLoginUrl,
  getCodexLoginStatus,
  invalidateCodexLoginStatusCache,
  launchCodexCliLogin
} = require('./codex-cli-provider/login');
const {
  getCodexCliAuthFilePath,
  resolveCodexCliRuntimeHomeDirectory
} = require('./codex-cli-provider/paths');
const { readCodexCliOAuthProfile } = require('./codex-cli-provider/auth-profile');
const { requestCodexCliText } = require('./codex-cli-provider/request');
const { requestCodexCliUsage } = require('./codex-cli-provider/usage');
const { ensureCodexCliRuntimeHome } = require('./codex-cli-provider/runtime-home');
const { extractCodexJsonEventSessionId } = require('./codex-cli-provider/session-id');

module.exports = {
  OPENAI_CODEX_LOGIN_URL,
  buildHikariCodexAgentsInstructions,
  buildCodexCliExecArgs,
  buildCodexCliExecResumeArgs,
  clearCodexCliStoredLogin,
  ensureCodexCliAgentsFile,
  ensureCodexCliGlobalAgentsFile,
  ensureCodexCliProjectSkillFolder,
  ensureCodexCliRuntimeHome,
  extractCodexJsonEventProgress,
  extractCodexJsonEventSessionId,
  extractCodexJsonEventText,
  extractCodexJsonEventThinking,
  extractCodexJsonEventToolCall,
  extractCodexLoginUrl,
  getCodexCliAuthFilePath,
  getCodexCliCatalog,
  getCodexCliModel,
  getCodexCliReasoningEffort,
  getCodexLoginStatus,
  invalidateCodexLoginStatusCache,
  launchCodexCliLogin,
  readCodexCliOAuthProfile,
  requestCodexCliCatalog,
  requestCodexCliUsage,
  prepareCodexRuntime,
  resolveCodexCliRuntimeHomeDirectory,
  setCodexCliModel,
  setCodexCliReasoningEffort,
  requestCodexCliText
};
