'use strict';

const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { AGENT_TOOL_CATALOG } = require('./agent-tool-call.js');
const { createAgentInventoryLookupRuntime } = require('./agent-inventory-lookup.js');
const { createAgentRecordLookupRuntime } = require('./agent-record-lookup.js');
const { createProtocolMatchingRuntime } = require('./agent-protocol-matching.js');
const { createNotebookGenerationRuntime } = require('./agent-notebook-generation.js');
const { runPythonSandbox } = require('./agent-python-sandbox.js');
const { createAgentSubAgentRuntime } = require('./agent-sub-agent.js');
const { createAgentMemoryRuntime } = require('./agent-memory.js');
const { createLiteratureSearchRuntime } = require('./agent-literature-search.js');
const { createPaperDownloadRuntime } = require('./agent-paper-download.js');
const { createPaperAnalysisRuntime } = require('./agent-paper-analysis.js');
const { createProtocolGenerationRuntime } = require('./agent-protocol-generation.js');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function uniqueStrings(values, max = 20) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 220);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key) || out.length >= max) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function buildSmokeSnapshot() {
  const timestamp = '2026-03-22T12:00:00.000Z';
  return {
    projects: [
      {
        id: 'proj-1',
        name: 'Atlas',
        summary: 'PD-1 binder optimization project.'
      }
    ],
    protocols: [
      {
        id: 'prot-1',
        name: 'Cell Prep',
        purpose: 'Prepare HEK293 cells for a downstream assay.',
        aliases: ['HEK293 prep', 'atlas cell prep'],
        projectId: 'proj-1',
        projectName: 'Atlas',
        steps: [
          {
            id: 'step-1',
            text: 'Record {{ph:run_date}} for {{ph:project_name}}.',
            placeholders: [
              { id: 'run_date', name: 'date' },
              { id: 'project_name', name: 'project name' }
            ]
          },
          {
            id: 'step-2',
            text: 'Use {{ph:cell_line}} with {{ph:protocol_name}} on [sample name].',
            placeholders: [
              { id: 'cell_line', name: 'cell line' },
              { id: 'protocol_name', name: 'protocol name' }
            ]
          }
        ]
      }
    ],
    notebookEntries: [
      {
        id: 'note-1',
        projectId: 'proj-1',
        projectName: 'Atlas',
        protocolId: 'prot-1',
        protocolName: 'Cell Prep',
        result: 'Prepared HEK293 cells for the Atlas assay.',
        updatedAt: timestamp
      }
    ],
    workflows: [
      {
        id: 'wf-1',
        name: 'Atlas Workflow',
        description: 'Run cell prep before viability assay.',
        projectId: 'proj-1',
        blocks: [
          { id: 'block-1', protocolId: 'prot-1' }
        ],
        links: [],
        updatedAt: timestamp
      }
    ],
    assays: [
      {
        id: 'assay-1',
        name: 'Atlas Viability Assay',
        projectId: 'proj-1',
        projectName: 'Atlas',
        updatedAt: timestamp
      }
    ],
    gelAnalyses: [
      {
        id: 'gel-1',
        name: 'Atlas QC Gel',
        projectId: 'proj-1',
        projectName: 'Atlas',
        updatedAt: timestamp
      }
    ],
    papers: [
      {
        id: 'paper-1',
        title: 'PD-1 Binder Methods',
        linkedType: 'project',
        linkedId: 'proj-1',
        linkedName: 'Atlas',
        summary: 'Describes a concise binder purification workflow.',
        methodsExtract: [
          {
            title: 'Purification',
            steps: [
              { action: 'Clarify lysate.' },
              { action: 'Bind clarified lysate to Ni-NTA resin.' }
            ]
          }
        ],
        keyReagents: [
          { name: 'Ni-NTA resin', type: 'resin', identifier: 'NTA-1', notes: 'For His-tag purification.' }
        ],
        updatedAt: timestamp
      }
    ],
    inventory: {
      '-20 Degree': [
        {
          id: 'container-1',
          name: 'Atlas Box',
          type: 'box81',
          wells: [
            { name: 'A1', content: 'Atlas construct sample' }
          ]
        }
      ]
    },
    samples: [
      {
        id: 'sample-1',
        code: 'ATLAS-1',
        name: 'Atlas construct sample',
        type: 'plasmid',
        notes: 'PD-1 construct',
        location: {
          storageType: 'freezer',
          freezer: '-20 Degree',
          box: 'Atlas Box',
          position: 'A1'
        },
        inventoryLink: {
          section: '-20 Degree',
          containerId: 'container-1',
          wellIndex: 0
        },
        chemicalLinks: [],
        updatedAt: timestamp
      }
    ],
    labInventory: {
      chemicals: [
        {
          id: 'chem-1',
          name: 'IPTG',
          aliases: ['isopropyl beta-d-thiogalactopyranoside'],
          zone: 'Lab Inventory',
          location: 'Shelf 4'
        }
      ]
    }
  };
}

function createStructuredJsonResponder() {
  return async function requestStructuredJsonPayload(options = {}) {
    const stage = cleanText(options.stage, 120);
    if (stage === 'paper_analysis_tool') {
      return {
        ok: true,
        payload: {
          brief_summary: 'The smoke-test paper context supports a short binder purification workflow.',
          key_findings: [
            'Ni-NTA resin is used for capture.',
            'Clarified lysate is loaded before elution.'
          ],
          method_overview: 'Clarify lysate, bind to resin, then elute the target protein.',
          protocol_candidate: {
            title: 'Atlas Binder Purification',
            purpose: 'Purify the Atlas binder from clarified lysate.',
            method_text: 'Clarify lysate, bind it to Ni-NTA resin for [time], then elute with imidazole.',
            materials: ['Ni-NTA resin', 'imidazole buffer'],
            steps: [
              'Clarify lysate.',
              'Bind clarified lysate to Ni-NTA resin for [time].',
              'Elute bound protein with imidazole.'
            ],
            notes: 'Keep buffers cold during purification.'
          },
          result_summary: 'Paper analysis smoke test completed.'
        }
      };
    }
    if (stage === 'protocol_generation') {
      return {
        ok: true,
        payload: {
          protocol: {
            name: cleanText(ensureObject(options.input).title, 220) || 'Generated Smoke-Test Protocol',
            purpose: 'Produce a concise purification workflow from the provided method evidence.',
            materials: ['Ni-NTA resin', 'imidazole buffer'],
            steps: [
              'Clarify lysate.',
              'Bind clarified lysate to Ni-NTA resin for [time].',
              'Elute bound protein with imidazole.'
            ],
            troubleshooting: [
              {
                problem: 'Low yield',
                possible_cause: 'Insufficient resin contact time',
                solution: 'Increase binding time before elution.'
              }
            ]
          },
          result_summary: 'Protocol generation smoke test completed.'
        }
      };
    }
    if (stage === 'protocol_tiebreak_llm') {
      return {
        ok: true,
        payload: {
          selected_protocol_id: null,
          selected_protocol_name: null,
          rationale: 'Smoke-test mode defers to deterministic ranking.'
        }
      };
    }
    if (stage === 'notebook_fill') {
      return {
        ok: true,
        payload: {
          filled_values: [],
          missing_placeholders: [],
          follow_up_questions: [],
          result_summary: 'Notebook fill smoke test completed.'
        }
      };
    }
    return {
      ok: false,
      error: `Unhandled smoke-test stage "${stage || 'unknown'}".`
    };
  };
}

function buildPreview(toolName, result) {
  const source = ensureObject(result);
  if (toolName === 'inventory-lookup') {
    return cleanText(source.items?.[0]?.name || source.items?.[0]?.id, 220);
  }
  if (toolName === 'record-lookup') {
    return cleanText(source.items?.[0]?.title || source.items?.[0]?.id, 220);
  }
  if (toolName === 'protocol-matching') {
    return cleanText(source.selected_protocol?.name, 220);
  }
  if (toolName === 'notebook-generation') {
    return cleanText(source.rendered_step_preview || source.summary, 220);
  }
  if (toolName === 'python-sandbox') {
    return cleanText(source.readback_files?.[0]?.path, 220);
  }
  if (toolName === 'sub-agent') {
    return cleanText(source.agent_id, 220);
  }
  if (toolName === 'literature-search') {
    return cleanText(source.items?.[0]?.title || source.items?.[0]?.accession, 220);
  }
  if (toolName === 'paper-download') {
    return cleanText(source.relative_path || source.file_name, 220);
  }
  if (toolName === 'paper-analysis') {
    return cleanText(source.generated_protocol?.name || source.paper_title, 220);
  }
  if (toolName === 'protocol-generation') {
    return cleanText(source.protocol?.name, 220);
  }
  return '';
}

function normalizeToolSmokeItem(toolName, result, durationMs) {
  const source = ensureObject(result);
  const summary = cleanText(source.summary || source.error || `${toolName} smoke test completed.`, 320);
  return {
    tool_name: cleanText(toolName, 120),
    ok: source.ok !== false,
    status: cleanText(source.status, 80) || (source.ok === false ? 'error' : 'ok'),
    summary,
    preview: buildPreview(toolName, source),
    error: source.ok === false ? cleanText(source.error, 600) : '',
    duration_ms: Math.max(0, Number(durationMs) || 0)
  };
}

function createAgentToolSmokeTestRuntime(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const pythonSandboxFn = typeof deps.runPythonSandbox === 'function' ? deps.runPythonSandbox : runPythonSandbox;
  const pythonSandboxRoot = cleanText(deps.pythonSandboxRoot, 1200)
    || path.join(os.tmpdir(), 'enana-agent-tool-smoke-python');
  const structuredResponder = createStructuredJsonResponder();

  async function smokeInventoryLookup(snapshot) {
    const runtime = createAgentInventoryLookupRuntime();
    const result = await runtime.executeInventoryLookup({
      message: 'Where is the Atlas construct sample?',
      parserPayload: {
        entities: {
          inventory_item: 'Atlas construct sample',
          requested_output: 'location',
          compound_name: null
        },
        inventory_search: {
          normalized_query: 'Atlas construct sample',
          candidate_terms: ['Atlas construct sample', 'atlas'],
          aliases: ['construct'],
          search_mode: 'exact_then_alias_then_fuzzy'
        }
      },
      snapshot,
      limit: 5
    });
    return {
      ...result,
      ok: asArray(result.items).length > 0
    };
  }

  async function smokeRecordLookup(snapshot) {
    const runtime = createAgentRecordLookupRuntime();
    const result = await runtime.executeRecordLookup({
      message: 'Find the Cell Prep protocol.',
      parserPayload: {
        entities: {
          protocol_name: 'Cell Prep',
          requested_output: 'protocol'
        }
      },
      snapshot,
      limit: 5
    });
    return {
      ...result,
      ok: asArray(result.items).length > 0
    };
  }

  async function smokeProtocolMatching(snapshot) {
    const runtime = createProtocolMatchingRuntime({
      requestStructuredJsonPayload: structuredResponder
    });
    const result = await runtime.selectProtocol({
      protocols: asArray(snapshot.protocols),
      protocolCandidates: ['Cell Prep'],
      message: 'I ran the Cell Prep workflow.',
      conversation: [],
      parserPayload: {
        entities: {
          activity_type: 'cell prep',
          protocol_name: 'Cell Prep'
        }
      }
    });
    return {
      ok: Boolean(result.selected_protocol?.id),
      status: cleanText(result.selection_method, 80) || 'ok',
      summary: result.selected_protocol
        ? `Selected ${cleanText(result.selected_protocol.name, 220)} during protocol matching smoke test.`
        : 'Protocol matching smoke test did not select a protocol.',
      selected_protocol: result.selected_protocol,
      rationale: cleanText(result.rationale, 260)
    };
  }

  async function smokeNotebookGeneration(snapshot) {
    const runtime = createNotebookGenerationRuntime({
      requestStructuredJsonPayload: structuredResponder
    });
    const protocol = cloneJson(asArray(snapshot.protocols)[0], {});
    const project = cloneJson(asArray(snapshot.projects)[0], {});
    const result = await runtime.generateNotebook({
      message: 'I completed Cell Prep on HEK293 sample TUBE42.',
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
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        }
      },
      selectedProtocol: protocol,
      project
    });
    return {
      ok: cleanText(result.status, 80) === 'completed',
      status: cleanText(result.status, 80),
      summary: cleanText(result.notebook?.entry_template?.result, 320) || 'Notebook generation smoke test completed.',
      rendered_step_preview: cleanText(asArray(result.notebook?.rendered_steps)[0], 220)
    };
  }

  async function smokePythonSandbox() {
    return pythonSandboxFn({
      code: 'import json\nopen("out.json", "w", encoding="utf-8").write(json.dumps({"ok": True, "value": 42}))',
      readback_paths: ['out.json'],
      timeout_ms: 4000
    }, {
      sandboxRoot: pythonSandboxRoot
    });
  }

  async function smokeSubAgent() {
    const runtime = createAgentSubAgentRuntime({
      now,
      runSubAgentTurn: async ({ phase, message }) => ({
        assistant_message: `Handled ${phase}: ${cleanText(message, 120)}`,
        summary: `sub-agent ${phase} ok`
      })
    });
    const created = await runtime.execute({
      action: 'create',
      name: 'Smoke Helper',
      system_prompt: 'You are a smoke-test helper agent.',
      message: 'Ping'
    });
    if (!created?.ok || !created.agent?.id) {
      return {
        ok: false,
        status: 'error',
        error: cleanText(created?.error, 600) || 'Sub-agent create failed.',
        summary: 'Sub-agent smoke test failed during creation.'
      };
    }
    const agentId = cleanText(created.agent.id, 160);
    const updated = await runtime.execute({
      action: 'message',
      agent_id: agentId,
      message: 'Follow-up ping'
    });
    const listed = await runtime.execute({
      action: 'list'
    });
    const removed = await runtime.execute({
      action: 'delete',
      agent_id: agentId
    });
    const ok = created.ok === true && updated?.ok === true && listed?.ok === true && removed?.ok === true;
    return {
      ok,
      status: ok ? 'completed' : 'error',
      summary: ok
        ? `Sub-agent lifecycle smoke test completed for ${agentId}.`
        : 'Sub-agent lifecycle smoke test failed.',
      agent_id: agentId,
      listed_count: asArray(listed?.items).length,
      error: ok ? '' : uniqueStrings([
        created?.error,
        updated?.error,
        listed?.error,
        removed?.error
      ], 4).join(' | ')
    };
  }

  async function smokeMemory() {
    const runtime = createAgentMemoryRuntime({
      now: (() => {
        let index = 0;
        const values = [
          '2026-03-22T12:00:00.000Z',
          '2026-03-22T12:00:01.000Z'
        ];
        return () => values[Math.min(index++, values.length - 1)];
      })(),
      createId: () => 'memory-smoke-1'
    });
    await runtime.execute({
      action: 'remember',
      category: 'preference',
      key: 'output_format',
      summary: 'User prefers concise summaries.',
      value: 'concise'
    });
    return runtime.execute({
      action: 'recall',
      query: 'concise',
      limit: 5
    });
  }

  async function smokeLiteratureSearch() {
    const runtime = createLiteratureSearchRuntime({
      searchPubMedRecords: async () => ([
        {
          pmid: '12345',
          doi: '10.1000/smoke-pubmed',
          title: 'PD-1 Smoke Test Paper',
          summary: 'PubMed smoke-test entry.',
          journal: 'Nature',
          published_at: '2024-01-10',
          authors: ['Pat Doe'],
          url: 'https://pubmed.ncbi.nlm.nih.gov/12345/'
        }
      ]),
      searchCrossrefRecords: async () => ([
        {
          doi: '10.1000/smoke-crossref',
          title: 'Crossref Smoke Record',
          summary: 'Crossref smoke-test entry.',
          journal: 'Science',
          published_at: '2023-11-02',
          authors: ['Chris Doe'],
          url: 'https://doi.org/10.1000/smoke-crossref'
        }
      ]),
      searchEuropePmcRecords: async () => ([
        {
          pmcid: 'PMC123',
          pmid: '321',
          doi: '10.1000/smoke-eupmc',
          title: 'Europe PMC Smoke Record',
          summary: 'Europe PMC smoke-test entry.',
          journal: 'Cell',
          published_at: '2022-05-01',
          authors: ['Sam Doe'],
          url: 'https://europepmc.org/article/PMC/PMC123'
        }
      ]),
      searchUniProtRecords: async () => ([
        {
          accession: 'Q99999',
          protein_name: 'Programmed cell death protein 1',
          gene_name: 'PDCD1',
          organism: 'Homo sapiens',
          summary: 'UniProt smoke-test entry.',
          url: 'https://www.uniprot.org/uniprotkb/Q99999'
        }
      ])
    });
    return runtime.searchLiterature({
      query: 'PD-1 binder methods',
      sources: ['pubmed', 'crossref', 'europe_pmc', 'uniprot'],
      limit: 6
    });
  }

  async function smokePaperDownload() {
    const storageRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'enana-agent-tool-smoke-download-'));
    try {
      const runtime = createPaperDownloadRuntime({
        createId: () => 'paper-download-smoke-1',
        fetch: async () => ({
          ok: true,
          status: 200,
          headers: {
            get(name) {
              const normalized = String(name || '').toLowerCase();
              if (normalized === 'content-type') {
                return 'application/pdf';
              }
              if (normalized === 'content-length') {
                return '14';
              }
              return '';
            }
          },
          body: {
            async *[Symbol.asyncIterator]() {
              yield Buffer.from('%PDF-1.7 smoke');
            }
          }
        })
      });
      const result = await runtime.downloadPaper({
        action: 'download',
        page_url: 'https://example.org/article',
        page_html: '<a href="/downloads/paper.pdf">Download PDF</a>',
        linked_type: 'project',
        linked_name: 'Atlas',
        storage_path: storageRoot,
        paper_title: 'Smoke Test Paper'
      });
      return result;
    } finally {
      await fsPromises.rm(storageRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function smokePaperAnalysis() {
    const runtime = createPaperAnalysisRuntime({
      requestStructuredJsonPayload: structuredResponder
    });
    return runtime.analyzePaper({
      paper: {
        title: 'PD-1 Binder Methods',
        summary: 'A short paper summary for smoke testing.',
        methods: [
          'Clarify lysate.',
          'Bind clarified lysate to Ni-NTA resin for [time].',
          'Elute with imidazole.'
        ]
      },
      message: 'Extract a protocol from this paper.',
      extract_protocol: true,
      generate_protocol: true
    });
  }

  async function smokeProtocolGeneration() {
    const runtime = createProtocolGenerationRuntime({
      requestStructuredJsonPayload: structuredResponder
    });
    return runtime.generateProtocol({
      title: 'Atlas Binder Purification',
      purpose: 'Purify the Atlas binder from clarified lysate.',
      method_text: 'Clarify lysate, bind it to Ni-NTA resin for [time], then elute with imidazole.',
      materials: ['Ni-NTA resin', 'imidazole buffer'],
      steps: ['Clarify lysate.', 'Bind to Ni-NTA resin.', 'Elute with imidazole.'],
      source_summary: 'Smoke-test summary.'
    });
  }

  const smokeRunners = {
    'inventory-lookup': async () => smokeInventoryLookup(buildSmokeSnapshot()),
    'record-lookup': async () => smokeRecordLookup(buildSmokeSnapshot()),
    'protocol-matching': async () => smokeProtocolMatching(buildSmokeSnapshot()),
    'notebook-generation': async () => smokeNotebookGeneration(buildSmokeSnapshot()),
    'python-sandbox': async () => smokePythonSandbox(),
    'sub-agent': async () => smokeSubAgent(),
    memory: async () => smokeMemory(),
    'literature-search': async () => smokeLiteratureSearch(),
    'paper-download': async () => smokePaperDownload(),
    'paper-analysis': async () => smokePaperAnalysis(),
    'protocol-generation': async () => smokeProtocolGeneration()
  };

  const missingSmokeTests = AGENT_TOOL_CATALOG
    .map((entry) => cleanText(entry?.name, 120))
    .filter(Boolean)
    .filter((toolName) => typeof smokeRunners[toolName] !== 'function');
  if (missingSmokeTests.length) {
    throw new Error(`Missing smoke tests for agent tools: ${missingSmokeTests.join(', ')}.`);
  }

  async function runAllTools() {
    const items = [];
    for (const entry of AGENT_TOOL_CATALOG) {
      const toolName = cleanText(entry?.name, 120);
      const startedAt = Date.now();
      try {
        const result = await smokeRunners[toolName]();
        items.push(normalizeToolSmokeItem(toolName, result, Date.now() - startedAt));
      } catch (error) {
        items.push(normalizeToolSmokeItem(toolName, {
          ok: false,
          status: 'error',
          error: cleanText(error?.message || error, 600) || `${toolName} smoke test failed.`,
          summary: `${toolName} smoke test failed.`
        }, Date.now() - startedAt));
      }
    }

    const failedItems = items.filter((item) => item.ok !== true);
    const passedCount = items.length - failedItems.length;
    const failedNames = failedItems.map((item) => item.tool_name);
    return {
      ok: failedItems.length === 0,
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
    toolNames: AGENT_TOOL_CATALOG.map((entry) => cleanText(entry?.name, 120)).filter(Boolean),
    runAllTools
  };
}

module.exports = {
  createAgentToolSmokeTestRuntime
};
