'use strict';

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');

function createProtocolGenerationRuntime(deps = {}) {
  const createId = typeof deps.createId === 'function'
    ? deps.createId
    : null;
  const now = typeof deps.now === 'function'
    ? deps.now
    : (() => new Date().toISOString());
  const {
    asArray,
    cleanText,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);
  let generatedIdCounter = 0;

  const PROTOCOL_GENERATION_RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['protocol', 'result_summary'],
    properties: {
      protocol: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'purpose', 'materials', 'steps', 'troubleshooting'],
        properties: {
          name: { type: 'string' },
          purpose: { type: 'string' },
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
                  additionalProperties: false,
                  required: ['text'],
                  properties: {
                    id: { type: 'string' },
                    text: { type: 'string' },
                    instruction: { type: 'string' },
                    action: { type: 'string' },
                    step_number: { type: 'integer' },
                    placeholders: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['name'],
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' }
                        }
                      }
                    }
                  }
                }
              ]
            }
          },
          troubleshooting: {
            anyOf: [
              { type: 'string' },
              { type: 'null' },
              {
                type: 'array',
                items: {
                  anyOf: [
                    { type: 'string' },
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        problem: { type: 'string' },
                        possible_cause: { type: 'string' },
                        possibleCause: { type: 'string' },
                        solution: { type: 'string' }
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      },
      result_summary: { anyOf: [{ type: 'string' }, { type: 'null' }] }
    }
  };

  const PROTOCOL_GENERATION_SYSTEM_PROMPT = [
    'You generate a concise, reusable lab protocol from paper methods or extracted procedure notes.',
    'Use only the supplied evidence.',
    'Do not invent experimental details that are not supported.',
    'Return JSON only.'
  ].join(' ');

  const PROTOCOL_GENERATION_RULES = [
    'Write a short protocol name and a one-sentence purpose.',
    'List only materials that are explicit or strongly supported by the provided evidence.',
    'Produce ordered steps that are operational and concise.',
    'If the paper omits important values, use bracket placeholders like [time] or [temperature] instead of fabricating numbers.',
    'Return the protocol object in the app import format with name, purpose, materials, steps, and troubleshooting.'
  ];

  function createGeneratedId(prefix = 'agent') {
    generatedIdCounter += 1;
    const externalId = cleanText(createId ? createId() : '', 120);
    if (externalId) {
      return generatedIdCounter === 1 ? externalId : `${externalId}-${generatedIdCounter}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${generatedIdCounter.toString(36)}`;
  }

  function normalizeIsoTimestamp(rawValue, fallback = '') {
    const candidate = String(rawValue || '').trim();
    if (!candidate) {
      return fallback;
    }
    const timestamp = Date.parse(candidate);
    if (!Number.isFinite(timestamp)) {
      return fallback;
    }
    return new Date(timestamp).toISOString();
  }

  function stripBulletPrefix(rawLine) {
    return String(rawLine || '')
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
      .trim();
  }

  function splitTextLines(rawText) {
    return String(rawText || '').replace(/\r\n?/g, '\n').split('\n');
  }

  function parseBulletLines(rawText) {
    return splitTextLines(rawText)
      .map((line) => stripBulletPrefix(line))
      .filter(Boolean);
  }

  function normalizeMaterials(rawMaterials) {
    if (Array.isArray(rawMaterials)) {
      return rawMaterials.map((item) => cleanText(item, 220)).filter(Boolean);
    }

    const value = cleanText(rawMaterials, 6000);
    if (!value) {
      return [];
    }

    return parseBulletLines(value);
  }

  function extractPlaceholdersFromText(rawText) {
    const placeholders = [];
    const cleanedText = String(rawText || '')
      .replace(/\[([^[\]]*)\]/g, (_match, rawName) => {
        const name = String(rawName || '').trim() || 'value';
        const id = createGeneratedId('ph');
        placeholders.push({ id, name });
        return `{{ph:${id}}}`;
      })
      .replace(/\s+/g, ' ')
      .trim();
    return { cleanedText, placeholders };
  }

  function normalizeTroubleshooting(rawTroubleshooting) {
    if (Array.isArray(rawTroubleshooting)) {
      return rawTroubleshooting
        .map((item) => {
          if (typeof item === 'string') {
            return cleanText(item, 1200);
          }
          if (!item || typeof item !== 'object') {
            return '';
          }
          const problem = cleanText(item.problem, 400);
          const possibleCause = cleanText(item.possible_cause || item.possibleCause, 400);
          const solution = cleanText(item.solution, 400);
          const parts = [];
          if (problem) {
            parts.push(`Problem: ${problem}`);
          }
          if (possibleCause) {
            parts.push(`Possible cause: ${possibleCause}`);
          }
          if (solution) {
            parts.push(`Solution: ${solution}`);
          }
          return parts.join('; ');
        })
        .filter(Boolean)
        .join('\n');
    }
    return cleanText(rawTroubleshooting, 6000);
  }

  function normalizeImportedProtocolStepEntries(rawSteps) {
    if (!Array.isArray(rawSteps)) {
      return [];
    }

    const sortedSteps = rawSteps
      .map((step, index) => ({ step, index }))
      .filter((entry) => entry.step != null)
      .sort((a, b) => {
        const numberA = Number(a.step?.step_number);
        const numberB = Number(b.step?.step_number);
        const hasNumberA = Number.isFinite(numberA);
        const hasNumberB = Number.isFinite(numberB);
        if (hasNumberA && hasNumberB && numberA !== numberB) {
          return numberA - numberB;
        }
        if (hasNumberA !== hasNumberB) {
          return hasNumberA ? -1 : 1;
        }
        return a.index - b.index;
      })
      .map((entry) => entry.step);

    return sortedSteps
      .map((rawStep) => {
        if (typeof rawStep === 'string') {
          const rawText = cleanText(rawStep, 2000);
          if (!rawText) {
            return null;
          }
          const parsed = extractPlaceholdersFromText(rawText);
          return {
            id: createGeneratedId('step'),
            text: parsed.cleanedText || rawText,
            placeholders: parsed.placeholders
          };
        }

        if (!rawStep || typeof rawStep !== 'object') {
          return null;
        }

        const rawText = cleanText(rawStep.text || rawStep.action || rawStep.instruction, 2000);
        if (!rawText) {
          return null;
        }

        const placeholders = asArray(rawStep.placeholders)
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            id: cleanText(item.id, 120) || createGeneratedId('ph'),
            name: cleanText(item.name, 160)
          }))
          .filter((item) => item.name);

        if (placeholders.length) {
          return {
            id: cleanText(rawStep.id, 120) || createGeneratedId('step'),
            text: rawText,
            placeholders
          };
        }

        const parsed = extractPlaceholdersFromText(rawText);
        return {
          id: cleanText(rawStep.id, 120) || createGeneratedId('step'),
          text: parsed.cleanedText || rawText,
          placeholders: parsed.placeholders
        };
      })
      .filter(Boolean)
      .slice(0, 120);
  }

  function normalizeGeneratedProtocol(payload, input = {}) {
    const payloadSource = payload && typeof payload === 'object' ? payload : {};
    const source = payloadSource.protocol && typeof payloadSource.protocol === 'object'
      ? payloadSource.protocol
      : payloadSource;
    const inputSource = input && typeof input === 'object' ? input : {};
    const createdAt = normalizeIsoTimestamp(
      inputSource.createdAt || source.createdAt || now(),
      new Date().toISOString()
    );
    const updatedAt = normalizeIsoTimestamp(inputSource.updatedAt || source.updatedAt, createdAt) || createdAt;
    const steps = normalizeImportedProtocolStepEntries(
      Array.isArray(source.steps)
        ? source.steps
        : (Array.isArray(source.procedure) ? source.procedure : inputSource.steps)
    );
    return {
      id: cleanText(inputSource.protocol_id || source.id, 120) || createGeneratedId('protocol'),
      name: cleanText(
        source.name
          || source.title
          || payloadSource.protocol_name
          || inputSource.title
          || inputSource.protocol_title_hint,
        220
      ) || 'Generated protocol',
      createdAt,
      updatedAt,
      purpose: cleanText(source.purpose || inputSource.purpose || inputSource.message, 600),
      materials: normalizeMaterials(source.materials || inputSource.materials).slice(0, 60),
      steps,
      troubleshooting: normalizeTroubleshooting(
        source.troubleshooting || source.notes || payloadSource.notes || inputSource.troubleshooting
      )
    };
  }

  function buildPrompt(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const stepSeed = asArray(source.steps)
      .map((step) => (typeof step === 'string' ? cleanText(step, 1200) : cleanText(step?.text || step?.instruction || step?.action, 1200)))
      .filter(Boolean)
      .join('\n- ');
    const materialSeed = asArray(source.materials).map((item) => cleanText(item, 220)).filter(Boolean).join(', ');
    return [
      'Generate a concise protocol JSON object from the evidence below.',
      PROTOCOL_GENERATION_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n'),
      `Protocol title hint: ${cleanText(source.title || source.protocol_title_hint, 220) || '-'}`,
      `Purpose hint: ${cleanText(source.purpose, 600) || '-'}`,
      `Source paper title: ${cleanText(source.source_paper_title, 220) || '-'}`,
      `Source summary: ${cleanText(source.source_summary, 2400) || '-'}`,
      `Method text:\n${cleanText(source.method_text || source.methodText, 12000) || '-'}`,
      `Material hints: ${materialSeed || '-'}`,
      `Step hints:\n- ${stepSeed || '-'}`,
      `User request: ${cleanText(source.message, 2400) || '-'}`,
      'Return JSON with protocol { name, purpose, materials, steps, troubleshooting } and result_summary.',
      'If a required value is missing, keep the step operational but use bracket placeholders such as [time], [temperature], or [buffer].'
    ].join('\n\n');
  }

  async function generateProtocol(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const prompt = buildPrompt(source);
    const evidenceText = [
      cleanText(source.method_text || source.methodText, 4000),
      cleanText(source.source_summary, 1200),
      cleanText(source.message, 1200),
      asArray(source.steps).length ? 'steps' : '',
      asArray(source.materials).length ? 'materials' : ''
    ].filter(Boolean).join(' ');

    if (!evidenceText) {
      return {
        ok: false,
        status: 'error',
        error: 'Protocol generation requires method_text, steps, materials, source_summary, or message evidence.'
      };
    }

    const llmResult = await requestStructuredJsonPayload({
      source,
      stage: 'protocol_generation',
      systemPrompt: PROTOCOL_GENERATION_SYSTEM_PROMPT,
      userPrompt: prompt,
      schema: PROTOCOL_GENERATION_RESPONSE_SCHEMA,
      traceContext: source.traceContext || null,
      defaultError: 'Protocol generation provider is not configured.'
    });

    if (!llmResult?.ok || !llmResult.payload) {
      return {
        ok: false,
        status: 'error',
        error: cleanText(llmResult?.error, 600) || 'Protocol generation failed.'
      };
    }

    const protocol = normalizeGeneratedProtocol(llmResult.payload, source);
    if (!protocol.name || !protocol.steps.length) {
      return {
        ok: false,
        status: 'error',
        error: 'Protocol generation returned incomplete protocol content.'
      };
    }

    return {
      ok: true,
      status: 'generated',
      protocol,
      summary: cleanText(llmResult.payload.result_summary, 320) || `Generated protocol "${protocol.name}".`
    };
  }

  return {
    PROTOCOL_GENERATION_RESPONSE_SCHEMA,
    PROTOCOL_GENERATION_SYSTEM_PROMPT,
    PROTOCOL_GENERATION_RULES,
    buildPrompt,
    normalizeGeneratedProtocol,
    generateProtocol
  };
}

module.exports = {
  createProtocolGenerationRuntime
};
