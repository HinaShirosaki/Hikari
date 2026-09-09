'use strict';

const { HIKARI_MCP_TOOL_NAMES } = require('./instructions.js');

const HIKARI_MCP_TOOL_NAME_SET = new Set(HIKARI_MCP_TOOL_NAMES);

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeDisabledMcpToolNames(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }
  const disabled = new Set(
    value
      .map((item) => String(item || '').trim())
      .filter((name) => HIKARI_MCP_TOOL_NAME_SET.has(name))
  );
  return HIKARI_MCP_TOOL_NAMES.filter((name) => disabled.has(name));
}

function getAgentSettings(context = {}) {
  const source = ensureObject(context);
  const snapshot = ensureObject(source.snapshot);
  const settings = ensureObject(
    snapshot.settings
      || source.settings
  );
  return ensureObject(settings.agent);
}

function getDisabledHikariMcpToolNames(context = {}) {
  const agentSettings = getAgentSettings(context);
  return normalizeDisabledMcpToolNames(
    agentSettings.disabledMcpToolNames
      || agentSettings.disabled_mcp_tool_names
  );
}

function isHikariMcpToolEnabled(name = '', context = {}) {
  const toolName = String(name || '').trim();
  return HIKARI_MCP_TOOL_NAME_SET.has(toolName)
    && !getDisabledHikariMcpToolNames(context).includes(toolName);
}

function getEnabledHikariMcpToolNames(context = {}) {
  const disabled = new Set(getDisabledHikariMcpToolNames(context));
  return HIKARI_MCP_TOOL_NAMES.filter((name) => !disabled.has(name));
}

module.exports = {
  getDisabledHikariMcpToolNames,
  getEnabledHikariMcpToolNames,
  isHikariMcpToolEnabled,
  normalizeDisabledMcpToolNames
};
