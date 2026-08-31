'use strict';

const {
  defaultCleanText,
  resolveToolParserPayload,
  buildToolCitations,
  buildExecutorSummary
} = require('./tool-executors/shared.js');
const { registerLabToolExecutors } = require('./tool-executors/lab-executors.js');
const { registerSystemToolExecutors } = require('./tool-executors/system-executors.js');
const { registerViewerToolExecutors } = require('./tool-executors/viewer-executors.js');
const { registerResearchToolExecutors } = require('./tool-executors/research-executors.js');

function registerAgentToolExecutors(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const genericAgentToolRuntime = deps.genericAgentToolRuntime;
  const inventoryLookupRuntime = deps.inventoryLookupRuntime || {};
  const notebookLookupRuntime = deps.notebookLookupRuntime || {};
  const webSearchRuntime = deps.webSearchRuntime || {};
  const literatureSearchRuntime = deps.literatureSearchRuntime || {};
  const purchaseRecommendationRuntime = deps.purchaseRecommendationRuntime || {};
  const pythonSandboxToolRuntime = deps.pythonSandboxToolRuntime || {};
  const commandLineRuntime = deps.commandLineRuntime || {};
  const notebookDraftRuntime = deps.notebookDraftRuntime || {};
  const protocolMatchingRuntime = deps.protocolMatchingRuntime || {};
  const notebookGenerationRuntime = deps.notebookGenerationRuntime || {};
  const subAgentRuntime = deps.subAgentRuntime || {};
  const containerRuntime = deps.containerRuntime || {};
  const assayTableRuntime = deps.assayTableRuntime || {};
  const plotlyGraphRuntime = deps.plotlyGraphRuntime || {};
  const sequenceAgentRuntime = deps.sequenceAgentRuntime || {};
  const memoryRuntime = deps.memoryRuntime || {};
  const paperDownloadRuntime = deps.paperDownloadRuntime || {};
  const paperAnalysisRuntime = deps.paperAnalysisRuntime || {};
  const paperWikiSearchRuntime = deps.paperWikiSearchRuntime || {};
  const protocolGenerationRuntime = deps.protocolGenerationRuntime || {};
  const protocolSaveRuntime = deps.protocolSaveRuntime || {};
  const agentAppApi = deps.agentAppApi && typeof deps.agentAppApi === 'object'
    ? deps.agentAppApi
    : {};
  const getAgentPythonSandboxRoot = typeof deps.getAgentPythonSandboxRoot === 'function'
    ? deps.getAgentPythonSandboxRoot
    : (() => '');
  const hydrateSnapshotFromBundle = typeof deps.hydrateSnapshotFromBundle === 'function'
    ? deps.hydrateSnapshotFromBundle
    : null;
  const getDefaultDataFilePath = typeof deps.getDefaultDataFilePath === 'function'
    ? deps.getDefaultDataFilePath
    : (() => '');

  if (!genericAgentToolRuntime || typeof genericAgentToolRuntime.registerToolExecutor !== 'function') {
    return [];
  }

  const executorContext = {
    cleanText,
    inventoryLookupRuntime,
    notebookLookupRuntime,
    protocolMatchingRuntime,
    notebookGenerationRuntime,
    notebookDraftRuntime,
    assayTableRuntime,
    plotlyGraphRuntime,
    protocolGenerationRuntime,
    subAgentRuntime,
    memoryRuntime,
    containerRuntime,
    pythonSandboxToolRuntime,
    commandLineRuntime,
    sequenceAgentRuntime,
    webSearchRuntime,
    literatureSearchRuntime,
    paperDownloadRuntime,
    purchaseRecommendationRuntime,
    paperAnalysisRuntime,
    paperWikiSearchRuntime,
    protocolSaveRuntime,
    agentAppApi,
    getAgentPythonSandboxRoot,
    hydrateSnapshotFromBundle,
    getDefaultDataFilePath
  };

  registerLabToolExecutors(genericAgentToolRuntime, executorContext);
  registerSystemToolExecutors(genericAgentToolRuntime, executorContext);
  registerViewerToolExecutors(genericAgentToolRuntime, executorContext);
  registerResearchToolExecutors(genericAgentToolRuntime, executorContext);

  return [
    'inventory-lookup',
    'notebook-lookup',
    'protocol-matching',
    'notebook-generation',
    'notebook-draft',
    'python-sandbox',
    'command-line',
    'web-search',
    'sub-agent',
    'memory',
    'container',
    'assay-table',
    'plotly-graph',
    'sequence-viewer',
    'sequence-edit',
    'literature-search',
    'purchase-recommendation',
    'paper-download',
    'paper-analysis',
    'paper-search',
    'protocol-generation'
  ];
}

module.exports = {
  registerAgentToolExecutors,
  resolveToolParserPayload,
  buildToolCitations,
  buildExecutorSummary
};
