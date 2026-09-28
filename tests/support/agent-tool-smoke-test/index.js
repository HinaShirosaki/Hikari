'use strict';

const os = require('node:os');
const path = require('node:path');

const { AGENT_TOOL_CATALOG } = require('../../../src/main/agent/tools/agent-tool-loading.js');
const { runPythonSandbox } = require('../../../src/main/agent/tools/agent-python-sandbox.js');
const { cleanText } = require('./utils.js');
const { buildSmokeSnapshot } = require('./snapshot.js');
const { createStructuredJsonResponder } = require('./structured-responder.js');
const { normalizeToolSmokeItem } = require('./result-formatting.js');
const { createLabSmokeChecks } = require('./lab-checks.js');
const { createSystemSmokeChecks } = require('./system-checks.js');
const { createResearchSmokeChecks } = require('./research-checks.js');

function createAgentToolSmokeTestRuntime(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const pythonSandboxFn = typeof deps.runPythonSandbox === 'function' ? deps.runPythonSandbox : runPythonSandbox;
  const pythonSandboxRoot = cleanText(deps.pythonSandboxRoot)
    || path.join(os.tmpdir(), 'hikari-agent-tool-smoke-python');
  const structuredResponder = createStructuredJsonResponder();

  const {
    smokeInventoryLookup,
    smokeNotebookLookup,
    smokeProtocolMatching,
    smokeNotebookGeneration,
    smokeNotebookDraft,
    smokeAssayTable,
    smokePlotlyGraph,
    smokeProtocolGeneration
  } = createLabSmokeChecks({ structuredResponder });
  const {
    smokePythonSandbox,
    smokeCommandLine,
    smokeSubAgent,
    smokeMemory,
    smokeContainer
  } = createSystemSmokeChecks({ now, pythonSandboxFn, pythonSandboxRoot });
  const {
    smokeLiteratureSearch,
    smokeWebSearch,
    smokePaperDownload,
    smokePaperAnalysis,
    smokePaperSearch,
    smokePurchaseRecommendation
  } = createResearchSmokeChecks({ structuredResponder });

  const smokeRunners = {
    'inventory-lookup': async (options = {}) => smokeInventoryLookup(buildSmokeSnapshot(), options),
    'notebook-lookup': async (options = {}) => smokeNotebookLookup(buildSmokeSnapshot(), options),
    'protocol-matching': async (options = {}) => smokeProtocolMatching(buildSmokeSnapshot(), options),
    'notebook-generation': async (options = {}) => smokeNotebookGeneration(buildSmokeSnapshot(), options),
    'notebook-draft': async (options = {}) => smokeNotebookDraft(buildSmokeSnapshot(), options),
    'python-sandbox': async (options = {}) => smokePythonSandbox(options),
    'command-line': async (options = {}) => smokeCommandLine(options),
    'web-search': async (options = {}) => smokeWebSearch(options),
    'sub-agent': async (options = {}) => smokeSubAgent(options),
    memory: async (options = {}) => smokeMemory(options),
    container: async (options = {}) => smokeContainer(options),
    'assay-table': async (options = {}) => smokeAssayTable(options),
    'plotly-graph': async (options = {}) => smokePlotlyGraph(options),
    'literature-search': async (options = {}) => smokeLiteratureSearch(options),
    'purchase-recommendation': async (options = {}) => smokePurchaseRecommendation(options),
    'paper-download': async (options = {}) => smokePaperDownload(options),
    'paper-analysis': async (options = {}) => smokePaperAnalysis(options),
    'paper-search': async (options = {}) => smokePaperSearch(options),
    'protocol-generation': async (options = {}) => smokeProtocolGeneration(options)
  };

  const missingSmokeTests = AGENT_TOOL_CATALOG
    .map((entry) => cleanText(entry?.name))
    .filter(Boolean)
    .filter((toolName) => typeof smokeRunners[toolName] !== 'function');
  if (missingSmokeTests.length) {
    throw new Error(`Missing smoke tests for agent tools: ${missingSmokeTests.join(', ')}.`);
  }

  async function runToolEntry(toolName, options = {}) {
    const normalizedToolName = cleanText(toolName);
    const startedAt = Date.now();
    if (!normalizedToolName || typeof smokeRunners[normalizedToolName] !== 'function') {
      return normalizeToolSmokeItem(normalizedToolName || 'unknown-tool', {
        ok: false,
        status: 'error',
        error: `Unknown agent tool "${normalizedToolName || 'unknown-tool'}".`,
        summary: `Unknown agent tool "${normalizedToolName || 'unknown-tool'}".`
      }, 0, {
        requestMessage: options.message
      });
    }
    try {
      const result = await smokeRunners[normalizedToolName](options);
      return normalizeToolSmokeItem(normalizedToolName, result, Date.now() - startedAt, {
        requestMessage: options.message
      });
    } catch (error) {
      return normalizeToolSmokeItem(normalizedToolName, {
        ok: false,
        status: 'error',
        error: cleanText(error?.message || error) || `${normalizedToolName} smoke test failed.`,
        summary: `${normalizedToolName} smoke test failed.`
      }, Date.now() - startedAt, {
        requestMessage: options.message
      });
    }
  }

  async function runTool(options = {}) {
    const toolName = cleanText(options?.toolName);
    const requestMessage = cleanText(options?.message);
    const item = await runToolEntry(toolName, {
      message: requestMessage,
      strict: false
    });
    return {
      ok: item.ok === true,
      run_mode: 'single',
      status: item.ok === true ? 'completed' : 'completed_with_failures',
      tool_name: toolName || item.tool_name,
      request_message: requestMessage,
      tool_count: 1,
      passed_count: item.ok === true ? 1 : 0,
      failed_count: item.ok === true ? 0 : 1,
      items: [item],
      summary: item.ok === true
        ? `Manual tool test completed for ${item.tool_name}: ${item.result_message || item.summary}`
        : `Manual tool test failed for ${item.tool_name}: ${item.error || item.summary}`
    };
  }

  async function runAllTools() {
    const items = [];
    for (const entry of AGENT_TOOL_CATALOG) {
      const toolName = cleanText(entry?.name);
      items.push(await runToolEntry(toolName, { strict: true }));
    }

    const failedItems = items.filter((item) => item.ok !== true);
    const passedCount = items.length - failedItems.length;
    const failedNames = failedItems.map((item) => item.tool_name);
    return {
      ok: failedItems.length === 0,
      run_mode: 'all',
      status: failedItems.length === 0 ? 'completed' : 'completed_with_failures',
      tool_count: items.length,
      passed_count: passedCount,
      failed_count: failedItems.length,
      items,
      summary: failedItems.length === 0
        ? `Manual tool smoke test completed: ${passedCount}/${items.length} tools passed.`
        : `Manual tool smoke test completed: ${passedCount}/${items.length} tools passed. Failed: ${failedNames.join(', ')}.`
    };
  }

  return {
    toolNames: AGENT_TOOL_CATALOG.map((entry) => cleanText(entry?.name)).filter(Boolean),
    runTool,
    runAllTools
  };
}

module.exports = {
  createAgentToolSmokeTestRuntime
};
