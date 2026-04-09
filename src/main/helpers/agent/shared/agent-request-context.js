'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const REQUEST_ABORTED_CODE = 'AGENT_REQUEST_ABORTED';
const requestContextStorage = new AsyncLocalStorage();

function cleanText(value, _maxLength = 400) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text;
}

function createAgentRequestAbortError(message = 'Agent request stopped.') {
  const error = new Error(cleanText(message, 600) || 'Agent request stopped.');
  error.name = 'AbortError';
  error.code = REQUEST_ABORTED_CODE;
  return error;
}

function getAgentRequestContext() {
  return requestContextStorage.getStore() || null;
}

function getAgentRequestAbortSignal() {
  return getAgentRequestContext()?.abortSignal || null;
}

function getAgentRequestAbortReason(message = 'Agent request stopped.') {
  const signal = getAgentRequestAbortSignal();
  if (!signal?.aborted) {
    return null;
  }
  const reason = signal.reason;
  if (reason instanceof Error) {
    if (!reason.code) {
      reason.code = REQUEST_ABORTED_CODE;
    }
    if (!reason.name) {
      reason.name = 'AbortError';
    }
    return reason;
  }
  return createAgentRequestAbortError(reason || message);
}

function isAgentRequestAbortError(error) {
  if (!error) {
    return false;
  }
  return error.code === REQUEST_ABORTED_CODE
    || error.name === 'AbortError'
    || /agent request stopped|request aborted/i.test(String(error.message || ''));
}

function throwIfAgentRequestAborted(message = 'Agent request stopped.') {
  const reason = getAgentRequestAbortReason(message);
  if (reason) {
    throw reason;
  }
}

function onAgentRequestAbort(handler) {
  if (typeof handler !== 'function') {
    return () => {};
  }
  const signal = getAgentRequestAbortSignal();
  if (!signal) {
    return () => {};
  }
  if (signal.aborted) {
    handler(getAgentRequestAbortReason());
    return () => {};
  }
  const listener = () => {
    handler(getAgentRequestAbortReason());
  };
  signal.addEventListener('abort', listener, { once: true });
  return () => {
    signal.removeEventListener('abort', listener);
  };
}

function runWithAgentRequestContext(context = {}, fn = async () => {}) {
  const normalizedContext = context && typeof context === 'object' ? context : {};
  return requestContextStorage.run(normalizedContext, fn);
}

module.exports = {
  REQUEST_ABORTED_CODE,
  createAgentRequestAbortError,
  getAgentRequestAbortReason,
  getAgentRequestAbortSignal,
  getAgentRequestContext,
  isAgentRequestAbortError,
  onAgentRequestAbort,
  runWithAgentRequestContext,
  throwIfAgentRequestAborted
};
