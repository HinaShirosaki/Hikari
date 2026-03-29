'use strict';

const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { AGENT_TOOL_CATALOG } = require('./agent-tool-call.js');
const { createAgentInventoryLookupRuntime } = require('./agent-inventory-lookup.js');
const { createAgentRecordLookupRuntime } = require('./agent-record-lookup.js');
const { createProtocolMatchingRuntime } = require('./agent-protocol-matching.js');
const { createNotebookGenerationRuntime } = require('./agent-notebook-generation.js');
const { createNotebookDraftRuntime } = require('./agent-notebook-draft.js');
const { runPythonSandbox } = require('./agent-python-sandbox.js');
const { createAgentSubAgentRuntime } = require('./agent-sub-agent.js');
const { createAgentMemoryRuntime } = require('../context/agent-memory.js');
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

function countWords(value) {
  return cleanText(value, 400)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

function resolveToolMessage(message, fallback) {
  return cleanText(message, 3000) || cleanText(fallback, 3000);
}

function resolveFocusedToolText(message, fallback, maxWords = 6) {
  const normalizedMessage = cleanText(message, 300);
  if (!normalizedMessage) {
    return cleanText(fallback, 300);
  }
  if (countWords(normalizedMessage) <= maxWords) {
    return normalizedMessage;
  }
  return cleanText(fallback, 300);
}

function buildSmokeSnapshot() {
  const timestamp = '2026-03-22T12:00:00.000Z';
  return {
    projects: [
      {
        id: 'proj-1',
        name: 'Atlas',
        summary: 'Binder optimization project.'
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
      },
      {
        id: 'prot-2',
        name: 'Viability Assay',
        purpose: 'Measure post-prep viability for Atlas samples.',
        aliases: ['atlas viability'],
        projectId: 'proj-1',
        projectName: 'Atlas',
        steps: [
          {
            id: 'step-1',
            text: 'Label assay plate for {{ph:sample_name}}.',
            placeholders: [
              { id: 'sample_name', name: 'sample name' }
            ]
          },
          {
            id: 'step-2',
            text: 'Measure viability and record observations.',
            placeholders: []
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
        notebookState: 'executed',
        executedAt: timestamp,
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
          { id: 'block-1', protocolId: 'prot-1' },
          { id: 'block-2', type: 'text', text: 'Move prepared cells into the viability assay.' },
          { id: 'block-3', protocolId: 'prot-2' }
        ],
        links: [
          { id: 'link-1', fromBlockId: 'block-1', toBlockId: 'block-2' },
          { id: 'link-2', fromBlockId: 'block-2', toBlockId: 'block-3' }
        ],
        notebookEntryIds: ['note-1'],
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
        title: 'Binder Methods',
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
        notes: 'Binder construct',
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
    if (stage === 'notebook_draft_selection') {
      return {
        ok: true,
        payload: {
          selected_candidate_id: 'wf-1::block-3::prot-2::Viability Assay',
          title: 'Viability Assay After Cell Prep',
          purpose: 'Measure whether the prepared Atlas cells remain viable for the next workflow step.',
          rationale: 'The workflow places the viability assay immediately after completed cell prep.',
          planned_materials: ['Cell Prep output', 'Viability assay plate'],
          checkpoints: ['Confirm cells are ready from Cell Prep.', 'Record viability readout and observations.']
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
  if (toolName === 'notebook-draft') {
    return cleanText(source.proposal?.title || source.selected_protocol?.name || source.summary, 220);
  }
  if (toolName === 'python-sandbox') {
    return cleanText(source.readback_files?.[0]?.path, 220);
  }
  if (toolName === 'sub-agent') {
    return cleanText(source.agent_id, 220);
  }
  if (toolName === 'memory') {
    return cleanText(source.items?.[0]?.summary || source.items?.[0]?.key, 220);
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

function buildResultMessage(toolName, result, fallbackSummary = '') {
  const source = ensureObject(result);
  const candidates = [];
  if (toolName === 'memory') {
    candidates.push(source.items?.[0]?.summary);
  }
  if (toolName === 'literature-search') {
    candidates.push(source.items?.[0]?.summary);
  }
  candidates.push(
    source.summary,
    source.result_summary,
    source.message,
    source.answer,
    source.rationale,
    source.error,
    fallbackSummary
  );
  return cleanText(candidates.find((value) => cleanText(value, 6000)), 6000);
}

function normalizeToolSmokeItem(toolName, result, durationMs, options = {}) {
  const source = ensureObject(result);
  const summary = cleanText(source.summary || source.error || `${toolName} smoke test completed.`, 320);
  const requestMessage = cleanText(options.requestMessage, 3000);
  return {
    tool_name: cleanText(toolName, 120),
    ok: source.ok !== false,
    status: cleanText(source.status, 80) || (source.ok === false ? 'error' : 'ok'),
    summary,
    request_message: requestMessage,
    result_message: buildResultMessage(toolName, source, summary),
    preview: buildPreview(toolName, source),
    error: source.ok === false ? cleanText(source.error, 600) : '',
    duration_ms: Math.max(0, Number(durationMs) || 0),
    raw_result: cloneJson(source, {})
  };
}

function createAgentToolSmokeTestRuntime(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const pythonSandboxFn = typeof deps.runPythonSandbox === 'function' ? deps.runPythonSandbox : runPythonSandbox;
  const pythonSandboxRoot = cleanText(deps.pythonSandboxRoot, 1200)
    || path.join(os.tmpdir(), 'enana-agent-tool-smoke-python');
  const structuredResponder = createStructuredJsonResponder();

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
          normalized_query: focusedQuery,
          candidate_terms: uniqueStrings([focusedQuery, requestMessage, 'Atlas construct sample', 'atlas'], 5),
          aliases: ['construct'],
          search_mode: 'exact_then_alias_then_fuzzy'
        }
      },
      snapshot,
      limit: 5
    });
    const itemCount = asArray(result.items).length;
    return {
      ...result,
      ok: options.strict === true ? itemCount > 0 : cleanText(result.status, 80) !== 'error',
      summary: itemCount > 0
        ? `Found ${itemCount} inventory match${itemCount === 1 ? '' : 'es'} for ${cleanText(result.query || focusedQuery, 220)}.`
        : `No inventory matches found for ${cleanText(result.query || focusedQuery, 220)}.`
    };
  }

  async function smokeRecordLookup(snapshot, options = {}) {
    const runtime = createAgentRecordLookupRuntime();
    const requestMessage = resolveToolMessage(options.message, 'Find the Cell Prep protocol.');
    const focusedQuery = resolveFocusedToolText(options.message, 'Cell Prep');
    const result = await runtime.executeRecordLookup({
      message: requestMessage,
      parserPayload: {
        entities: {
          protocol_name: focusedQuery,
          requested_output: null
        }
      },
      snapshot,
      limit: 5
    });
    const itemCount = asArray(result.items).length;
    return {
      ...result,
      ok: options.strict === true ? itemCount > 0 : cleanText(result.status, 80) !== 'error',
      summary: itemCount > 0
        ? `Found ${itemCount} record match${itemCount === 1 ? '' : 'es'} for ${cleanText(result.query || focusedQuery, 220)}.`
        : `No record matches found for ${cleanText(result.query || focusedQuery, 220)}.`
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
    const selectedProtocolName = cleanText(result.selected_protocol?.name, 220);
    return {
      ok: options.strict === true ? Boolean(result.selected_protocol?.id) : true,
      status: cleanText(result.selection_method, 80) || (selectedProtocolName ? 'matched' : 'no_match'),
      summary: selectedProtocolName
        ? `Selected ${selectedProtocolName} during protocol matching.`
        : 'Protocol matching completed without selecting a protocol.',
      selected_protocol: result.selected_protocol,
      rationale: cleanText(result.rationale, 260)
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
      ok: options.strict === true
        ? cleanText(result.status, 80) === 'completed'
        : cleanText(result.status, 80) !== 'error',
      status: cleanText(result.status, 80),
      summary: cleanText(result.notebook?.entry_template?.result, 320) || 'Notebook generation smoke test completed.',
      rendered_step_preview: cleanText(asArray(result.notebook?.rendered_steps)[0], 220)
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
        ? cleanText(result.status, 80) === 'proposal_ready'
        : cleanText(result.status, 80) !== 'error',
      summary: cleanText(result.summary, 320) || 'Notebook draft smoke test completed.'
    };
  }

  async function smokePythonSandbox(options = {}) {
    const requestMessage = resolveToolMessage(options.message, 'Write a JSON file with an ok flag and a test value.');
    const escapedMessage = JSON.stringify(requestMessage);
    const result = await pythonSandboxFn({
      code: `import json\nopen("out.json", "w", encoding="utf-8").write(json.dumps({"ok": True, "value": 42, "request_message": ${escapedMessage}}))`,
      readback_paths: ['out.json'],
      timeout_ms: 4000
    }, {
      sandboxRoot: pythonSandboxRoot
    });
    return {
      ...result,
      ok: result?.ok !== false,
      summary: result?.ok === false
        ? cleanText(result?.error, 320) || 'Python sandbox smoke test failed.'
        : 'Python sandbox completed and wrote out.json.'
    };
  }

  async function smokeSubAgent(options = {}) {
    const requestMessage = resolveToolMessage(options.message, 'Ping');
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
      message: requestMessage
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
      message: `Follow-up: ${requestMessage}`
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

  async function smokeMemory(options = {}) {
    const requestMessage = resolveToolMessage(options.message, 'User prefers concise summaries.');
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
    const rememberResult = await runtime.execute({
      action: 'remember',
      category: 'preference',
      key: 'output_format',
      summary: requestMessage,
      value: requestMessage
    });
    const recallResult = await runtime.execute({
      action: 'recall',
      query: requestMessage,
      limit: 5
    });
    const itemCount = asArray(recallResult?.items).length;
    return {
      ...recallResult,
      ok: options.strict === true
        ? itemCount > 0
        : rememberResult?.ok !== false && recallResult?.ok !== false,
      summary: itemCount > 0
        ? `Recalled ${itemCount} memory record${itemCount === 1 ? '' : 's'}.`
        : 'No memory records matched the recall query.'
    };
  }

  async function smokeLiteratureSearch(options = {}) {
    const runtime = createLiteratureSearchRuntime({
      searchPubMedRecords: async () => ([
        {
          pmid: '12345',
          doi: '10.1000/smoke-pubmed',
          title: 'Smoke Test Paper',
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
          accession: 'Q9TEST',
          protein_name: 'Example receptor protein',
          gene_name: 'EXR1',
          organism: 'Homo sapiens',
          summary: 'UniProt smoke-test entry.',
          url: 'https://www.uniprot.org/uniprotkb/Q9TEST'
        }
      ])
    });
    const requestMessage = resolveToolMessage(options.message, 'binder methods');
    const result = await runtime.searchLiterature({
      query: requestMessage,
      sources: ['pubmed', 'crossref', 'europe_pmc', 'uniprot'],
      limit: 6
    });
    const itemCount = asArray(result?.items).length;
    return {
      ...result,
      ok: options.strict === true ? itemCount > 0 : result?.ok !== false,
      summary: itemCount > 0
        ? `Literature search returned ${itemCount} result${itemCount === 1 ? '' : 's'}.`
        : 'Literature search returned no results.'
    };
  }

  async function smokePaperDownload(options = {}) {
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
      const requestMessage = resolveToolMessage(options.message, 'Smoke Test Paper');
      const result = await runtime.downloadPaper({
        action: 'download',
        page_url: 'https://example.org/article',
        page_html: '<a href="/downloads/paper.pdf">Download PDF</a>',
        linked_type: 'project',
        linked_name: 'Atlas',
        storage_path: storageRoot,
        paper_title: requestMessage
      });
      return {
        ...result,
        ok: result?.ok !== false,
        summary: result?.ok === false
          ? cleanText(result?.error, 320) || 'Paper download smoke test failed.'
          : `Downloaded PDF to ${cleanText(result?.relative_path || result?.file_name, 220) || 'storage'}.`
      };
    } finally {
      await fsPromises.rm(storageRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function smokePaperAnalysis(options = {}) {
    const runtime = createPaperAnalysisRuntime({
      requestStructuredJsonPayload: structuredResponder
    });
    const requestMessage = resolveToolMessage(options.message, 'Extract a protocol from this paper.');
    const result = await runtime.analyzePaper({
      paper: {
        title: 'Binder Methods',
        summary: 'A short paper summary for smoke testing.',
        methods: [
          'Clarify lysate.',
          'Bind clarified lysate to Ni-NTA resin for [time].',
          'Elute with imidazole.'
        ]
      },
      message: requestMessage,
      extract_protocol: true,
      generate_protocol: true
    });
    return {
      ...result,
      ok: result?.ok !== false,
      summary: cleanText(result?.result_summary || result?.brief_summary, 320) || 'Paper analysis smoke test completed.'
    };
  }

  async function smokeProtocolGeneration(options = {}) {
    const runtime = createProtocolGenerationRuntime({
      requestStructuredJsonPayload: structuredResponder
    });
    const requestMessage = resolveToolMessage(options.message, 'Generate a concise purification protocol from this summary.');
    const result = await runtime.generateProtocol({
      title: 'Atlas Binder Purification',
      purpose: 'Purify the Atlas binder from clarified lysate.',
      method_text: 'Clarify lysate, bind it to Ni-NTA resin for [time], then elute with imidazole.',
      materials: ['Ni-NTA resin', 'imidazole buffer'],
      steps: ['Clarify lysate.', 'Bind to Ni-NTA resin.', 'Elute with imidazole.'],
      source_summary: requestMessage
    });
    return {
      ...result,
      ok: result?.ok !== false,
      summary: cleanText(result?.result_summary, 320) || 'Protocol generation smoke test completed.'
    };
  }

  const smokeRunners = {
    'inventory-lookup': async (options = {}) => smokeInventoryLookup(buildSmokeSnapshot(), options),
    'record-lookup': async (options = {}) => smokeRecordLookup(buildSmokeSnapshot(), options),
    'protocol-matching': async (options = {}) => smokeProtocolMatching(buildSmokeSnapshot(), options),
    'notebook-generation': async (options = {}) => smokeNotebookGeneration(buildSmokeSnapshot(), options),
    'notebook-draft': async (options = {}) => smokeNotebookDraft(buildSmokeSnapshot(), options),
    'python-sandbox': async (options = {}) => smokePythonSandbox(options),
    'sub-agent': async (options = {}) => smokeSubAgent(options),
    memory: async (options = {}) => smokeMemory(options),
    'literature-search': async (options = {}) => smokeLiteratureSearch(options),
    'paper-download': async (options = {}) => smokePaperDownload(options),
    'paper-analysis': async (options = {}) => smokePaperAnalysis(options),
    'protocol-generation': async (options = {}) => smokeProtocolGeneration(options)
  };

  const missingSmokeTests = AGENT_TOOL_CATALOG
    .map((entry) => cleanText(entry?.name, 120))
    .filter(Boolean)
    .filter((toolName) => typeof smokeRunners[toolName] !== 'function');
  if (missingSmokeTests.length) {
    throw new Error(`Missing smoke tests for agent tools: ${missingSmokeTests.join(', ')}.`);
  }

  async function runToolEntry(toolName, options = {}) {
    const normalizedToolName = cleanText(toolName, 120);
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
        error: cleanText(error?.message || error, 600) || `${normalizedToolName} smoke test failed.`,
        summary: `${normalizedToolName} smoke test failed.`
      }, Date.now() - startedAt, {
        requestMessage: options.message
      });
    }
  }

  async function runTool(options = {}) {
    const toolName = cleanText(options?.toolName, 120);
    const requestMessage = cleanText(options?.message, 3000);
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
      const toolName = cleanText(entry?.name, 120);
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
    toolNames: AGENT_TOOL_CATALOG.map((entry) => cleanText(entry?.name, 120)).filter(Boolean),
    runTool,
    runAllTools
  };
}

module.exports = {
  createAgentToolSmokeTestRuntime
};
