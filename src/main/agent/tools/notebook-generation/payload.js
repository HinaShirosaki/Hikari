'use strict';

const { PROTOCOL_PLACEHOLDER_TOKEN_REGEX } = require('./prompts.js');

// Renders the filled protocol into the notebook payload the renderer saves.
function createNotebookPayloadBuilders({
  asArray,
  cleanText
} = {}) {
  function renderProtocolStepText(step, values) {
    const source = cleanText(step?.text, 6000);
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
        const value = cleanText(values?.[placeholder.id], 260);
        return value || `[${placeholder.name}]`;
      }).join(' ');
      return `${source} ${trailingValues}`.trim();
    }

    let cursor = 0;
    let text = '';
    matches.forEach((match) => {
      const index = Number(match?.index || 0);
      const placeholderId = cleanText(match?.[1], 120);
      const placeholder = placeholders.find((item) => item.id === placeholderId);
      const value = cleanText(values?.[placeholderId], 260);
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
        placeholder_key: key,
        display: cleanText(placeholder?.display, 120) || 'value',
        value,
        source: 'resolved',
        source_type: 'agent_protocol_v2'
      });
    });
    const unresolvedRows = asArray(missingPlaceholders).map((row) => ({
      placeholder_key: cleanText(row?.placeholder_key, 160),
      display: cleanText(row?.display, 120) || 'value',
      reason: cleanText(row?.reason, 220) || 'Missing information from user request.'
    })).filter((row) => row.placeholder_key);

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
        protocolSnapshot: JSON.parse(JSON.stringify(selectedProtocol)),
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

  return {
    renderProtocolStepText,
    buildProtocolNotebookPayload,
    buildMissingPlaceholderQuestion
  };
}

module.exports = { createNotebookPayloadBuilders };
