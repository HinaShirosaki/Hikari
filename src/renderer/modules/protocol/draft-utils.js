import { PLACEHOLDER_TOKEN_REGEX } from './constants.js';

export function createProtocolDraftHelpers({
  createId,
  placeholderTokenRegex = PLACEHOLDER_TOKEN_REGEX
}) {
  function createEmptyDraft() {
    return {
      id: null,
      name: '',
      purpose: '',
      materials: [],
      steps: [],
      troubleshooting: '',
      createdAt: '',
      updatedAt: ''
    };
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

  function parseTimestamp(rawValue) {
    const timestamp = Date.parse(String(rawValue || '').trim());
    return Number.isFinite(timestamp) ? timestamp : 0;
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

  function formatBulletLines(lines) {
    const values = Array.isArray(lines) ? lines : [];
    return values
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .map((line) => `• ${line}`)
      .join('\n');
  }

  function normalizeLineForMatching(rawLine) {
    return stripBulletPrefix(rawLine)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeMaterials(rawMaterials) {
    if (Array.isArray(rawMaterials)) {
      return rawMaterials.map((item) => String(item || '').trim()).filter(Boolean);
    }

    const value = String(rawMaterials || '').trim();
    if (!value) {
      return [];
    }

    return parseBulletLines(value);
  }

  function getStepText(step) {
    if (typeof step === 'string') {
      return step.trim();
    }
    return String(step?.text || step?.instruction || '').trim();
  }

  function cloneStep(step) {
    const stepText = getStepText(step);
    return {
      id: String(step?.id || createId()),
      text: stepText,
      placeholders: Array.isArray(step?.placeholders)
        ? step.placeholders
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({ id: String(item.id || createId()), name: String(item.name || '').trim() }))
          .filter((item) => item.name)
        : []
    };
  }

  function cloneDraftFromProtocol(protocol) {
    const createdAt = normalizeIsoTimestamp(protocol?.createdAt);
    const updatedAt = normalizeIsoTimestamp(protocol?.updatedAt, createdAt);

    return {
      id: protocol?.id || null,
      name: String(protocol?.name || '').trim(),
      purpose: String(protocol?.purpose || '').trim(),
      materials: normalizeMaterials(protocol?.materials),
      steps: Array.isArray(protocol?.steps) ? protocol.steps.map((step) => cloneStep(step)) : [],
      troubleshooting: String(protocol?.troubleshooting || '').trim(),
      createdAt,
      updatedAt
    };
  }

  function stepToEditableLine(step) {
    const source = getStepText(step);
    const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
    const matches = [...source.matchAll(placeholderTokenRegex)];

    if (!matches.length) {
      if (!placeholders.length) {
        return source.trim();
      }
      const trailing = placeholders
        .map((placeholder) => String(placeholder?.name || '').trim())
        .filter(Boolean)
        .map((name) => `[${name}]`)
        .join(' ');
      return `${source} ${trailing}`.trim();
    }

    let cursor = 0;
    let line = '';

    matches.forEach((match) => {
      const index = Number(match.index || 0);
      const placeholderId = String(match[1] || '');
      const placeholder = placeholders.find((item) => String(item.id) === placeholderId);
      line += source.slice(cursor, index);
      line += `[${placeholder?.name || 'value'}]`;
      cursor = index + match[0].length;
    });

    line += source.slice(cursor);
    return line.trim();
  }

  function formatStepLines(steps) {
    const values = Array.isArray(steps) ? steps : [];
    return values
      .map((step) => stepToEditableLine(step))
      .filter(Boolean)
      .map((line) => `• ${line}`)
      .join('\n');
  }

  function extractPlaceholdersFromText(rawText) {
    const placeholders = [];
    const cleaned = String(rawText || '')
      .replace(/\[([^[\]]*)\]/g, (_match, name) => {
        const trimmed = String(name || '').trim() || 'value';
        const id = createId();
        placeholders.push({ id, name: trimmed });
        return `{{ph:${id}}}`;
      })
      .replace(/\s+/g, ' ')
      .trim();

    return { cleanedText: cleaned, placeholders };
  }

  function normalizeTroubleshooting(rawTroubleshooting) {
    if (Array.isArray(rawTroubleshooting)) {
      return rawTroubleshooting
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const problem = String(item.problem || '').trim();
          const possibleCause = String(item.possible_cause || item.possibleCause || '').trim();
          const solution = String(item.solution || '').trim();
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
    return String(rawTroubleshooting || '').trim();
  }

  function normalizeMethodStepEntries(rawSteps) {
    if (!Array.isArray(rawSteps)) {
      return [];
    }

    const sortedSteps = rawSteps
      .map((step, index) => ({ step, index }))
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
          return String(rawStep || '').trim();
        }
        if (!rawStep || typeof rawStep !== 'object') {
          return '';
        }
        return String(rawStep.action || rawStep.text || rawStep.instruction || '').trim();
      })
      .filter(Boolean)
      .map((text) => {
        const parsed = extractPlaceholdersFromText(text);
        return {
          id: createId(),
          text: parsed.cleanedText || text,
          placeholders: parsed.placeholders
        };
      });
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
          const rawText = String(rawStep || '').trim();
          if (!rawText) {
            return null;
          }
          const parsed = extractPlaceholdersFromText(rawText);
          return {
            id: createId(),
            text: parsed.cleanedText || rawText,
            placeholders: parsed.placeholders
          };
        }
        if (!rawStep || typeof rawStep !== 'object') {
          return null;
        }

        const rawText = String(rawStep.text || rawStep.action || rawStep.instruction || '').trim();
        if (!rawText) {
          return null;
        }

        const placeholders = Array.isArray(rawStep.placeholders)
          ? rawStep.placeholders
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({ id: String(item.id || createId()), name: String(item.name || '').trim() }))
            .filter((item) => item.name)
          : [];

        if (placeholders.length) {
          return {
            id: String(rawStep.id || createId()),
            text: rawText,
            placeholders
          };
        }

        const parsed = extractPlaceholdersFromText(rawText);
        return {
          id: String(rawStep.id || createId()),
          text: parsed.cleanedText || rawText,
          placeholders: parsed.placeholders
        };
      })
      .filter(Boolean);
  }

  function sanitizeIncomingProtocol(rawProtocol) {
    if (!rawProtocol || typeof rawProtocol !== 'object') {
      return null;
    }

    const name = String(rawProtocol.name || rawProtocol.title || '').trim();
    if (!name) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const parsedCreatedAt = Date.parse(String(rawProtocol.createdAt || '').trim());
    const createdAt = Number.isFinite(parsedCreatedAt) ? new Date(parsedCreatedAt).toISOString() : nowIso;
    const parsedUpdatedAt = Date.parse(String(rawProtocol.updatedAt || '').trim());
    const updatedAt = Number.isFinite(parsedUpdatedAt) ? new Date(parsedUpdatedAt).toISOString() : createdAt;

    return {
      id: String(rawProtocol.id || createId()),
      name,
      createdAt,
      updatedAt,
      purpose: String(rawProtocol.purpose || '').trim(),
      materials: normalizeMaterials(rawProtocol.materials),
      steps: normalizeImportedProtocolStepEntries(rawProtocol.steps || rawProtocol.procedure),
      troubleshooting: normalizeTroubleshooting(rawProtocol.troubleshooting)
    };
  }

  function sanitizeIncomingProtocols(rawProtocols) {
    if (Array.isArray(rawProtocols)) {
      return rawProtocols.map((item) => sanitizeIncomingProtocol(item)).filter(Boolean);
    }
    const single = sanitizeIncomingProtocol(rawProtocols);
    return single ? [single] : [];
  }

  function parseLooseJsonObjectOrArray(rawInput) {
    const text = String(rawInput || '').trim();
    if (!text) {
      return null;
    }

    const candidates = [text];
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) {
      candidates.push(String(fenceMatch[1]).trim());
    }

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(text.slice(firstBrace, lastBrace + 1));
    }

    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      candidates.push(text.slice(firstBracket, lastBracket + 1));
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
          return parsed;
        }
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  }

  function parseProtocolsFromJson(rawInput) {
    const parsed = parseLooseJsonObjectOrArray(rawInput);
    if (!parsed) {
      return [];
    }

    if (Array.isArray(parsed)) {
      return sanitizeIncomingProtocols(parsed);
    }
    if (Array.isArray(parsed.protocols)) {
      return sanitizeIncomingProtocols(parsed.protocols);
    }
    if (parsed.protocol && typeof parsed.protocol === 'object') {
      return sanitizeIncomingProtocols(parsed.protocol);
    }
    if (parsed.type === 'protocol_share_link') {
      return sanitizeIncomingProtocols(parsed.protocol || parsed.protocols);
    }
    return sanitizeIncomingProtocols(parsed);
  }

  function buildStepEntriesFromText(rawText, existingSteps = []) {
    const buckets = new Map();

    (Array.isArray(existingSteps) ? existingSteps : []).forEach((step) => {
      const key = normalizeLineForMatching(stepToEditableLine(step));
      if (!key) {
        return;
      }
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key).push(cloneStep(step));
    });

    const entries = [];
    splitTextLines(rawText).forEach((rawLine, lineIndex) => {
      const cleanedLine = stripBulletPrefix(rawLine);
      if (!cleanedLine) {
        return;
      }

      const key = normalizeLineForMatching(cleanedLine);
      const queue = buckets.get(key);

      let step = null;
      if (queue && queue.length) {
        step = queue.shift();
      }

      if (!step) {
        const parsed = extractPlaceholdersFromText(cleanedLine);
        step = {
          id: createId(),
          text: parsed.cleanedText || cleanedLine,
          placeholders: parsed.placeholders
        };
      }

      entries.push({ lineIndex, step });
    });

    return entries;
  }

  return {
    createEmptyDraft,
    normalizeIsoTimestamp,
    parseTimestamp,
    stripBulletPrefix,
    splitTextLines,
    parseBulletLines,
    formatBulletLines,
    normalizeLineForMatching,
    normalizeMaterials,
    getStepText,
    cloneStep,
    cloneDraftFromProtocol,
    stepToEditableLine,
    formatStepLines,
    extractPlaceholdersFromText,
    normalizeTroubleshooting,
    normalizeMethodStepEntries,
    normalizeImportedProtocolStepEntries,
    sanitizeIncomingProtocol,
    sanitizeIncomingProtocols,
    parseLooseJsonObjectOrArray,
    parseProtocolsFromJson,
    buildStepEntriesFromText
  };
}
