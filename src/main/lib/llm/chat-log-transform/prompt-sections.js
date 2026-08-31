'use strict';

const path = require('node:path');
const { asArray, cloneJson } = require('../../normalize.js');
const { CONTEXT_SECTION_MARKERS } = require('./constants.js');
const { defaultCleanText, escapeRegex, formatPayload } = require('./normalizing.js');

function buildFallbackContext(requestContext) {
  const source = requestContext && typeof requestContext === 'object' ? requestContext : {};
  const lines = [];
  const message = defaultCleanText(source.message);
  const conversation = asArray(source.conversation);
  if (message) {
    lines.push(`User message:\n${message}`);
  }
  if (conversation.length) {
    lines.push(`Conversation:\n${JSON.stringify(conversation, null, 2)}`);
  }
  return lines.join('\n\n');
}

function splitCombinedPrompt(prompt = '') {
  const rawPrompt = defaultCleanText(prompt);
  if (!rawPrompt) {
    return {
      systemPrompt: '',
      context: ''
    };
  }

  let markerIndex = -1;
  CONTEXT_SECTION_MARKERS.forEach((marker) => {
    const match = new RegExp(`(?:\\n\\n|\\n|^)${escapeRegex(marker)}`, 'i').exec(rawPrompt);
    if (!match) {
      return;
    }
    const startIndex = match.index + match[0].length - marker.length;
    if (markerIndex === -1 || startIndex < markerIndex) {
      markerIndex = startIndex;
    }
  });

  if (markerIndex <= 0) {
    return {
      systemPrompt: rawPrompt.trim(),
      context: ''
    };
  }

  return {
    systemPrompt: rawPrompt.slice(0, markerIndex).trim(),
    context: rawPrompt.slice(markerIndex).trim()
  };
}

function extractPromptSections(requestPayload, requestContext) {
  const payload = requestPayload && typeof requestPayload === 'object'
    ? requestPayload
    : {};
  const sections = [];
  let systemPrompt = defaultCleanText(payload.system_prompt || payload.systemPrompt);

  if (Array.isArray(payload.conversation) && payload.conversation.length) {
    sections.push(`Conversation:\n${JSON.stringify(payload.conversation, null, 2)}`);
  }
  if (Array.isArray(payload.tool_outputs) && payload.tool_outputs.length) {
    sections.push(`Tool outputs:\n${JSON.stringify(payload.tool_outputs, null, 2)}`);
  }

  const fieldMap = [
    ['user_prompt', 'User prompt'],
    ['userPrompt', 'User prompt'],
    ['message', 'Message'],
    ['feedback_message', 'Feedback message'],
    ['feedbackMessage', 'Feedback message']
  ];
  fieldMap.forEach(([fieldName, label]) => {
    const value = defaultCleanText(payload[fieldName]);
    if (value) {
      sections.push(`${label}:\n${value}`);
    }
  });

  if (payload.attachment && typeof payload.attachment === 'object') {
    sections.push(`Attachment:\n${JSON.stringify(payload.attachment, null, 2)}`);
  }

  if (!systemPrompt) {
    const combinedPrompt = defaultCleanText(payload.prompt);
    if (combinedPrompt) {
      const split = splitCombinedPrompt(combinedPrompt);
      systemPrompt = split.systemPrompt;
      if (split.context) {
        sections.push(split.context);
      }
    }
  }

  if (!systemPrompt && defaultCleanText(payload.prompt)) {
    systemPrompt = defaultCleanText(payload.prompt);
  }

  if (!sections.length) {
    const fallbackContext = buildFallbackContext(requestContext);
    if (fallbackContext) {
      sections.push(fallbackContext);
    }
  }

  return {
    systemPrompt,
    context: sections.filter(Boolean).join('\n\n')
  };
}

function buildRequestContextMap(rows = []) {
  const byRequestId = new Map();
  asArray(rows).forEach((row) => {
    if (!row || typeof row !== 'object' || row.type !== 'agent-chat-request') {
      return;
    }
    const requestId = defaultCleanText(row.requestId);
    if (!requestId) {
      return;
    }
    byRequestId.set(requestId, {
      message: defaultCleanText(row.message),
      conversation: Array.isArray(row.conversation) ? cloneJson(row.conversation, []) : []
    });
  });
  return byRequestId;
}

function transformTraceRow(row, requestContextById) {
  const source = row && typeof row === 'object' ? row : {};
  const requestId = defaultCleanText(source.requestId);
  const requestContext = requestContextById.get(requestId) || null;
  const promptSections = extractPromptSections(source.request_payload, requestContext);
  return {
    stage: defaultCleanText(source.stage),
    request_id: requestId,
    timestamp: defaultCleanText(source.timestamp),
    system_prompt: promptSections.systemPrompt,
    context: promptSections.context,
    response: formatPayload(source.response_payload)
  };
}

function normalizeStoragePath(storagePath = '') {
  const clean = defaultCleanText(storagePath);
  return clean ? path.resolve(clean) : '';
}

module.exports = {
  buildRequestContextMap,
  normalizeStoragePath,
  transformTraceRow
};
