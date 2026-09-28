'use strict';

const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createAgentInventoryLookupRuntime } = require('../../../src/main/agent/tools/agent-inventory-lookup.js');
const { createAgentNotebookLookupRuntime } = require('../../../src/main/agent/tools/agent-notebook-lookup.js');
const { createProtocolMatchingRuntime } = require('../../../src/main/agent/tools/agent-protocol-matching.js');
const { createNotebookGenerationRuntime } = require('../../../src/main/agent/tools/agent-notebook-generation.js');
const { createNotebookDraftRuntime } = require('../../../src/main/agent/tools/agent-notebook-draft.js');
const { createAgentAssayTableRuntime } = require('../../../src/main/agent/tools/agent-assay-table.js');
const { createAgentPlotlyGraphRuntime } = require('../../../src/main/agent/tools/agent-plotly-graph.js');
const { createProtocolGenerationRuntime } = require('../../../src/main/agent/tools/agent-protocol-generation.js');
const { createProtocolSaveRuntime } = require('../../../src/main/agent/tools/agent-protocol-save.js');
const { asArray, cloneJson } = require('../../../src/main/lib/normalize.js');
const {
  hydrateSnapshotFromBundle,
  syncBundleFromSnapshot
} = require('../../../src/main/storage');
const {
  cleanText,
  uniqueStrings,
  resolveToolMessage,
  resolveFocusedToolText
} = require('./utils.js');

function createLabSmokeChecks({ structuredResponder } = {}) {

  async function smokeInventoryLookup(snapshot, options = {}) {
    const runtime = createAgentInventoryLookupRuntime();
    const requestMessage = resolveToolMessage(options.message, 'Where is the Atlas construct sample?');
    const focusedQuery = resolveFocusedToolText(options.message, 'Atlas construct sample');
    const result = await runtime.executeInventoryLookup({
      message: requestMessage,
      parserPayload: {
        entities: {
          inventory_item: focusedQuery,
          requested_output: 'location',
          compound_name: null
        },
        inventory_search: {
          candidate_terms: uniqueStrings([focusedQuery, requestMessage, 'Atlas construct sample', 'atlas', 'construct'], 5)
        }
      },
      snapshot,
      limit: 5
    });
    const itemCount = asArray(result.items).length;
    return {
      ...result,
      ok: options.strict === true ? itemCount > 0 : cleanText(result.status) !== 'error',
      summary: itemCount > 0
        ? `Found ${itemCount} inventory match${itemCount === 1 ? '' : 'es'} for ${cleanText(result.query || focusedQuery)}.`
        : `No inventory matches found for ${cleanText(result.query || focusedQuery)}.`
    };
  }

  async function smokeNotebookLookup(snapshot, options = {}) {
    const runtime = createAgentNotebookLookupRuntime();
    const requestMessage = resolveToolMessage(options.message, 'Find the Cell Prep notebook entry.');
    const focusedQuery = resolveFocusedToolText(options.message, 'Cell Prep');
    const result = await runtime.execute({
      message: focusedQuery || requestMessage,
      parserPayload: {
        entities: {
          protocol_name: focusedQuery,
          requested_output: 'notebook_lookup'
        }
      },
      snapshot,
      limit: 5
    });
    const items = asArray(result.items);
    const itemCount = items.length;
    return {
      status: itemCount ? 'matched' : 'no_match',
      query: cleanText(result.query || focusedQuery),
      source: cleanText(result.source) || 'fallback_json',
      backfilled_sql: result.backfilled_sql === true,
      items,
      ok: options.strict === true ? itemCount > 0 : true,
      summary: itemCount > 0
        ? `Found ${itemCount} notebook match${itemCount === 1 ? '' : 'es'} for ${cleanText(result.query || focusedQuery)}.`
        : `No notebook matches found for ${cleanText(result.query || focusedQuery)}.`
    };
  }

  async function smokeProtocolMatching(snapshot, options = {}) {
    const runtime = createProtocolMatchingRuntime({
      requestStructuredJsonPayload: structuredResponder
    });
    const requestMessage = resolveToolMessage(options.message, 'I ran the Cell Prep workflow.');
    const focusedQuery = resolveFocusedToolText(options.message, 'Cell Prep');
    const result = await runtime.selectProtocol({
      protocols: asArray(snapshot.protocols),
      protocolCandidates: uniqueStrings([focusedQuery, 'Cell Prep'], 3),
      message: requestMessage,
      conversation: [],
      parserPayload: {
        entities: {
          activity_type: 'cell prep',
          protocol_name: focusedQuery
        }
      }
    });
    const selectedProtocolName = cleanText(result.selected_protocol?.name);
    return {
      ok: options.strict === true ? Boolean(result.selected_protocol?.id) : true,
      status: cleanText(result.selection_method) || (selectedProtocolName ? 'matched' : 'no_match'),
      summary: selectedProtocolName
        ? `Selected ${selectedProtocolName} during protocol matching.`
        : 'Protocol matching completed without selecting a protocol.',
      selected_protocol: result.selected_protocol,
      rationale: cleanText(result.rationale)
    };
  }

  async function smokeNotebookGeneration(snapshot, options = {}) {
    const runtime = createNotebookGenerationRuntime({
      requestStructuredJsonPayload: structuredResponder
    });
    const protocol = cloneJson(asArray(snapshot.protocols)[0], {});
    const project = cloneJson(asArray(snapshot.projects)[0], {});
    const requestMessage = resolveToolMessage(options.message, 'I completed Cell Prep on HEK293 sample TUBE42.');
    const result = await runtime.generateNotebook({
      message: requestMessage,
      conversation: [],
      snapshot,
      parserPayload: {
        entities: {
          activity_type: 'cell prep',
          project_name: 'Atlas',
          protocol_name: 'Cell Prep',
          cell_line: 'HEK293',
          requested_output: 'notebook page'
        },
        inventory_search: {
          candidate_terms: []
        }
      },
      selectedProtocol: protocol,
      project
    });
    return {
      ok: options.strict === true
        ? cleanText(result.status) === 'completed'
        : cleanText(result.status) !== 'error',
      status: cleanText(result.status),
      summary: cleanText(result.notebook?.entry_template?.result) || 'Notebook generation smoke test completed.',
      rendered_step_preview: cleanText(asArray(result.notebook?.rendered_steps)[0])
    };
  }

  async function smokeNotebookDraft(snapshot, options = {}) {
    const runtime = createNotebookDraftRuntime({
      requestStructuredJsonPayload: structuredResponder
    });
    const requestMessage = resolveToolMessage(options.message, 'Draft tomorrow’s next experiment for Atlas.');
    const result = await runtime.generateNotebookDraft({
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/responses',
      apiKey: 'smoke-test-key',
      model: 'gpt-5',
      message: requestMessage,
      conversation: [],
      snapshot,
      parserPayload: {
        primary_intent: 'notebook_draft',
        entities: {
          project_name: 'Atlas',
          workflow_step: 'next experiment',
          requested_output: 'planned notebook page'
        },
        protocol_candidates: ['Viability Assay']
      },
      project: {
        id: 'proj-1',
        name: 'Atlas'
      }
    });
    return {
      ...result,
      ok: options.strict === true
        ? cleanText(result.status) === 'proposal_ready'
        : cleanText(result.status) !== 'error',
      summary: cleanText(result.summary) || 'Notebook draft smoke test completed.'
    };
  }

  async function smokeAssayTable() {
    const runtime = createAgentAssayTableRuntime({
      now: (() => {
        let index = 0;
        const values = [
          '2026-03-22T12:00:00.000Z',
          '2026-03-22T12:00:01.000Z'
        ];
        return () => values[Math.min(index++, values.length - 1)];
      })()
    });
    const created = await runtime.execute({
      action: 'create',
      name: 'raw assay values',
      columns: ['condition', 'rep1', 'rep2', 'rep3'],
      rows: [
        ['control', 1.1, 1.2, 1.3],
        ['treated', 2.1, 2.4, 2.2]
      ],
      source: 'direct_literal:smoke'
    });
    const derived = await runtime.execute({
      action: 'derive',
      source_table_id: created?.table?.id,
      include_source_columns: true,
      columns: [
        { name: 'avg_response', op: 'avg', operands: ['rep1', 'rep2', 'rep3'] },
        { name: 'sd_response', op: 'sd', operands: ['rep1', 'rep2', 'rep3'] }
      ]
    });
    const ok = created?.ok !== false
      && derived?.ok !== false
      && derived?.table?.columns?.includes('avg_response')
      && derived?.table?.columns?.includes('sd_response');
    return {
      ...derived,
      ok,
      status: ok ? 'completed' : 'error',
      items: derived?.table ? [derived.table] : [],
      summary: ok
        ? `Assay table smoke test derived ${derived.table.id}.`
        : 'Assay table smoke test failed.',
      error: ok ? '' : uniqueStrings([
        created?.error,
        derived?.error
      ], 4).join(' | ')
    };
  }

  async function smokePlotlyGraph() {
    const runtime = createAgentPlotlyGraphRuntime({
      now: (() => {
        let index = 0;
        const values = [
          '2026-03-22T12:00:00.000Z',
          '2026-03-22T12:00:01.000Z'
        ];
        return () => values[Math.min(index++, values.length - 1)];
      })()
    });
    const created = await runtime.execute({
      action: 'create',
      name: 'assay response',
      data: [{
        type: 'bar',
        x: ['control', 'treated'],
        y: [1.2, 2.23],
        error_y: {
          type: 'data',
          array: [0.1, 0.15],
          visible: true
        }
      }],
      layout: {
        title: { text: 'Assay response' },
        xaxis: { title: { text: 'Condition' } },
        yaxis: { title: { text: 'Response' } }
      },
      config: {
        responsive: true,
        displaylogo: false
      }
    });
    const inspected = await runtime.execute({
      action: 'inspect',
      id: created?.graph?.id
    });
    const ok = created?.ok !== false
      && inspected?.ok !== false
      && inspected?.inspection?.trace_count === 1
      && asArray(inspected?.inspection?.issues).length === 0;
    return {
      ...inspected,
      ok,
      status: ok ? 'completed' : 'error',
      items: inspected?.graph ? [inspected.graph] : [],
      summary: ok
        ? `Plotly graph smoke test inspected ${inspected.id}.`
        : 'Plotly graph smoke test failed.',
      error: ok ? '' : uniqueStrings([
        created?.error,
        inspected?.error
      ], 4).join(' | ')
    };
  }

  async function smokeProtocolGeneration(options = {}) {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'hikari-protocol-save-'));
    let emittedPayload = null;
    try {
      const runtime = createProtocolSaveRuntime({
        protocolGenerationRuntime: createProtocolGenerationRuntime(),
        hydrateSnapshotFromBundle,
        syncBundleFromSnapshot,
        getDefaultDataFilePath: () => '',
        emitProtocolSaved: (payload) => {
          emittedPayload = payload;
        }
      });
      const requestMessage = resolveToolMessage(options.message, 'Normalize and save the supplied protocol JSON.');
      const result = await runtime.saveProtocol({
        protocol: {
          name: 'Atlas Binder Purification',
          purpose: 'Purify the Atlas binder from clarified lysate.',
          materials: ['Ni-NTA resin', 'imidazole buffer'],
          steps: ['Clarify lysate.', 'Bind to Ni-NTA resin for [time].', 'Elute with imidazole.'],
          troubleshooting: 'Keep buffers cold during purification.'
        },
        result_summary: requestMessage,
        save: true
      }, {
        snapshot: {
          settings: {
            storagePath: tempDir
          },
          protocols: []
        }
      });
      return {
        ...result,
        ok: result?.ok !== false && Boolean(cleanText(emittedPayload?.protocol?.id)),
        summary: cleanText(result?.summary) || 'Protocol generation smoke test completed.'
      };
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    smokeInventoryLookup,
    smokeNotebookLookup,
    smokeProtocolMatching,
    smokeNotebookGeneration,
    smokeNotebookDraft,
    smokeAssayTable,
    smokePlotlyGraph,
    smokeProtocolGeneration
  };
}

module.exports = { createLabSmokeChecks };
