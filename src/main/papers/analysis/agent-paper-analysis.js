'use strict';

const fsPromises = require('node:fs/promises');
const { readPaperMetadata } = require('../store/knowledge-index-schema.js');

const { createAgentLlmRuntimeHelpers } = require('../../lib/llm/runtime-helpers.js');
const {
  buildKnowledgeDatabasePaths,
  buildLegacyKnowledgeDatabasePaths,
  resolveRelativeStoragePath
} = require('../store/paper-knowledge-paths.js');
const {
  openKnowledgeDatabase,
  queryRows
} = require('../store/paper-knowledge-store.js');
const {
  runCodexPaperContextSubAgent
} = require('../workflow/codex-paper-context-workflow.js');

function createPaperAnalysisRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);

  // Load a previously-ingested paper's LLM-facing markdown from the local KnowledgeBase
  // by id, doi, or title, so the agent can reference a paper instead of pasting its text.
  async function defaultLoadPaperFromKnowledge({ storagePath = '', paperId = '', doi = '', title = '' } = {}) {
    const resolved = cleanText(storagePath, 4000);
    const id = cleanText(paperId, 200);
    const normDoi = cleanText(doi, 200);
    const normTitle = cleanText(title, 400);
    const clauses = [];
    const params = [];
    if (id) { clauses.push('id = ?'); params.push(id); }
    if (normDoi) { clauses.push('lower(doi) = lower(?)'); params.push(normDoi); }
    if (normTitle) { clauses.push('lower(title) = lower(?)'); params.push(normTitle); }
    if (!resolved || !clauses.length) {
      return null;
    }

    let sqlitePath = '';
    try {
      const primary = buildKnowledgeDatabasePaths({ storagePath: resolved });
      await fsPromises.access(primary.sqlite_path);
      sqlitePath = primary.sqlite_path;
    } catch {
      try {
        const legacy = buildLegacyKnowledgeDatabasePaths({ storagePath: resolved });
        await fsPromises.access(legacy.sqlite_path);
        sqlitePath = legacy.sqlite_path;
      } catch {
        return null;
      }
    }

    let db = null;
    try {
      db = await openKnowledgeDatabase(sqlitePath);
      const rows = queryRows(
        db,
        `SELECT * FROM papers WHERE ${clauses.join(' OR ')} LIMIT 1`,
        params
      );
      const row = rows && rows[0];
      const wikiPath = cleanText(row?.wiki_path, 4000);
      if (!wikiPath) {
        return null;
      }
      const markdownPath = resolveRelativeStoragePath(resolved, wikiPath);
      const markdown = await fsPromises.readFile(markdownPath, 'utf8').catch(() => '');
      if (!cleanText(markdown, 10)) {
        return null;
      }
      const metadata = await readPaperMetadata(resolved, row).catch(() => ({}));
      return {
        id: cleanText(row.id, 200),
        title: cleanText(row.title, 220),
        abstract: cleanText(metadata.abstract || row.abstract, 3000),
        doi: cleanText(row.doi, 200),
        markdown_path: markdownPath,
        markdown_relative_path: wikiPath,
        content: markdown
      };
    } catch {
      return null;
    } finally {
      try {
        if (db && typeof db.close === 'function') {
          db.close();
        }
      } catch { /* ignore close failures */ }
    }
  }

  const loadPaperFromKnowledge = typeof deps.loadPaperFromKnowledge === 'function'
    ? deps.loadPaperFromKnowledge
    : defaultLoadPaperFromKnowledge;

  const PAPER_ANALYSIS_RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['brief_summary', 'key_findings', 'method_overview', 'protocol_candidate', 'result_summary'],
    properties: {
      brief_summary: { type: 'string' },
      key_findings: {
        type: 'array',
        items: { type: 'string' }
      },
      method_overview: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      protocol_candidate: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'purpose', 'method_text', 'materials', 'steps', 'notes'],
            properties: {
              title: { type: 'string' },
              purpose: { type: 'string' },
              method_text: { type: 'string' },
              materials: {
                type: 'array',
                items: { type: 'string' }
              },
              steps: {
                type: 'array',
                items: {
                  anyOf: [
                    { type: 'string' },
                    {
                      type: 'object',
                      additionalProperties: true,
                      properties: {
                        id: { type: 'string' },
                        text: { type: 'string' }
                      }
                    }
                  ]
                }
              },
              notes: { anyOf: [{ type: 'string' }, { type: 'null' }] }
            }
          }
        ]
      },
      result_summary: { anyOf: [{ type: 'string' }, { type: 'null' }] }
    }
  };

  const PAPER_ANALYSIS_SYSTEM_PROMPT = [
    'You analyze a scientific paper for a lab assistant.',
    'Produce a short, faithful summary based only on the supplied paper context.',
    'If the user asks for protocol extraction, extract one concise procedure candidate when supported by the evidence.',
    'Return JSON only.'
  ].join(' ');

  const PAPER_ANALYSIS_RULES = [
    'Write a brief_summary of 2 to 4 sentences.',
    'List a few key_findings that are directly supported by the provided paper context.',
    'Keep method_overview concise and focused on operational methods.',
    'Only populate protocol_candidate when the request explicitly asks for protocol extraction or conversion.',
    'Do not invent missing methods, concentrations, temperatures, or timings.'
  ];

  function normalizeProtocolCandidate(raw) {
    const source = raw && typeof raw === 'object' ? raw : null;
    if (!source) {
      return null;
    }
    const steps = asArray(source.steps)
      .map((step) => {
        if (typeof step === 'string') {
          return cleanText(step, 2000);
        }
        return {
          text: cleanText(step?.text || step?.instruction || step?.action, 2000)
        };
      })
      .filter((step) => (typeof step === 'string' ? step : step?.text))
      .slice(0, 30);
    const methodText = cleanText(source.method_text || source.methodText, 12000);
    if (!methodText && !steps.length) {
      return null;
    }
    return {
      title: cleanText(source.title, 220) || 'Extracted paper protocol',
      purpose: cleanText(source.purpose, 600),
      method_text: methodText,
      materials: asArray(source.materials).map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 40),
      steps,
      notes: cleanText(source.notes, 1200)
    };
  }

  function normalizePaperPayload(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    return {
      brief_summary: cleanText(source.brief_summary, 3000),
      key_findings: asArray(source.key_findings).map((item) => cleanText(item, 600)).filter(Boolean).slice(0, 8),
      method_overview: cleanText(source.method_overview, 2400),
      protocol_candidate: normalizeProtocolCandidate(source.protocol_candidate),
      result_summary: cleanText(source.result_summary, 320)
    };
  }

  function buildPaperContext(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const paper = source.paper && typeof source.paper === 'object' ? source.paper : {};
    const methodsText = asArray(paper.methods)
      .map((item) => {
        if (typeof item === 'string') {
          return cleanText(item, 1600);
        }
        return cleanText(item?.name || item?.summary || item?.details || item?.text, 1600);
      })
      .filter(Boolean)
      .join('\n- ');
    return {
      title: cleanText(source.paper_title || paper.title || paper.paper_title, 220),
      summary: cleanText(source.paper_summary || paper.summary, 3000),
      abstract: cleanText(source.paper_abstract || paper.abstract, 3000),
      content: cleanText(source.paper_text || source.paper_content || paper.content || paper.full_text, 12000),
      methods: methodsText,
      key_findings: asArray(paper.key_findings || paper.keyResults).map((item) => cleanText(item, 600)).filter(Boolean).join('\n- '),
      message: cleanText(source.message, 2400),
      extract_protocol: source.extract_protocol === true,
      generate_protocol: source.generate_protocol === true,
      protocol_title_hint: cleanText(source.protocol_title_hint, 220)
    };
  }

  function buildPrompt(context = {}) {
    return [
      'Analyze the paper context below and return a brief lab-useful summary.',
      PAPER_ANALYSIS_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n'),
      `Paper title: ${context.title || '-'}`,
      `User request: ${context.message || 'Summarize the paper briefly.'}`,
      `Extract protocol: ${context.extract_protocol === true ? 'yes' : 'no'}`,
      `Abstract/summary:\n${context.summary || context.abstract || '-'}`,
      `Key findings:\n- ${context.key_findings || '-'}`,
      `Methods:\n- ${context.methods || '-'}`,
      `Additional paper text:\n${context.content || '-'}`,
      'Return JSON with brief_summary, key_findings, method_overview, protocol_candidate, and result_summary.'
    ].join('\n\n');
  }

  const protocolGenerationRuntime = deps.protocolGenerationRuntime || {
    generateProtocol: async () => ({
      ok: false,
      status: 'error',
      error: 'Protocol generation is not configured for this paper-analysis runtime.'
    })
  };
  const defaultSubAgentRuntime = deps.subAgentRuntime && typeof deps.subAgentRuntime === 'object'
    ? deps.subAgentRuntime
    : null;
  const runPaperContextSubAgent = typeof deps.runCodexPaperContextSubAgent === 'function'
    ? deps.runCodexPaperContextSubAgent
    : runCodexPaperContextSubAgent;

  async function analyzeLocalPaperWithSubAgent(source = {}, context = {}, loadedPaper = {}) {
    const paper = source.paper && typeof source.paper === 'object' ? source.paper : {};
    const subAgentRuntime = source.subAgentRuntime && typeof source.subAgentRuntime === 'object'
      ? source.subAgentRuntime
      : defaultSubAgentRuntime;
    if (!subAgentRuntime || typeof subAgentRuntime.createSubAgent !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Codex paper context sub-agent runtime is not configured.'
      };
    }

    const paperId = cleanText(loadedPaper.id || paper.id || loadedPaper.doi || paper.doi || context.title, 200);
    const paperTitle = cleanText(context.title || loadedPaper.title || paper.title, 320);
    const doi = cleanText(loadedPaper.doi || paper.doi || source.doi, 200);
    const query = cleanText(source.query || source.message, 2400)
      || `Summarize the important findings and methods in ${paperTitle || 'this paper'}.`;
    const selectedPapers = [{
      paper_id: paperId,
      paper_title: paperTitle,
      doi,
      summary: cleanText(loadedPaper.abstract || context.abstract || context.summary, 1600),
      source: 'knowledge_markdown'
    }];
    const downloadedPapers = [{
      paper_id: paperId,
      paper_title: paperTitle,
      doi,
      ok: true,
      status: 'reused',
      knowledge_markdown_path: cleanText(loadedPaper.markdown_path, 4000),
      knowledge_markdown_relative_path: cleanText(loadedPaper.markdown_relative_path, 2000)
    }];
    const paperContextResult = await runPaperContextSubAgent({
      subAgentRuntime,
      query,
      message: query,
      selectedPapers,
      downloadedPapers,
      snapshot: source.snapshot || null,
      source,
      parentRequestId: cleanText(source.traceContext?.requestId || source.request_id, 160),
      cwd: cleanText(source.cwd, 2400),
      model: cleanText(source.model, 120),
      reasoningEffort: cleanText(source.reasoning_effort || source.reasoningEffort, 40),
      name: cleanText(source.sub_agent_name || source.subAgentName, 160)
        || `codex-paper-analysis-${Date.now()}`
    }, { asArray, cleanText });

    if (!paperContextResult?.ok) {
      return {
        ok: false,
        status: cleanText(paperContextResult?.status, 40) || 'error',
        error: cleanText(paperContextResult?.error, 1200) || 'Codex paper context sub-agent failed.',
        sub_agent_id: cleanText(paperContextResult?.sub_agent_id, 160),
        sub_agent: paperContextResult?.sub_agent || null
      };
    }

    return {
      ok: true,
      status: 'completed',
      query,
      paper_title: paperTitle,
      selected_papers: asArray(paperContextResult.selected_papers),
      loaded_context_blocks: asArray(paperContextResult.loaded_context_blocks),
      papers_read_count: Number(paperContextResult.papers_read_count) || 0,
      notes: asArray(paperContextResult.notes),
      sub_agent_id: cleanText(paperContextResult.sub_agent_id, 160),
      sub_agent: paperContextResult.sub_agent || null,
      summary: cleanText(paperContextResult.summary, 800)
        || `Loaded exact line-backed context for ${paperTitle || 'paper'}.`
    };
  }

  async function analyzePaper(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const context = buildPaperContext(source);
    let loadedPaper = null;
    // Reference-by-id: when no paper text was passed, load the ingested paper.md from
    // the local KnowledgeBase using the supplied id / doi / title.
    if (!cleanText(context.content, 10)) {
      const paper = source.paper && typeof source.paper === 'object' ? source.paper : {};
      loadedPaper = await loadPaperFromKnowledge({
        storagePath: source.storage_path || source.storagePath,
        paperId: paper.id || source.paper_id || source.id,
        doi: paper.doi || source.doi,
        title: context.title || paper.title
      });
      if (loadedPaper) {
        context.title = context.title || loadedPaper.title;
        context.abstract = context.abstract || loadedPaper.abstract;
        context.content = cleanText(loadedPaper.content, 12000);
      }
    }
    const evidenceText = [context.title, context.summary, context.abstract, context.methods, context.content].filter(Boolean).join(' ');
    if (!evidenceText) {
      return {
        ok: false,
        status: 'error',
        error: 'Paper analysis requires a paper reference (id, doi, or title) for a locally ingested paper, or paper text.'
      };
    }

    if (cleanText(loadedPaper?.markdown_path, 10)) {
      return analyzeLocalPaperWithSubAgent(source, context, loadedPaper);
    }

    const llmResult = await requestStructuredJsonPayload({
      source,
      stage: 'paper_analysis_tool',
      systemPrompt: PAPER_ANALYSIS_SYSTEM_PROMPT,
      userPrompt: buildPrompt(context),
      schema: PAPER_ANALYSIS_RESPONSE_SCHEMA,
      traceContext: source.traceContext || null,
      defaultError: 'Paper analysis provider is not configured.'
    });

    if (!llmResult?.ok || !llmResult.payload) {
      return {
        ok: false,
        status: 'error',
        error: cleanText(llmResult?.error, 600) || 'Paper analysis failed.'
      };
    }

    const normalized = normalizePaperPayload(llmResult.payload);
    let generatedProtocol = null;
    if (context.generate_protocol === true && normalized.protocol_candidate) {
      const protocolResult = await protocolGenerationRuntime.generateProtocol({
        protocol: {
          name: normalized.protocol_candidate.title || context.protocol_title_hint,
          purpose: normalized.protocol_candidate.purpose,
          materials: normalized.protocol_candidate.materials,
          steps: normalized.protocol_candidate.steps,
          troubleshooting: normalized.protocol_candidate.troubleshooting || normalized.protocol_candidate.notes || ''
        },
        result_summary: normalized.brief_summary
      });
      if (protocolResult?.ok === true) {
        generatedProtocol = protocolResult.protocol;
      }
    }

    return {
      ok: true,
      status: 'completed',
      paper_title: context.title,
      brief_summary: normalized.brief_summary,
      key_findings: normalized.key_findings,
      method_overview: normalized.method_overview,
      protocol_extraction: normalized.protocol_candidate,
      generated_protocol: generatedProtocol,
      summary: normalized.result_summary || normalized.brief_summary || `Analyzed ${context.title || 'paper'}.`
    };
  }

  return {
    PAPER_ANALYSIS_RESPONSE_SCHEMA,
    PAPER_ANALYSIS_SYSTEM_PROMPT,
    PAPER_ANALYSIS_RULES,
    buildPrompt,
    analyzePaper
  };
}

module.exports = {
  createPaperAnalysisRuntime
};
