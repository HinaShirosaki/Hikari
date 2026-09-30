'use strict';

const { asArray, ensureObject } = require('../../lib/normalize.js');
const {
  normalizeIsoTimestamp: normalizeSharedIsoTimestamp,
  normalizeProtocolMaterials,
  normalizeProtocolTroubleshooting,
  uniquePlaceholderIds
} = require('../../../shared/protocol-normalization.mjs');

// The length argument is ignored on purpose: this output replaces the user's
// protocol on an update, and cutting it there loses their text.
function cleanText(value) {
  return String(value || '').trim();
}

function parseJsonObject(raw = '') {
  try {
    const parsed = JSON.parse(String(raw || ''));
    return ensureObject(parsed);
  } catch {
    return {};
  }
}

function createProtocolGenerationRuntime(deps = {}) {
  const createId = typeof deps.createId === 'function'
    ? deps.createId
    : null;
  const now = typeof deps.now === 'function'
    ? deps.now
    : (() => new Date().toISOString());
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
    'You receive protocol JSON that is already authored by the caller.',
    'Do not generate protocol content inside this tool.',
    'Normalize the supplied protocol JSON into the app import format.',
    'Return JSON only.'
  ].join(' ');

  const PROTOCOL_GENERATION_RULES = [
    'Use the supplied protocol JSON as the source of truth.',
    'Do not call an LLM or web search from this tool.',
    'Do not require or synthesize a protocol id.',
    'Normalize name/title, purpose, materials, steps, timestamps, placeholders, and troubleshooting.',
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

  const normalizeIsoTimestamp = (rawValue, fallback = '') => (
    normalizeSharedIsoTimestamp(rawValue, fallback, { text: cleanText, maxLength: 0 })
  );

  const normalizeMaterials = (rawMaterials) => normalizeProtocolMaterials(rawMaterials, {
    text: cleanText
  });

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

  const normalizeTroubleshooting = (rawTroubleshooting) => normalizeProtocolTroubleshooting(
    rawTroubleshooting,
    { text: cleanText }
  );

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

    const steps = sortedSteps
      .map((rawStep) => {
        if (typeof rawStep === 'string') {
          const rawText = cleanText(rawStep, 2000);
          if (!rawText) {
            return null;
          }
          const parsed = extractPlaceholdersFromText(rawText);
          return {
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
            text: rawText,
            placeholders
          };
        }

        const parsed = extractPlaceholdersFromText(rawText);
        return {
          text: parsed.cleanedText || rawText,
          placeholders: parsed.placeholders
        };
      })
      .filter(Boolean);
    return uniquePlaceholderIds(steps, () => createGeneratedId('ph'));
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
      materials: normalizeMaterials(source.materials || inputSource.materials),
      steps,
      troubleshooting: normalizeTroubleshooting(
        source.troubleshooting || source.notes || payloadSource.notes || inputSource.troubleshooting
      )
    };
  }

  function resolveProtocolPayload(input = {}) {
    const source = ensureObject(input);
    if (source.protocol && typeof source.protocol === 'object' && !Array.isArray(source.protocol)) {
      return source.protocol;
    }
    const rawProtocolJson = cleanText(source.protocol_json || source.protocolJson, 200000);
    if (rawProtocolJson) {
      const parsed = parseJsonObject(rawProtocolJson);
      if (parsed.protocol && typeof parsed.protocol === 'object' && !Array.isArray(parsed.protocol)) {
        return parsed.protocol;
      }
      if (Object.keys(parsed).length) {
        return parsed;
      }
    }
    if ((source.name || source.title || source.protocol_title_hint) && Array.isArray(source.steps)) {
      return source;
    }
    return {};
  }

  function buildPrompt(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const protocol = resolveProtocolPayload(source);
    return [
      'Normalize the supplied protocol JSON. Do not generate protocol content here.',
      PROTOCOL_GENERATION_RULES.map((rule, index) => `${index + 1}. ${rule}`).join('\n'),
      'Input protocol JSON:',
      JSON.stringify(protocol && Object.keys(protocol).length ? protocol : source, null, 2),
      'Return JSON with protocol { name, purpose, materials, steps, troubleshooting } and result_summary.'
    ].join('\n\n');
  }

  async function generateProtocol(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const protocolPayload = resolveProtocolPayload(source);
    if (!Object.keys(protocolPayload).length) {
      return {
        ok: false,
        status: 'error',
        error: 'Protocol generation requires a protocol JSON object.'
      };
    }

    const protocol = normalizeGeneratedProtocol(protocolPayload, source);
    if (!protocol.name || !protocol.steps.length) {
      return {
        ok: false,
        status: 'error',
        error: 'Protocol JSON must include a protocol name and at least one step.'
      };
    }

    return {
      ok: true,
      status: 'normalized',
      protocol,
      summary: cleanText(source.result_summary || source.resultSummary || source.summary, 320)
        || `Prepared protocol "${protocol.name}".`
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
