import { PLACEHOLDER_TOKEN_REGEX } from './constants.js';
import {
  normalizeIsoTimestamp as normalizeSharedIsoTimestamp,
  normalizeProtocolMaterials,
  normalizeProtocolTroubleshooting,
  uniquePlaceholderIds
} from '../../../shared/protocol-normalization.mjs';

import { createProtocolDraftImportHelpers } from './draft-import.js';

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

  const normalizeIsoTimestamp = (rawValue, fallback = '') => (
    normalizeSharedIsoTimestamp(rawValue, fallback, { maxLength: 0 })
  );

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

  const normalizeMaterials = (rawMaterials) => normalizeProtocolMaterials(rawMaterials, {
    itemMaxLength: 0
  });

  function getStepText(step) {
    if (typeof step === 'string') {
      return step.trim();
    }
    return String(step?.text || step?.instruction || '').trim();
  }

  function cloneStep(step) {
    const stepText = getStepText(step);
    return {
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

  const normalizeTroubleshooting = (rawTroubleshooting) => normalizeProtocolTroubleshooting(
    rawTroubleshooting,
    { includeStringItems: false }
  );

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

    const steps = sortedSteps
      .map((rawStep) => {
        if (typeof rawStep === 'string') {
          const rawText = String(rawStep || '').trim();
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
    return uniquePlaceholderIds(steps, createId);
  }

  const {
    parseLooseJsonObjectOrArray,
    parseProtocolsFromJson,
    sanitizeIncomingProtocol,
    sanitizeIncomingProtocols
  } = createProtocolDraftImportHelpers({
    createId,
    normalizeImportedProtocolStepEntries,
    normalizeMaterials,
    normalizeTroubleshooting
  });

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
