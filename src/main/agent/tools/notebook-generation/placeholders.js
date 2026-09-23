'use strict';

const {
  PROTOCOL_PLACEHOLDER_TOKEN_REGEX,
  PROTOCOL_INLINE_PLACEHOLDER_REGEX,
  PROTOCOL_TO_NOTEBOOK_FILL_RULES,
  PROTOCOL_TO_NOTEBOOK_FILL_EXAMPLES
} = require('./prompts.js');

// Reads placeholders out of a protocol, guesses the ones that are mechanical,
// and normalizes whatever the model fills in back onto canonical keys.
function createPlaceholderHelpers({
  asArray,
  cleanText,
  uniqueStrings
} = {}) {
  function buildNotebookPlaceholderFillPrompt({
    message,
    conversation,
    parserPayload,
    selectedProtocol,
    project,
    placeholders,
    unresolvedPlaceholders,
    toolContext = null
  } = {}) {
    const promptConversation = asArray(conversation).slice(-32).map((row, index) => {
      const role = row?.role === 'assistant' ? 'assistant' : 'user';
      const text = cleanText(row?.text, 3000);
      return text ? `${index + 1}. ${role}: ${text}` : '';
    }).filter(Boolean).join('\n');
    return [
      ...PROTOCOL_TO_NOTEBOOK_FILL_RULES,
      ...PROTOCOL_TO_NOTEBOOK_FILL_EXAMPLES,
      `User message: ${cleanText(message, 12000)}`,
      promptConversation ? `Recent conversation:\n${promptConversation}` : '',
      `Parser JSON:\n${JSON.stringify(parserPayload || {}, null, 2)}`,
      `Selected protocol JSON:\n${JSON.stringify({
        id: selectedProtocol?.id,
        name: selectedProtocol?.name,
        purpose: selectedProtocol?.purpose,
        steps: asArray(selectedProtocol?.steps)
      }, null, 2)}`,
      `Resolved project JSON:\n${JSON.stringify(project || {}, null, 2)}`,
      toolContext ? `Optional tool context JSON:\n${JSON.stringify(toolContext, null, 2)}` : '',
      `All placeholders JSON:\n${JSON.stringify(placeholders, null, 2)}`,
      `Unresolved placeholders JSON:\n${JSON.stringify(unresolvedPlaceholders, null, 2)}`
    ].filter(Boolean).join('\n\n');
  }

  function buildProtocolPlaceholderRows(protocolRecord = {}) {
    const rows = [];
    asArray(protocolRecord.steps).forEach((step) => {
      const stepId = cleanText(step?.id, 120);
      const stepText = cleanText(step?.text, 6000);
      const placeholders = asArray(step?.placeholders).map((placeholder) => ({
        id: cleanText(placeholder?.id, 120),
        name: cleanText(placeholder?.name, 120) || 'value'
      })).filter((placeholder) => placeholder.id);

      const matches = [...stepText.matchAll(PROTOCOL_PLACEHOLDER_TOKEN_REGEX)];
      matches.forEach((match) => {
        const matchedId = cleanText(match?.[1], 120);
        if (!matchedId) {
          return;
        }
        if (!placeholders.some((placeholder) => placeholder.id === matchedId)) {
          placeholders.push({
            id: matchedId,
            name: 'value'
          });
        }
      });

      const inlineMatches = [...stepText.matchAll(PROTOCOL_INLINE_PLACEHOLDER_REGEX)];
      inlineMatches.forEach((match, index) => {
        const inlineName = cleanText(match?.[1], 120) || 'value';
        const syntheticId = `inline-${stepId || 'step'}-${index + 1}`;
        if (!placeholders.some((placeholder) => placeholder.id === syntheticId)) {
          placeholders.push({
            id: syntheticId,
            name: inlineName
          });
        }
      });

      placeholders.forEach((placeholder) => {
        const placeholderKey = `${stepId}:${placeholder.id}`;
        rows.push({
          step_id: stepId,
          placeholder_id: placeholder.id,
          placeholder_key: placeholderKey,
          display: placeholder.name || 'value',
          step_text: stepText
        });
      });
    });
    return rows.filter((row) => row.step_id && row.placeholder_id && row.placeholder_key);
  }

  function inferDeterministicPlaceholderValue({
    placeholder,
    parserPayload,
    project,
    protocol,
    message
  }) {
    const display = cleanText(placeholder?.display, 120).toLowerCase();
    const entities = parserPayload?.entities && typeof parserPayload.entities === 'object'
      ? parserPayload.entities
      : {};
    if (!display) {
      return '';
    }
    if (display.includes('date')) {
      return new Date().toISOString().slice(0, 10);
    }
    if (display.includes('project') && cleanText(project?.name, 220)) {
      return cleanText(project.name, 220);
    }
    if (display.includes('protocol') && cleanText(protocol?.name, 220)) {
      return cleanText(protocol.name, 220);
    }
    if ((display.includes('cell') || display.includes('cell line')) && cleanText(entities.cell_line, 120)) {
      return cleanText(entities.cell_line, 120);
    }
    if ((display.includes('workflow') || display.includes('step')) && cleanText(entities.workflow_step, 180)) {
      return cleanText(entities.workflow_step, 180);
    }
    if ((display.includes('activity') || display.includes('task')) && cleanText(entities.activity_type, 180)) {
      return cleanText(entities.activity_type, 180);
    }
    if (display.includes('sample')) {
      const sampleMatch = String(message || '').match(/\b(sample|tube|clone)\s+([A-Za-z0-9._-]{2,40})/i);
      if (sampleMatch) {
        return cleanText(sampleMatch[2], 120);
      }
    }
    return '';
  }

  function resolveCanonicalPlaceholderKey(row = {}, knownPlaceholderMap = new Map()) {
    const normalizedMap = new Map();
    const byDisplay = new Map();
    Array.from(knownPlaceholderMap.entries()).forEach(([key, value]) => {
      const canonicalKey = cleanText(key, 160);
      if (!canonicalKey) {
        return;
      }
      const lowerKey = canonicalKey.toLowerCase();
      normalizedMap.set(lowerKey, canonicalKey);
      const display = cleanText(value?.display, 120).toLowerCase();
      if (display) {
        if (!byDisplay.has(display)) {
          byDisplay.set(display, []);
        }
        byDisplay.get(display).push(canonicalKey);
      }
    });

    const directCandidates = [
      cleanText(row?.placeholder_key, 160),
      cleanText(row?.placeholder_id, 120),
      cleanText(row?.key, 160)
    ].filter(Boolean);
    for (const candidate of directCandidates) {
      const direct = normalizedMap.get(candidate.toLowerCase());
      if (direct) {
        return direct;
      }
      if (!candidate.includes(':')) {
        const suffixMatches = Array.from(normalizedMap.keys())
          .filter((key) => key.endsWith(`:${candidate.toLowerCase()}`))
          .map((key) => normalizedMap.get(key))
          .filter(Boolean);
        if (suffixMatches.length === 1) {
          return suffixMatches[0];
        }
      }
    }

    const displayCandidates = [
      cleanText(row?.display, 120),
      cleanText(row?.name, 120),
      cleanText(row?.placeholder_name, 120)
    ].filter(Boolean).map((value) => value.toLowerCase());
    for (const display of displayCandidates) {
      const matches = byDisplay.get(display) || [];
      if (matches.length === 1) {
        return matches[0];
      }
    }
    return '';
  }

  function normalizeNotebookFillPayload(rawPayload, knownPlaceholderMap = new Map()) {
    const parsed = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const filledValues = [];
    const seenFilled = new Set();
    asArray(parsed.filled_values).forEach((row) => {
      const placeholderKey = resolveCanonicalPlaceholderKey(row, knownPlaceholderMap);
      const value = cleanText(row?.value, 260);
      if (!placeholderKey || !value) {
        return;
      }
      const dedupeKey = placeholderKey.toLowerCase();
      if (seenFilled.has(dedupeKey)) {
        return;
      }
      seenFilled.add(dedupeKey);
      filledValues.push({
        placeholder_key: placeholderKey,
        value,
        source: cleanText(row?.source, 120) || 'llm'
      });
    });

    const missingPlaceholders = [];
    const seenMissing = new Set();
    asArray(parsed.missing_placeholders).forEach((row) => {
      const placeholderKey = resolveCanonicalPlaceholderKey(row, knownPlaceholderMap);
      if (!placeholderKey) {
        return;
      }
      const dedupeKey = placeholderKey.toLowerCase();
      if (seenMissing.has(dedupeKey)) {
        return;
      }
      seenMissing.add(dedupeKey);
      missingPlaceholders.push({
        placeholder_key: placeholderKey,
        reason: cleanText(row?.reason, 220) || 'Missing information from user request.'
      });
    });

    return {
      filled_values: filledValues,
      missing_placeholders: missingPlaceholders,
      follow_up_questions: uniqueStrings(asArray(parsed.follow_up_questions), 8).map((item) => cleanText(item, 260)).filter(Boolean),
      result_summary: cleanText(parsed.result_summary, 900)
    };
  }

  return {
    buildNotebookPlaceholderFillPrompt,
    buildProtocolPlaceholderRows,
    inferDeterministicPlaceholderValue,
    resolveCanonicalPlaceholderKey,
    normalizeNotebookFillPayload
  };
}

module.exports = { createPlaceholderHelpers };
