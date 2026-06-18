import * as responseModule from './agent-chat/response.js';

export function collectAgentActivityRows(meta) {
  return responseModule.collectAgentActivityRows(meta);
}

export function summarizeInventoryLookup(lookup) {
  return responseModule.summarizeInventoryLookup(lookup);
}

export function summarizeRecordLookup(lookup) {
  return responseModule.summarizeRecordLookup(lookup);
}

export function summarizeScienceResult(payload) {
  return responseModule.summarizeScienceResult(payload);
}

export function summarizeNotebookDraft(payload) {
  return responseModule.summarizeNotebookDraft(payload);
}

export function summarizeProtocolGeneration(payload) {
  return responseModule.summarizeProtocolGeneration(payload);
}

export function summarizeCodexAgent(codexAgent) {
  return responseModule.summarizeCodexAgent(codexAgent);
}

export function normalizeAgentResponse(result) {
  return responseModule.normalizeAgentResponse(result);
}
