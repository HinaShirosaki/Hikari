'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../lib/llm/runtime-helpers.js');
const {
  PROTOCOL_TO_NOTEBOOK_FILL_SYSTEM_PROMPT,
  PROTOCOL_TO_NOTEBOOK_FILL_RULES,
  PROTOCOL_TO_NOTEBOOK_FILL_EXAMPLES
} = require('./notebook-generation/prompts.js');
const { createPlaceholderHelpers } = require('./notebook-generation/placeholders.js');
const { createPlaceholderToolContext } = require('./notebook-generation/tool-context.js');
const { createNotebookPayloadBuilders } = require('./notebook-generation/payload.js');

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

  const {
    buildNotebookPlaceholderFillPrompt,
    buildProtocolPlaceholderRows,
    inferDeterministicPlaceholderValue,
    normalizeNotebookFillPayload
  } = createPlaceholderHelpers({ asArray, cleanText, uniqueStrings });

  const {
    buildProtocolPlaceholderToolQuery,
    maybeLookupProtocolPlaceholderToolContext,
    requestNotebookPlaceholderFill
  } = createPlaceholderToolContext({
    asArray,
    cleanText,
    uniqueStrings,
    recordAgentLlmTrace,
    recordLifecycleEvent,
    requestStructuredJsonPayload,
    runTool,
    buildNotebookPlaceholderFillPrompt
  });

  const {
    renderProtocolStepText,
    buildProtocolNotebookPayload,
    buildMissingPlaceholderQuestion
  } = createNotebookPayloadBuilders({ asArray, cleanText });

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
