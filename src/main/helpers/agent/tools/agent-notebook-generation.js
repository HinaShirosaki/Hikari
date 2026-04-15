'use strict';

const { isAgentRequestAbortError } = require('../shared/agent-request-context.js');

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');

function createNotebookGenerationRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    recordAgentLlmTrace,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);
  const recordLifecycleEvent = typeof deps.recordLifecycleEvent === 'function'
    ? deps.recordLifecycleEvent
    : (() => {});
  const runTool = typeof deps.runTool === 'function'
    ? deps.runTool
    : null;

  const PROTOCOL_PLACEHOLDER_TOKEN_REGEX = /\{\{ph:([^}]+)\}\}/g;
  const PROTOCOL_INLINE_PLACEHOLDER_REGEX = /\[([^[\]]{1,80})\]/g;

  const PROTOCOL_NOTEBOOK_FILL_RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['filled_values', 'missing_placeholders', 'follow_up_questions', 'result_summary'],
    properties: {
      filled_values: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['placeholder_key', 'value', 'source'],
          properties: {
            placeholder_key: { type: 'string' },
            value: { type: 'string' },
            source: { type: 'string' }
          }
        }
      },
      missing_placeholders: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['placeholder_key', 'reason'],
          properties: {
            placeholder_key: { type: 'string' },
            reason: { type: 'string' }
          }
        }
      },
      follow_up_questions: {
        type: 'array',
        items: { type: 'string' }
      },
      result_summary: { anyOf: [{ type: 'string' }, { type: 'null' }] }
    }
  };

  const PROTOCOL_TO_NOTEBOOK_FILL_SYSTEM_PROMPT = [
    'You generate a protocol-based notebook draft.',
    'Use the selected protocol, user context, and optional tool evidence.',
    'Fill placeholders only when supported by evidence.',
    'Return JSON only.'
  ].join(' ');

  const PROTOCOL_TO_NOTEBOOK_FILL_RULES = [
    'Fill placeholders using evidence priority: user message, recent conversation, parser entities, project context, optional tool context.',
    'Extract exact value spans from the latest user text when they semantically match unresolved placeholders.',
    'Prefer exact copy of entity strings from user text, including punctuation and hyphenated identifiers.',
    'When unresolved placeholders already exist and the latest user message is a direct answer, map it to the best matching unresolved placeholder.',
    'filled_values.placeholder_key must exactly match one of the provided placeholder_key values.',
    'If optional tool context is provided, use it only when directly relevant.',
    'Do not fabricate values.',
    'Ask follow_up_questions only when ambiguity remains after using user text, conversation, parser data, and optional tool context.',
    'For unresolved placeholders, return missing_placeholders and concise follow_up_questions.'
  ];

  const PROTOCOL_TO_NOTEBOOK_FILL_EXAMPLES = [
    [
      'Example single-turn:',
      'User message: "I did pET28a-SUMO1 transformation today."',
      'Given one unresolved placeholder for a named construct/plasmid, fill it immediately by copying "pET28a-SUMO1" exactly into filled_values.'
    ].join(' '),
    [
      'Example follow-up:',
      'If a previous turn left one unresolved placeholder and user now says "It was pET28a-SUMO1",',
      'treat this as a direct answer and return that exact value for the unresolved placeholder_key.'
    ].join(' ')
  ];

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
    const promptConversation = asArray(conversation).slice(-8).map((row, index) => {
      const role = row?.role === 'assistant' ? 'assistant' : 'user';
      const text = cleanText(row?.text, 1200);
      return text ? `${index + 1}. ${role}: ${text}` : '';
    }).filter(Boolean).join('\n');
    return [
      ...PROTOCOL_TO_NOTEBOOK_FILL_RULES,
      ...PROTOCOL_TO_NOTEBOOK_FILL_EXAMPLES,
      `User message: ${cleanText(message, 3200)}`,
      promptConversation ? `Recent conversation:\n${promptConversation}` : '',
      `Parser JSON:\n${JSON.stringify(parserPayload || {}, null, 2)}`,
      `Selected protocol JSON:\n${JSON.stringify({
        id: selectedProtocol?.id,
        name: selectedProtocol?.name,
        purpose: selectedProtocol?.purpose,
        steps: asArray(selectedProtocol?.steps).slice(0, 40)
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
      const stepText = cleanText(step?.text, 800);
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

  function buildProtocolPlaceholderToolQuery({
    parserPayload = {},
    unresolvedPlaceholders = [],
    message = ''
  } = {}) {
    const entities = parserPayload?.entities && typeof parserPayload.entities === 'object'
      ? parserPayload.entities
      : {};
    const inventorySearch = parserPayload?.inventory_search && typeof parserPayload.inventory_search === 'object'
      ? parserPayload.inventory_search
      : {};

    const unresolvedTerms = asArray(unresolvedPlaceholders)
      .map((row) => cleanText(row?.display || row?.placeholder_key, 120))
      .filter(Boolean)
      .filter((value) => /\b(buffer|reagent|compound|chemical|inventory|stock|protein)\b/i.test(value))
      .slice(0, 3);

    const candidateQueries = uniqueStrings([
      cleanText(inventorySearch.normalized_query, 220),
      ...asArray(inventorySearch.candidate_terms).slice(0, 4),
      cleanText(entities.inventory_item, 220),
      cleanText(entities.compound_name, 220),
      cleanText(entities.protein_name, 220),
      ...unresolvedTerms,
      cleanText(message, 220)
    ], 10);

    return cleanText(candidateQueries[0], 220);
  }

  async function maybeLookupProtocolPlaceholderToolContext({
    snapshot,
    parserPayload,
    unresolvedPlaceholders,
    message,
    traceContext = null,
    lifecycleRecorder = null
  }) {
    if (typeof runTool !== 'function') {
      return null;
    }
    const query = buildProtocolPlaceholderToolQuery({
      parserPayload,
      unresolvedPlaceholders,
      message
    });
    if (!query) {
      return null;
    }

    const args = {
      query,
      limit: 5,
      normalized_query: query,
      search_terms: [query],
      search_mode: 'exact_then_alias_then_fuzzy'
    };
    try {
      const toolResult = await runTool('search_inventory', args, snapshot, {
        allowWriteTools: false
      });
      const items = asArray(toolResult?.items).slice(0, 5).map((item) => ({
        kind: cleanText(item?.kind, 40),
        id: cleanText(item?.id, 120),
        name: cleanText(item?.name, 220),
        quantity: cleanText(item?.quantity, 80),
        amount: cleanText(item?.amount, 80),
        location: cleanText(item?.location, 180),
        supplier: cleanText(item?.supplier, 180),
        matched_term: cleanText(item?.matched_term, 120)
      }));
      const summary = cleanText(toolResult?.summary, 320);
      await recordAgentLlmTrace(traceContext, {
        stage: 'protocol_placeholder_tool_lookup',
        summary: summary || `Placeholder tool lookup completed with ${items.length} inventory records.`,
        request_payload: {
          tool: 'search_inventory',
          args
        },
        response_payload: {
          item_count: items.length,
          items
        }
      });
      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'protocol_placeholder_tool_lookup',
        status: 'ok',
        message: summary || `Resolved ${items.length} inventory records for placeholder context.`,
        meta: {
          tool_name: 'search_inventory',
          query,
          item_count: items.length
        }
      });
      return {
        tool_name: 'search_inventory',
        query,
        summary,
        items
      };
    } catch (error) {
      if (isAgentRequestAbortError(error)) {
        throw error;
      }
      const errorMessage = cleanText(error?.message || error, 320) || 'Placeholder tool lookup failed.';
      await recordAgentLlmTrace(traceContext, {
        stage: 'protocol_placeholder_tool_lookup',
        summary: errorMessage,
        request_payload: {
          tool: 'search_inventory',
          args
        },
        response_payload: {
          error: errorMessage
        }
      });
      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'protocol_placeholder_tool_lookup',
        status: 'failed',
        message: errorMessage,
        meta: {
          tool_name: 'search_inventory',
          query
        }
      });
      return null;
    }
  }

  async function requestNotebookPlaceholderFill({
    provider,
    endpoint,
    apiKey,
    model,
    message,
    conversation,
    parserPayload,
    selectedProtocol,
    project,
    placeholders,
    unresolvedPlaceholders,
    toolContext = null,
    traceContext = null
  }) {
    return requestStructuredJsonPayload({
      stage: 'notebook_fill',
      systemPrompt: PROTOCOL_TO_NOTEBOOK_FILL_SYSTEM_PROMPT,
      userPrompt: buildNotebookPlaceholderFillPrompt({
        message,
        conversation,
        parserPayload,
        selectedProtocol,
        project,
        placeholders,
        unresolvedPlaceholders,
        toolContext
      }),
      schema: PROTOCOL_NOTEBOOK_FILL_RESPONSE_SCHEMA,
      traceContext,
      defaultError: 'Notebook generation provider is not configured.'
    });
  }

  function renderProtocolStepText(step, values) {
    const source = cleanText(step?.text, 1600);
    const placeholders = asArray(step?.placeholders).map((placeholder) => ({
      id: cleanText(placeholder?.id, 120),
      name: cleanText(placeholder?.name, 120) || 'value'
    })).filter((placeholder) => placeholder.id);
    const matches = [...source.matchAll(PROTOCOL_PLACEHOLDER_TOKEN_REGEX)];

    if (!matches.length) {
      if (!placeholders.length) {
        return source;
      }
      const trailingValues = placeholders.map((placeholder) => {
        const key = `${cleanText(step?.id, 120)}:${placeholder.id}`;
        const value = cleanText(values?.[key], 260);
        return value || `[${placeholder.name}]`;
      }).join(' ');
      return `${source} ${trailingValues}`.trim();
    }

    let cursor = 0;
    let text = '';
    matches.forEach((match) => {
      const index = Number(match?.index || 0);
      const placeholderId = cleanText(match?.[1], 120);
      const key = `${cleanText(step?.id, 120)}:${placeholderId}`;
      const placeholder = placeholders.find((item) => item.id === placeholderId);
      const value = cleanText(values?.[key], 260);
      text += source.slice(cursor, index);
      text += value || `[${cleanText(placeholder?.name, 120) || 'value'}]`;
      cursor = index + String(match?.[0] || '').length;
    });
    text += source.slice(cursor);
    return text;
  }

  function buildProtocolNotebookPayload({
    selectedProtocol,
    project,
    placeholders,
    placeholderValuesMap,
    missingPlaceholders,
    message,
    fillSummary = ''
  }) {
    const values = {};
    const placeholderValues = [];
    asArray(placeholders).forEach((placeholder) => {
      const key = cleanText(placeholder?.placeholder_key, 160);
      const value = cleanText(placeholderValuesMap?.[key], 260);
      if (!key || !value) {
        return;
      }
      values[key] = value;
      placeholderValues.push({
        step_id: cleanText(placeholder?.step_id, 120),
        placeholder_id: cleanText(placeholder?.placeholder_id, 120),
        placeholder_key: key,
        display: cleanText(placeholder?.display, 120) || 'value',
        value,
        source: 'resolved',
        source_type: 'agent_protocol_v2'
      });
    });
    const unresolvedRows = asArray(missingPlaceholders).map((row) => ({
      step_id: cleanText(row?.step_id, 120),
      placeholder_id: cleanText(row?.placeholder_id, 120),
      placeholder_key: cleanText(row?.placeholder_key, 160),
      display: cleanText(row?.display, 120) || 'value',
      reason: cleanText(row?.reason, 220) || 'Missing information from user request.'
    })).filter((row) => row.step_id && row.placeholder_id && row.placeholder_key);

    const renderedSteps = asArray(selectedProtocol?.steps).map((step) => renderProtocolStepText(step, values)).filter(Boolean);
    const updatedAt = new Date().toISOString();
    const notebookResult = cleanText(fillSummary, 900)
      || `Notebook draft generated from request: ${cleanText(message, 260)}`;

    return {
      protocol: {
        id: cleanText(selectedProtocol?.id, 120),
        name: cleanText(selectedProtocol?.name, 220)
      },
      project: {
        id: cleanText(project?.id, 120),
        name: cleanText(project?.name, 220),
        resolution_source: cleanText(project?.resolution_source, 80)
      },
      notebook_type: 'biology',
      rendered_steps: renderedSteps,
      placeholder_values: placeholderValues,
      unresolved_placeholders: unresolvedRows,
      save: {
        mode: 'auto_save_draft',
        applied: false,
        status: unresolvedRows.length ? 'needs_more_info' : 'ready_for_save',
        reason: unresolvedRows.length
          ? 'Additional placeholder values are required before finalizing draft.'
          : 'Draft is ready for notebook auto-save.'
      },
      entry_template: {
        notebookType: 'biology',
        projectId: cleanText(project?.id, 120),
        projectName: cleanText(project?.name, 220),
        protocolId: cleanText(selectedProtocol?.id, 120),
        protocolName: cleanText(selectedProtocol?.name, 220),
        values,
        result: notebookResult,
        updatedAt,
        notebookState: 'executed',
        executedAt: updatedAt,
        resultFiles: [],
        resultFileRecords: [],
        agentDraftStatus: unresolvedRows.length ? 'needs_review' : 'draft_ready',
        agentDraftMeta: {
          source: 'agent_protocol_v2',
          unresolvedCount: unresolvedRows.length,
          generatedAt: updatedAt
        }
      }
    };
  }

  function buildMissingPlaceholderQuestion(missingRow = {}) {
    const display = cleanText(missingRow?.display, 120) || cleanText(missingRow?.placeholder_key, 120) || 'value';
    return `Please provide ${display}.`;
  }

  async function generateNotebook({
    provider,
    endpoint,
    apiKey,
    model,
    message,
    conversation,
    snapshot,
    parserPayload,
    selectedProtocol,
    project,
    pendingValues = {},
    traceContext = null,
    lifecycleRecorder = null
  } = {}) {
    if (!selectedProtocol || typeof selectedProtocol !== 'object') {
      return {
        status: 'needs_more_info',
        placeholders: [],
        known_values: {},
        missing_placeholders: [],
        follow_up_questions: ['Please specify which protocol should be used before generating the notebook draft.'],
        notebook: null,
        fill_summary: ''
      };
    }

    const placeholders = buildProtocolPlaceholderRows(selectedProtocol);
    const placeholderMap = new Map(placeholders.map((row) => [cleanText(row.placeholder_key, 160), row]));
    const knownValues = {};
    Object.entries(pendingValues && typeof pendingValues === 'object' ? pendingValues : {}).forEach(([key, value]) => {
      const normalizedKey = cleanText(key, 160);
      const normalizedValue = cleanText(value, 260);
      if (normalizedKey && normalizedValue && placeholderMap.has(normalizedKey)) {
        knownValues[normalizedKey] = normalizedValue;
      }
    });

    placeholders.forEach((placeholder) => {
      const key = cleanText(placeholder.placeholder_key, 160);
      if (!key || cleanText(knownValues[key], 260)) {
        return;
      }
      const inferred = inferDeterministicPlaceholderValue({
        placeholder,
        parserPayload,
        project,
        protocol: selectedProtocol,
        message
      });
      if (inferred) {
        knownValues[key] = cleanText(inferred, 260);
      }
    });

    let unresolved = placeholders.filter((placeholder) => !cleanText(knownValues[placeholder.placeholder_key], 260));
    let fillSummary = '';
    let llmFollowUpQuestions = [];
    if (unresolved.length) {
      const toolContext = await maybeLookupProtocolPlaceholderToolContext({
        snapshot,
        parserPayload,
        unresolvedPlaceholders: unresolved,
        message,
        traceContext,
        lifecycleRecorder
      });
      const fillResult = await requestNotebookPlaceholderFill({
        provider,
        endpoint,
        apiKey,
        model,
        message,
        conversation,
        parserPayload,
        selectedProtocol,
        project,
        placeholders,
        unresolvedPlaceholders: unresolved,
        toolContext,
        traceContext
      });
      if (fillResult.ok && fillResult.payload) {
        const normalizedFill = normalizeNotebookFillPayload(fillResult.payload, placeholderMap);
        normalizedFill.filled_values.forEach((item) => {
          const key = cleanText(item?.placeholder_key, 160);
          const value = cleanText(item?.value, 260);
          if (key && value) {
            knownValues[key] = value;
          }
        });
        fillSummary = cleanText(normalizedFill.result_summary, 900);
        llmFollowUpQuestions = normalizedFill.follow_up_questions;
        unresolved = placeholders
          .filter((placeholder) => !cleanText(knownValues[placeholder.placeholder_key], 260))
          .map((placeholder) => {
            const fromLlm = normalizedFill.missing_placeholders.find((item) => item.placeholder_key === placeholder.placeholder_key);
            return {
              ...placeholder,
              reason: cleanText(fromLlm?.reason, 220) || 'Missing information from user request.'
            };
          });
      } else {
        await recordAgentLlmTrace(traceContext, {
          stage: 'notebook_fill',
          summary: cleanText(fillResult.error, 260) || 'Notebook fill failed; returning clarification path.',
          request_payload: {
            unresolved_count: unresolved.length
          },
          response_payload: {
            error: cleanText(fillResult.error, 320)
          }
        });
      }
    } else {
      await recordAgentLlmTrace(traceContext, {
        stage: 'notebook_fill',
        summary: 'Notebook placeholders resolved deterministically.',
        request_payload: {
          unresolved_count: 0
        },
        response_payload: {
          resolved_count: Object.keys(knownValues).length
        }
      });
    }

    if (!cleanText(project?.name, 220)) {
      unresolved.push({
        step_id: 'project',
        placeholder_id: 'project_name',
        placeholder_key: 'project_name',
        display: 'project name',
        reason: 'Project could not be resolved from the request.'
      });
    }

    const notebook = buildProtocolNotebookPayload({
      selectedProtocol,
      project,
      placeholders,
      placeholderValuesMap: knownValues,
      missingPlaceholders: unresolved,
      message,
      fillSummary
    });
    const missingPlaceholders = asArray(notebook.unresolved_placeholders);
    const followUpQuestions = uniqueStrings([
      ...llmFollowUpQuestions,
      ...missingPlaceholders.map((row) => buildMissingPlaceholderQuestion(row))
    ], 10);
    const status = missingPlaceholders.length ? 'needs_more_info' : 'completed';

    return {
      status,
      placeholders,
      known_values: knownValues,
      missing_placeholders: missingPlaceholders,
      follow_up_questions: followUpQuestions,
      notebook,
      fill_summary: fillSummary
    };
  }

  return {
    PROTOCOL_TO_NOTEBOOK_FILL_SYSTEM_PROMPT,
    PROTOCOL_TO_NOTEBOOK_FILL_RULES,
    PROTOCOL_TO_NOTEBOOK_FILL_EXAMPLES,
    buildProtocolPlaceholderRows,
    inferDeterministicPlaceholderValue,
    normalizeNotebookFillPayload,
    buildProtocolPlaceholderToolQuery,
    maybeLookupProtocolPlaceholderToolContext,
    buildNotebookPlaceholderFillPrompt,
    requestNotebookPlaceholderFill,
    renderProtocolStepText,
    buildProtocolNotebookPayload,
    buildMissingPlaceholderQuestion,
    generateNotebook
  };
}

module.exports = {
  createNotebookGenerationRuntime
};
