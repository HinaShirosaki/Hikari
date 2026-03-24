'use strict';

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');
const { createProtocolGenerationRuntime } = require('./agent-protocol-generation.js');

function createPaperAnalysisRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);

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
          id: cleanText(step?.id, 120),
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

  const protocolGenerationRuntime = deps.protocolGenerationRuntime
    || createProtocolGenerationRuntime({
      ...deps,
      requestStructuredJsonPayload
    });

  async function analyzePaper(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const context = buildPaperContext(source);
    const evidenceText = [context.title, context.summary, context.abstract, context.methods, context.content].filter(Boolean).join(' ');
    if (!evidenceText) {
      return {
        ok: false,
        status: 'error',
        error: 'Paper analysis requires paper title, summary, abstract, methods, or paper text.'
      };
    }

    const llmResult = await requestStructuredJsonPayload({
      provider: cleanText(source.provider, 80),
      endpoint: cleanText(source.endpoint, 2000),
      apiKey: cleanText(source.apiKey, 400),
      model: cleanText(source.model, 120),
      stage: 'paper_analysis_tool',
      systemPrompt: PAPER_ANALYSIS_SYSTEM_PROMPT,
      userPrompt: buildPrompt(context),
      schema: PAPER_ANALYSIS_RESPONSE_SCHEMA,
      traceContext: source.traceContext || null,
      maxOutputTokens: 1800,
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
        provider: cleanText(source.provider, 80),
        endpoint: cleanText(source.endpoint, 2000),
        apiKey: cleanText(source.apiKey, 400),
        model: cleanText(source.model, 120),
        title: normalized.protocol_candidate.title || context.protocol_title_hint,
        purpose: normalized.protocol_candidate.purpose,
        method_text: normalized.protocol_candidate.method_text,
        materials: normalized.protocol_candidate.materials,
        steps: normalized.protocol_candidate.steps,
        source_paper_title: context.title,
        source_summary: normalized.brief_summary,
        message: context.message,
        traceContext: source.traceContext || null
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
    analyzePaper
  };
}

module.exports = {
  createPaperAnalysisRuntime
};
