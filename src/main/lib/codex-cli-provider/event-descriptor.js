'use strict';

const { cleanText } = require('./utils');

function isCodexEventObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getCodexJsonEventSource(event = {}) {
  const source = isCodexEventObject(event) ? event : {};
  const outerType = cleanText(source.type || source.event || source.kind, 120).toLowerCase();
  const payload = isCodexEventObject(source.payload) ? source.payload : null;
  if ((outerType === 'event_msg' || outerType === 'response_item') && payload) {
    return {
      outerType,
      source: payload,
      envelope: source
    };
  }
  return {
    outerType: '',
    source,
    envelope: source
  };
}

function getCodexJsonEventDescriptor(source = {}) {
  const normalized = getCodexJsonEventSource(source);
  const eventSource = normalized.source;
  const envelope = normalized.envelope;
  const item = isCodexEventObject(eventSource.item) ? eventSource.item : {};
  const invocation = isCodexEventObject(eventSource.invocation) ? eventSource.invocation : {};
  const message = isCodexEventObject(eventSource.message) ? eventSource.message : {};
  const call = isCodexEventObject(eventSource.call) ? eventSource.call : {};
  const response = isCodexEventObject(eventSource.response) ? eventSource.response : {};
  const type = cleanText(eventSource.type || eventSource.event || eventSource.kind, 120).toLowerCase();
  const itemType = cleanText(item.type || eventSource.item_type || eventSource.itemType || message.type || call.type || response.type, 120).toLowerCase();
  const name = cleanText(
    eventSource.name
      || eventSource.tool_name
      || eventSource.toolName
      || invocation.tool
      || invocation.name
      || item.name
      || item.tool_name
      || call.name,
    160
  ).toLowerCase();
  const phase = cleanText(eventSource.phase || envelope.phase || item.phase || message.phase, 80).toLowerCase();
  const outerType = cleanText(normalized.outerType, 120).toLowerCase();
  const combined = [type, itemType, name, phase, outerType].filter(Boolean).join(' ');
  return { source: eventSource, envelope, outerType, item, invocation, message, call, response, type, itemType, name, phase, combined };
}

function isCodexThinkingEvent(source = {}) {
  const { type, phase, combined } = getCodexJsonEventDescriptor(source);
  if (type === 'agent_message' && phase && phase !== 'final_answer') {
    return true;
  }
  return /reasoning|thinking|thought/u.test(combined);
}

function isCodexToolEvent(source = {}) {
  const { combined } = getCodexJsonEventDescriptor(source);
  return /tool|function_call|function-call|mcp|exec|command|shell|local_shell/u.test(combined);
}

module.exports = {
  getCodexJsonEventDescriptor,
  getCodexJsonEventSource,
  isCodexEventObject,
  isCodexThinkingEvent,
  isCodexToolEvent
};
