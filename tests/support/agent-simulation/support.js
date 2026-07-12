const { buildAgentSimulationSnapshot } = require('./snapshot.js');
const {
  pickMockRows,
  buildMockToolArgs,
  buildMockToolDispatch
} = require('./mock-tools.js');

function createAgentSimulationSupport(deps = {}) {
  const {
    assert,
    agentIntentParser,
    agentRouting,
    agentTools,
    AGENT_SIMULATION_DISPATCH_TOOL_NAMES
  } = deps;

  async function runSimulatedAgentTurn({
    message,
    snapshot = buildAgentSimulationSnapshot(),
    allowWriteTools = false,
    writeIntent = false,
    parserPayload = null
  }) {
    const availableToolNames = [...AGENT_SIMULATION_DISPATCH_TOOL_NAMES];
    const sourceText = String(message || '');
    const sourceLower = sourceText.toLowerCase();

    const inferPrimaryIntent = (text) => {
      const source = String(text || '').toLowerCase();
      if (/\b(compare .+ vs|extract methods?|extract reagents?|key figures?)\b/.test(source)) return 'paper_analysis';
      if (/\b(mw|molecular weight|inventory|stock|where is|cas)\b/.test(source)) return 'inventory_lookup';
      if (/\b(last time|history|notebook|workflow step)\b/.test(source)) return 'notebook_lookup';
      if (/\bproject\b/.test(source)) return 'project_science_question';
      if (/\bpaper|pdf|journal|literature|publication\b/.test(source)) return 'paper_analysis';
      if (/\bpython|csv|plot|compute|code|script\b/.test(source)) return 'result_analysis';
      if (/\b(i grew|i did|i ran|transfection|protocol|notebook)\b/.test(source)) return 'protocol_to_notebook';
      return 'general_science_question';
    };

    const primaryIntent = inferPrimaryIntent(message);
    const inferProjectName = () => {
      const explicit = sourceText.match(/\bproject\s+([a-z0-9][a-z0-9\- _]{1,60})/i);
      if (explicit) return String(explicit[1] || '').trim();
      if (sourceLower.includes('atlas')) return 'Atlas';
      return null;
    };
    const inferPaperTitle = () => {
      const quoted = sourceText.match(/["“”']([^"“”']{4,220})["“”']/);
      return quoted ? String(quoted[1] || '').trim() : null;
    };
    const inferInventoryItem = () => {
      const mwMatch = sourceText.match(/\b(?:mw|molecular weight)\s+(?:of\s+)?([a-z0-9\- ]{2,80})/i);
      if (mwMatch) return String(mwMatch[1] || '').trim();
      const whereMatch = sourceText.match(/\bwhere is\s+([a-z0-9\- ]{2,80})/i);
      if (whereMatch) return String(whereMatch[1] || '').trim();
      return null;
    };

    const inferredEntities = {
      activity_type: /\b(transfection|culture|grew|purif|assay|expression)\b/i.test(sourceText)
        ? (sourceLower.includes('transfection') ? 'transfection' : 'lab activity')
        : null,
      project_name: inferProjectName(),
      protocol_name: null,
      protein_name: /\b(pd-1|pd1)\b/i.test(sourceText) ? 'PD-1' : null,
      compound_name: null,
      inventory_item: inferInventoryItem(),
      cell_line: /\b(hek293|expi293|cho|293t)\b/i.test(sourceText)
        ? String((sourceText.match(/\b(hek293|expi293|cho|293t)\b/i) || [])[1] || '').toUpperCase()
        : null,
      paper_title: inferPaperTitle(),
      workflow_step: /\b(transfection|assay|purification)\b/i.test(sourceText)
        ? String((sourceText.match(/\b(transfection|assay|purification)\b/i) || [])[1] || '')
        : null,
      requested_output: /\b(analyze|analysis|plot|compute|compare|extract)\b/i.test(sourceText) ? 'analysis' : null
    };

    if (primaryIntent === 'inventory_lookup' && inferredEntities.inventory_item && !inferredEntities.compound_name) {
      inferredEntities.compound_name = inferredEntities.inventory_item;
    }

    const fallbackParserPayload = {
      primary_intent: primaryIntent,
      needs_clarification: false,
      clarification_reason: null,
      entities: inferredEntities,
      inventory_search: { normalized_query: null, candidate_terms: [], aliases: [], search_mode: null },
      protocol_candidates: primaryIntent === 'protocol_to_notebook' ? [inferredEntities.protocol_name || 'General Protocol'] : [],
      reasoning_summary: 'test parser payload'
    };

    const parserResult = agentIntentParser.normalizeIntentParserPayload(parserPayload || fallbackParserPayload);
    assert.equal(parserResult.ok, true);

    const routing = agentRouting.buildRoutingDecisionFromIntentParser({
      parserPayload: parserResult.payload,
      message,
      snapshot,
      availableToolNames,
      writeIntent
    });

    const requiresApproval = writeIntent && !allowWriteTools;
    if (routing.plan.needs_clarification) {
      return { routing, toolOutputs: [], toolTrace: [], citations: [], executedToolNames: [], requiresApproval, dispatchCalls: [] };
    }

    const { dispatch, calls } = buildMockToolDispatch(snapshot);
    const toolNames = routing.plan.needs_tools
      ? [...new Set(Array.isArray(routing.plan.selected_tool_names) ? routing.plan.selected_tool_names : [])]
      : [];

    const toolOutputs = [];
    const toolTrace = [];
    const citations = [];

    for (const toolName of toolNames) {
      const args = buildMockToolArgs(toolName, message, snapshot);
      const result = await agentTools.executeToolCall(toolName, args, {
        allowWriteTools,
        dispatch,
        fuzzyVocabulary: ['atlas', 'biotin', 'pd-1', 'transfection', 'assay', 'elisa']
      });
      toolOutputs.push(result);
      toolTrace.push({ tool: toolName, summary: result.summary, ok: result.ok === true });
      if (Array.isArray(result.citations)) {
        citations.push(...result.citations);
      }
    }

    return {
      routing,
      toolOutputs,
      toolTrace,
      citations,
      executedToolNames: toolOutputs.map((item) => item.tool_name),
      requiresApproval,
      dispatchCalls: calls
    };
  }

  return {
    buildAgentSimulationSnapshot,
    pickMockRows,
    buildMockToolArgs,
    buildMockToolDispatch,
    runSimulatedAgentTurn
  };
}

module.exports = {
  createAgentSimulationSupport
};
