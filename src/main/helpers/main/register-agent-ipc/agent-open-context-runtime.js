'use strict';

function createAgentOpenContextRuntime({
  cleanText,
  observability,
  protocolNotebookRuntime,
  executeInventoryLookup,
  executeRecordLookup,
  getDefaultDataFilePath,
  agentChatLogRuntime
} = {}) {
  function buildEmptyInventorySearch() {
    return {
      normalized_query: null,
      candidate_terms: [],
      aliases: [],
      search_mode: null
    };
  }

  const GENERIC_FOLLOWUP_CONTINUATION_INTENTS = new Set([
    'general_science_question',
    'project_science_question',
    'result_analysis',
    'purchase_recommendation',
    'notebook_draft'
  ]);

  function normalizeStringList(values, {
    maxItems = 8,
    maxLength = 220
  } = {}) {
    const source = Array.isArray(values) ? values : [];
    const seen = new Set();
    const output = [];
    source.forEach((item) => {
      const normalized = cleanText(item, maxLength);
      if (!normalized || output.length >= maxItems) {
        return;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      output.push(normalized);
    });
    return output;
  }

  function normalizeEntityMap(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const output = {};
    Object.keys(value).forEach((key) => {
      const normalizedKey = cleanText(key, 80);
      const normalizedValue = cleanText(value[key], 240);
      if (!normalizedKey || !normalizedValue) {
        return;
      }
      output[normalizedKey] = normalizedValue;
    });
    return output;
  }

  function buildProtocolContinuationParserPayload({
    projectName = ''
  } = {}) {
    const normalizedProjectName = cleanText(projectName, 220);
    return {
      primary_intent: 'protocol_to_notebook',
      reasoning_effort: 0,
      direct_answer: null,
      needs_clarification: false,
      clarification_reason: null,
      entities: normalizedProjectName
        ? {
          project_name: normalizedProjectName
        }
        : {},
      inventory_search: buildEmptyInventorySearch(),
      protocol_candidates: [],
      reasoning_summary: 'Skipped intent parsing because the protocol-to-notebook context is still open.'
    };
  }

  function buildLookupContinuationParserPayload(intent = '') {
    const normalizedIntent = cleanText(intent, 80);
    return {
      primary_intent: normalizedIntent,
      reasoning_effort: 0,
      direct_answer: null,
      needs_clarification: false,
      clarification_reason: null,
      entities: {},
      inventory_search: buildEmptyInventorySearch(),
      protocol_candidates: [],
      reasoning_summary: `Skipped intent parsing because the ${normalizedIntent || 'lookup'} context is still open.`
    };
  }

  function buildGenericContinuationParserPayload(previousParser = {}) {
    const previousIntent = cleanText(previousParser?.primary_intent, 80);
    const reasoningEffort = ['general_science_question', 'project_science_question'].includes(previousIntent)
      ? (Number(previousParser?.reasoning_effort) === 2 ? 2 : 1)
      : 0;
    return {
      primary_intent: previousIntent,
      reasoning_effort: reasoningEffort,
      direct_answer: null,
      needs_clarification: false,
      clarification_reason: null,
      entities: normalizeEntityMap(previousParser?.entities),
      inventory_search: buildEmptyInventorySearch(),
      protocol_candidates: previousIntent === 'notebook_draft'
        ? normalizeStringList(previousParser?.protocol_candidates, { maxItems: 3, maxLength: 220 })
        : [],
      reasoning_summary: `Skipped intent parsing because the following question continues the previous ${previousIntent || 'agent'} intent.`
    };
  }

  function getParserProjectEntityName(parserPayload = {}) {
    return cleanText(
      parserPayload?.entities?.project_name || parserPayload?.entities?.project,
      220
    );
  }

  function findLastAssistantMeta(rows = []) {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index] && typeof rows[index] === 'object' ? rows[index] : null;
      if (!row || cleanText(row.type, 80) !== 'assistant-message') {
        continue;
      }
      if (row.meta && typeof row.meta === 'object') {
        return row.meta;
      }
    }
    return null;
  }

  function wasParserAlreadySkipped(previousParser = {}) {
    return /^Skipped intent parsing because /i.test(cleanText(previousParser?.reasoning_summary, 320));
  }

  async function resolveParserBypass({
    projectId = '',
    projectName = '',
    chatSessionId = '',
    chatSessionStoragePath = ''
  } = {}) {
    const sessionKey = typeof protocolNotebookRuntime?.buildSessionKey === 'function'
      ? protocolNotebookRuntime.buildSessionKey({
        projectId,
        projectName
      })
      : '';
    const hasPendingProtocolSession = Boolean(
      sessionKey
      && typeof protocolNotebookRuntime?.hasPendingSession === 'function'
      && protocolNotebookRuntime.hasPendingSession(sessionKey)
    );
    if (hasPendingProtocolSession) {
      return {
        ok: true,
        payload: buildProtocolContinuationParserPayload({
          projectName
        }),
        message: 'Skipped intent parser because the protocol-to-notebook context is still open.',
        meta: {
          skipped: true,
          resumed_from_pending: true
        }
      };
    }

    if (
      !cleanText(chatSessionId, 120)
      || !cleanText(chatSessionStoragePath, 2400)
      || typeof agentChatLogRuntime?.getSession !== 'function'
    ) {
      return null;
    }

    try {
      const sessionResult = await agentChatLogRuntime.getSession({
        storagePath: cleanText(chatSessionStoragePath, 2400),
        sessionId: cleanText(chatSessionId, 120),
        includeRows: true
      });
      if (sessionResult?.ok !== true) {
        return null;
      }
      const assistantMeta = findLastAssistantMeta(Array.isArray(sessionResult?.rows) ? sessionResult.rows : []);
      const previousIntent = cleanText(assistantMeta?.parser?.primary_intent, 80);
      const previousParser = assistantMeta?.parser && typeof assistantMeta.parser === 'object'
        ? assistantMeta.parser
        : {};
      if (
        previousIntent === 'inventory_lookup'
        && cleanText(assistantMeta?.inventory_lookup?.status, 40) === 'needs_more_info'
      ) {
        return {
          ok: true,
          payload: buildLookupContinuationParserPayload(previousIntent),
          message: 'Skipped intent parser because the inventory_lookup context is still open.',
          meta: {
            skipped: true,
            resumed_from_pending: false
          }
        };
      }
      if (
        previousIntent === 'record_lookup'
        && cleanText(assistantMeta?.record_lookup?.status, 40) === 'needs_more_info'
      ) {
        return {
          ok: true,
          payload: buildLookupContinuationParserPayload(previousIntent),
          message: 'Skipped intent parser because the record_lookup context is still open.',
          meta: {
            skipped: true,
            resumed_from_pending: false
          }
        };
      }
      if (
        GENERIC_FOLLOWUP_CONTINUATION_INTENTS.has(previousIntent)
        && wasParserAlreadySkipped(previousParser) === false
      ) {
        return {
          ok: true,
          payload: buildGenericContinuationParserPayload(previousParser),
          message: `Skipped intent parser because the following question continues the previous ${previousIntent} intent.`,
          meta: {
            skipped: true,
            resumed_from_pending: false
          }
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  async function dispatchOpenContextIntent({
    context,
    result
  } = {}) {
    const {
      provider,
      endpoint,
      apiKey,
      model,
      message,
      promptConversation,
      snapshot,
      projectId,
      projectName,
      parserPayload,
      traceContext,
      lifecycleRecorder
    } = context && typeof context === 'object' ? context : {};

    const sessionKey = typeof protocolNotebookRuntime?.buildSessionKey === 'function'
      ? protocolNotebookRuntime.buildSessionKey({
        projectId,
        projectName,
        parserPayload
      })
      : '';
    const hasPendingProtocolSession = Boolean(
      sessionKey
      && typeof protocolNotebookRuntime?.hasPendingSession === 'function'
      && protocolNotebookRuntime.hasPendingSession(sessionKey)
    );

    if (cleanText(parserPayload?.primary_intent, 80) === 'protocol_to_notebook') {
      let protocolNotebookResult;
      if (parserPayload?.needs_clarification === true) {
        const clarificationQuestion = cleanText(parserPayload?.clarification_reason, 280)
          || 'Please provide more detail so I can match the protocol and fill the notebook placeholders.';
        protocolNotebookResult = {
          status: 'needs_more_info',
          candidate_matches: [],
          selected_protocol: null,
          missing_placeholders: [],
          follow_up_questions: [clarificationQuestion],
          project_name: cleanText(projectName || getParserProjectEntityName(parserPayload), 220),
          notebook: null
        };
        if (typeof protocolNotebookRuntime?.setPendingSession === 'function' && sessionKey) {
          protocolNotebookRuntime.setPendingSession(sessionKey, {
            created_at: new Date().toISOString(),
            selected_protocol: null,
            project: {
              id: projectId,
              name: cleanText(projectName || getParserProjectEntityName(parserPayload), 220),
              resolution_source: 'clarification'
            },
            candidate_matches: [],
            known_values: {},
            missing_placeholders: [],
            follow_up_questions: [clarificationQuestion]
          });
        }
      } else {
        protocolNotebookResult = await protocolNotebookRuntime.runFlow({
          provider,
          endpoint,
          apiKey,
          model,
          message,
          conversation: promptConversation,
          snapshot,
          parserPayload,
          projectId,
          projectName,
          traceContext,
          lifecycleRecorder
        });
      }

      result.protocol_to_notebook = protocolNotebookResult;
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'protocol_to_notebook_completed',
        status: cleanText(protocolNotebookResult?.status, 40) === 'completed' ? 'ok' : 'pending',
        routing_intent: 'protocol_to_notebook',
        message: `Protocol-to-notebook status=${cleanText(protocolNotebookResult?.status, 40) || 'unknown'}.`,
        meta: {
          selected_protocol_id: cleanText(protocolNotebookResult?.selected_protocol?.id, 120),
          missing_placeholder_count: Array.isArray(protocolNotebookResult?.missing_placeholders)
            ? protocolNotebookResult.missing_placeholders.length
            : 0
        }
      });
      return true;
    }

    if (hasPendingProtocolSession) {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'protocol_to_notebook_followup',
        status: 'ok',
        routing_intent: cleanText(parserPayload?.primary_intent, 80) || 'unclear',
        message: 'Continuing protocol-to-notebook session using follow-up message context.'
      });
      const protocolNotebookResult = await protocolNotebookRuntime.runFlow({
        provider,
        endpoint,
        apiKey,
        model,
        message,
        conversation: promptConversation,
        snapshot,
        parserPayload,
        projectId,
        projectName,
        traceContext,
        lifecycleRecorder
      });
      result.protocol_to_notebook = protocolNotebookResult;
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'protocol_to_notebook_completed',
        status: cleanText(protocolNotebookResult?.status, 40) === 'completed' ? 'ok' : 'pending',
        routing_intent: 'protocol_to_notebook',
        message: `Protocol-to-notebook status=${cleanText(protocolNotebookResult?.status, 40) || 'unknown'}.`,
        meta: {
          selected_protocol_id: cleanText(protocolNotebookResult?.selected_protocol?.id, 120),
          missing_placeholder_count: Array.isArray(protocolNotebookResult?.missing_placeholders)
            ? protocolNotebookResult.missing_placeholders.length
            : 0,
          resumed_from_pending: true
        }
      });
      return true;
    }

    if (sessionKey && typeof protocolNotebookRuntime?.clearPendingSession === 'function') {
      protocolNotebookRuntime.clearPendingSession(sessionKey);
    }

    if (cleanText(parserPayload?.primary_intent, 80) === 'inventory_lookup') {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'inventory_lookup_started',
        status: 'started',
        routing_intent: 'inventory_lookup',
        message: 'Executing inventory lookup runtime.'
      });
      if (parserPayload?.needs_clarification === true) {
        result.inventory_lookup = {
          status: 'needs_more_info',
          query: '',
          terms_used: [],
          source: 'parser_only',
          backfilled_sql: false,
          items: [],
          follow_up_questions: [
            cleanText(parserPayload?.clarification_reason, 280)
              || 'Please provide the sample/reagent name so I can run inventory lookup.'
          ]
        };
      } else {
        const inventoryLookupResult = await executeInventoryLookup({
          message,
          parserPayload,
          snapshot,
          dataFilePath: cleanText(snapshot?.data_file_path, 1600),
          fallbackDataFilePath: getDefaultDataFilePath(),
          limit: 8
        });
        result.inventory_lookup = inventoryLookupResult;
        if (inventoryLookupResult?.backfilled_sql === true) {
          observability.recordLifecycleEvent(lifecycleRecorder, {
            stage: 'inventory_lookup_backfilled',
            status: 'ok',
            routing_intent: 'inventory_lookup',
            message: 'SQLite inventory index was backfilled from hydrated snapshot.'
          });
        }
      }
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'inventory_lookup_completed',
        status: cleanText(result?.inventory_lookup?.status, 40) === 'matched' ? 'ok' : 'pending',
        routing_intent: 'inventory_lookup',
        message: `Inventory lookup status=${cleanText(result?.inventory_lookup?.status, 40) || 'unknown'}.`,
        meta: {
          source: cleanText(result?.inventory_lookup?.source, 80),
          item_count: Array.isArray(result?.inventory_lookup?.items) ? result.inventory_lookup.items.length : 0,
          backfilled_sql: result?.inventory_lookup?.backfilled_sql === true
        }
      });
      return true;
    }

    if (cleanText(parserPayload?.primary_intent, 80) === 'record_lookup') {
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'record_lookup_started',
        status: 'started',
        routing_intent: 'record_lookup',
        message: 'Executing project record lookup runtime.'
      });
      if (parserPayload?.needs_clarification === true) {
        result.record_lookup = {
          status: 'needs_more_info',
          query: '',
          source: 'parser_only',
          backfilled_sql: false,
          items: [],
          follow_up_questions: [
            cleanText(parserPayload?.clarification_reason, 280)
              || 'Please provide what record you want to search (project/protocol/notebook/assay/gel).'
          ]
        };
      } else {
        const recordLookupResult = await executeRecordLookup({
          message,
          parserPayload,
          snapshot,
          dataFilePath: cleanText(snapshot?.data_file_path, 1600),
          fallbackDataFilePath: getDefaultDataFilePath(),
          limit: 8
        });
        result.record_lookup = recordLookupResult;
        if (recordLookupResult?.backfilled_sql === true) {
          observability.recordLifecycleEvent(lifecycleRecorder, {
            stage: 'record_lookup_backfilled',
            status: 'ok',
            routing_intent: 'record_lookup',
            message: 'SQLite record index was backfilled from hydrated snapshot.'
          });
        }
      }
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'record_lookup_completed',
        status: cleanText(result?.record_lookup?.status, 40) === 'matched' ? 'ok' : 'pending',
        routing_intent: 'record_lookup',
        message: `Record lookup status=${cleanText(result?.record_lookup?.status, 40) || 'unknown'}.`,
        meta: {
          source: cleanText(result?.record_lookup?.source, 80),
          item_count: Array.isArray(result?.record_lookup?.items) ? result.record_lookup.items.length : 0,
          backfilled_sql: result?.record_lookup?.backfilled_sql === true
        }
      });
      return true;
    }

    return false;
  }

  return {
    resolveParserBypass,
    dispatchOpenContextIntent
  };
}

module.exports = {
  createAgentOpenContextRuntime
};
