module.exports = function registerCodexCliProviderSuite(context = {}) {
  const registerParts = [
    require('./codex-cli-provider-suite/cli-discovery.js'),
    require('./codex-cli-provider-suite/cli-updater.js'),
    require('./codex-cli-provider-suite/mcp-startup.js'),
    require('./codex-cli-provider-suite/model-selection-and-exec-args.js'),
    require('./codex-cli-provider-suite/mcp-gateway-tool-surface.js'),
    require('./codex-cli-provider-suite/agent-runtime-prompts.js'),
    require('./codex-cli-provider-suite/session-resume-and-mcp-servers.js'),
    require('./codex-cli-provider-suite/exec-streaming.js'),
    require('./codex-cli-provider-suite/auth-and-session-transcripts.js'),
    require('./codex-cli-provider-suite/auth-clearing.js'),
    require('./codex-cli-provider-suite/scheduled-tasks-and-paper-finding.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
