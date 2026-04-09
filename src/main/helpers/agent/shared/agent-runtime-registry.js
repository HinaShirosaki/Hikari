'use strict';

function defaultCleanText(value, _maxLength = 120) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text;
}

function createAgentRuntimeRegistry(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : defaultCleanText;
  const runtimeFactories = new Map();

  function normalizeRuntimeName(runtimeName) {
    return cleanText(runtimeName, 120).toLowerCase();
  }

  function registerRuntimeFactory(runtimeName, factory) {
    const key = normalizeRuntimeName(runtimeName);
    if (!key || typeof factory !== 'function') {
      return false;
    }
    runtimeFactories.set(key, factory);
    return true;
  }

  function unregisterRuntimeFactory(runtimeName) {
    const key = normalizeRuntimeName(runtimeName);
    if (!key) {
      return false;
    }
    return runtimeFactories.delete(key);
  }

  function getRuntimeFactory(runtimeName) {
    const key = normalizeRuntimeName(runtimeName);
    return key ? (runtimeFactories.get(key) || null) : null;
  }

  function hasRuntimeFactory(runtimeName) {
    return Boolean(getRuntimeFactory(runtimeName));
  }

  return {
    registerRuntimeFactory,
    unregisterRuntimeFactory,
    getRuntimeFactory,
    hasRuntimeFactory
  };
}

function resolveAgentRuntimeFactory(deps = {}, runtimeName = '') {
  const directGetter = typeof deps.getAgentRuntimeFactory === 'function'
    ? deps.getAgentRuntimeFactory
    : null;
  if (directGetter) {
    const resolved = directGetter(runtimeName);
    if (typeof resolved === 'function') {
      return resolved;
    }
  }

  const registry = deps.runtimeRegistry && typeof deps.runtimeRegistry === 'object'
    ? deps.runtimeRegistry
    : null;
  if (registry && typeof registry.getRuntimeFactory === 'function') {
    const resolved = registry.getRuntimeFactory(runtimeName);
    if (typeof resolved === 'function') {
      return resolved;
    }
  }

  return null;
}

module.exports = {
  createAgentRuntimeRegistry,
  resolveAgentRuntimeFactory
};
