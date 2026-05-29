'use strict';

const {
  getCodexJsonEventDescriptor,
  isCodexThinkingEvent,
  isCodexToolEvent
} = require('./event-descriptor');
const { collectTextFromCodexEventValue } = require('./event-values');
const { cleanText } = require('./utils');

function extractCodexJsonEventText(event = {}) {
  const descriptor = getCodexJsonEventDescriptor(event);
  const source = descriptor.source;
  const { item, message, type, phase, outerType } = descriptor;
  const eventType = phase ? `${type}:${phase}` : type;
  if (type === 'codex_cli_output') {
    return null;
  }
  const role = cleanText(source.role || message.role || item.role, 80).toLowerCase();
  if (type === 'user_message' || type === 'input_message' || type === 'user' || role === 'user') {
    return null;
  }
  if (isCodexThinkingEvent(event) || isCodexToolEvent(event)) {
    return null;
  }
  if (type === 'agent_message' && phase && phase !== 'final_answer') {
    return null;
  }
  const looksAssistant = !role || role === 'assistant' || role === 'agent';
  if (!looksAssistant) {
    return null;
  }

  const directDelta = source.delta
    || source.text_delta
    || source.textDelta
    || source.output_text_delta
    || source.outputTextDelta
    || source.message_delta
    || source.messageDelta
    || source.token;
  if (typeof directDelta === 'string' && directDelta) {
    return {
      deltaText: directDelta,
      fullText: '',
      eventType
    };
  }

  const deltaText = collectTextFromCodexEventValue(source.delta?.content || source.delta?.parts, 120000);
  if (deltaText) {
    return {
      deltaText,
      fullText: '',
      eventType
    };
  }

  const fullText = collectTextFromCodexEventValue(
    source.text
      || source.output_text
      || source.outputText
      || message.content
      || message.text
      || source.message
      || item.content
      || item.text
      || source.content
      || source.output,
    120000
  );
  if (fullText && (/message|assistant|agent|output|response/.test(type) || role || phase === 'final_answer' || outerType === 'response_item')) {
    return {
      deltaText: '',
      fullText,
      eventType
    };
  }
  return null;
}

module.exports = {
  extractCodexJsonEventText
};
