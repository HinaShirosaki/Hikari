'use strict';

function cleanText(value, maxLength = 2400) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function buildHikariCodexDesktopMcpSetupPrompt(options = {}) {
  const managedConfigPath = cleanText(
    options.managedConfigPath || options.configPath,
    2400
  );
  if (!managedConfigPath) {
    return '';
  }

  return [
    'Connect this Codex Desktop installation to the currently running Hikari MCP. Perform the setup; do not only explain the steps.',
    '',
    `Hikari prepared a live Codex configuration at ${JSON.stringify(managedConfigPath)}.`,
    '',
    '1. Read that file and extract the complete block from `# HIKARI_MCP_CONFIG_START` through `# HIKARI_MCP_CONFIG_END`, including both marker lines.',
    '2. Resolve this Codex host\'s user configuration file: use `$CODEX_HOME/config.toml` when `CODEX_HOME` is set, otherwise use `~/.codex/config.toml`.',
    '3. Merge the Hikari block into the user configuration. Replace the existing marked Hikari block if present; otherwise append it. Preserve every unrelated setting and do not write a project-scoped `.codex/config.toml`.',
    '4. Treat the Hikari MCP token in that block as confidential. Do not print it in chat, logs, command output, or the final response.',
    '5. Validate that the resulting TOML parses and that the `hikari` server is enabled. If the Codex CLI is available, also run `codex mcp list` and confirm that `hikari` is listed.',
    '',
    'Hikari must remain open because this configuration connects to its live local app process. Newly configured MCP servers load after Codex restarts, so do not claim the Hikari tools are connected in this current task. Once the merge is complete, ask me to open Settings > MCP servers and select Restart. After restart, `/mcp` should show `hikari` as connected.'
  ].join('\n');
}

module.exports = {
  buildHikariCodexDesktopMcpSetupPrompt
};
