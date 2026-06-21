'use strict';

const { requestCodexCliText } = require('../../lib/codex-cli-provider');
const {
  LLM_PROVIDERS,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_ENDPOINTS,
  DEFAULT_AGENT_MODELS,
  ALLOW_API_AGENT,
  inferLlmProviderFromEndpoint,
  normalizeLlmProvider,
  normalizeAgentLlmProvider,
  defaultLlmEndpointForProvider,
  defaultAgentModelForProvider
} = require('../../generated/llm-provider-config.generated.js');
const { createMainAgentServices } = require('../../helpers/main/create-main-agent-services.js');
const { SERVICE_POLICIES } = require('../service-lifecycle');
const { createMainMcpService } = require('../services/create-mcp-service');
const { createMainCodexService } = require('../services/create-codex-service');

function createAgentServiceDefinitions(context = {}) {
  const { BrowserWindow, processObject } = context;

  return [
    {
      key: 'agent-foundation',
      dependsOn: ['app-metadata', 'storage', 'agent-logging'],
      create: ({ dependencies, getService }) => {
        const { appPaths, cleanText } = dependencies['app-metadata'];
        const storage = dependencies.storage;
        const agentLogging = dependencies['agent-logging'];
        return createMainAgentServices({
          LLM_PROVIDERS,
          DEFAULT_LLM_PROVIDER,
          DEFAULT_LLM_ENDPOINTS,
          DEFAULT_AGENT_MODELS,
          inferLlmProviderFromEndpoint,
          normalizeLlmProvider,
          normalizeAgentLlmProvider,
          defaultLlmEndpointForProvider,
          defaultAgentModelForProvider,
          cleanText,
          appendAgentChatLogEntry: agentLogging.agentLogRuntime.appendAgentChatLogEntry,
          requestCodexCliText,
          getCodexCliWorkingDirectory: appPaths.getCodexCliWorkingDirectory,
          getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
          BrowserWindow,
          getAgentPythonSandboxRoot: appPaths.getAgentPythonSandboxRoot,
          getAgentMemoryFilePath: appPaths.getAgentMemoryFilePath,
          getBundlePaths: storage.getBundlePaths,
          hydrateSnapshotFromBundle: storage.hydrateSnapshotFromBundle,
          syncBundleFromSnapshot: storage.syncBundleFromSnapshot,
          runSubAgentTurn: (input) => {
            const codexService = getService('codex');
            if (!codexService || typeof codexService.runSubAgentTurn !== 'function') {
              throw new Error('Codex service is not ready for delegated sub-agent work.');
            }
            return codexService.runSubAgentTurn(input);
          }
        });
      }
    },
    {
      key: 'mcp',
      dependsOn: ['app-metadata', 'storage', 'agent-foundation'],
      policy: SERVICE_POLICIES.BEST_EFFORT,
      create: ({ dependencies }) => {
        const { appPaths, cleanText } = dependencies['app-metadata'];
        return createMainMcpService({
          cleanText,
          agentToolRuntime: dependencies['agent-foundation'].agentToolRuntime,
          getCodexCliWorkingDirectory: appPaths.getCodexCliWorkingDirectory,
          getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
          getBundlePaths: dependencies.storage.getBundlePaths,
          processObject
        });
      },
      start: async ({ service }) => {
        const result = await service.initialize({ reason: 'app_ready' });
        if (result?.ok === false) {
          const error = new Error('Hikari MCP initialization did not complete successfully.');
          error.result = result;
          throw error;
        }
        return result;
      },
      stop: ({ service }) => service.stop()
    },
    {
      key: 'codex',
      dependsOn: ['app-metadata', 'storage', 'agent-foundation', 'mcp'],
      create: ({ dependencies }) => {
        const { appPaths, cleanText } = dependencies['app-metadata'];
        return createMainCodexService({
          cleanText,
          requestCodexCliText,
          getCodexCliWorkingDirectory: appPaths.getCodexCliWorkingDirectory,
          getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
          getCodexCliHomePath: appPaths.getCodexCliHomePath,
          getBundlePaths: dependencies.storage.getBundlePaths,
          syncBundleFromSnapshot: dependencies.storage.syncBundleFromSnapshot,
          mcpService: dependencies.mcp,
          agentFoundation: dependencies['agent-foundation'],
          processObject
        });
      }
    },
    {
      key: 'agent-controllers',
      dependsOn: ['agent-foundation', 'codex'],
      create: ({ dependencies }) => ({
        ...dependencies['agent-foundation'],
        allowApiAgent: ALLOW_API_AGENT,
        codexAgentRuntime: dependencies.codex.codexAgentRuntime
      })
    }
  ];
}

module.exports = {
  createAgentServiceDefinitions
};
