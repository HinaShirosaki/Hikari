'use strict';

const SERVICE_POLICIES = Object.freeze({
  REQUIRED: 'required',
  BEST_EFFORT: 'best-effort'
});

function normalizeServiceDefinition(definition, index) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError(`Main service definition at index ${index} must be an object.`);
  }
  const key = String(definition.key || '').trim();
  if (!key) {
    throw new Error(`Main service definition at index ${index} is missing a key.`);
  }
  if (typeof definition.create !== 'function') {
    throw new Error(`Main service "${key}" must define create().`);
  }
  const dependsOn = Array.isArray(definition.dependsOn)
    ? definition.dependsOn.map((dependency) => String(dependency || '').trim()).filter(Boolean)
    : [];
  const policy = definition.policy === SERVICE_POLICIES.BEST_EFFORT
    ? SERVICE_POLICIES.BEST_EFFORT
    : SERVICE_POLICIES.REQUIRED;
  return {
    ...definition,
    key,
    dependsOn,
    policy
  };
}

function orderServiceDefinitions(definitions = []) {
  const normalized = definitions.map(normalizeServiceDefinition);
  const byKey = new Map();
  normalized.forEach((definition) => {
    if (byKey.has(definition.key)) {
      throw new Error(`Duplicate main service key: "${definition.key}".`);
    }
    byKey.set(definition.key, definition);
  });
  normalized.forEach((definition) => {
    definition.dependsOn.forEach((dependencyKey) => {
      if (!byKey.has(dependencyKey)) {
        throw new Error(
          `Main service "${definition.key}" depends on missing service "${dependencyKey}".`
        );
      }
    });
  });

  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(definition, trail = []) {
    if (visited.has(definition.key)) {
      return;
    }
    if (visiting.has(definition.key)) {
      const cycleStart = trail.indexOf(definition.key);
      const cycle = [
        ...trail.slice(cycleStart >= 0 ? cycleStart : 0),
        definition.key
      ];
      throw new Error(`Main service dependency cycle: ${cycle.join(' -> ')}.`);
    }
    visiting.add(definition.key);
    const nextTrail = [...trail, definition.key];
    definition.dependsOn.forEach((dependencyKey) => {
      visit(byKey.get(dependencyKey), nextTrail);
    });
    visiting.delete(definition.key);
    visited.add(definition.key);
    ordered.push(definition);
  }

  normalized.forEach((definition) => visit(definition));
  return ordered;
}

function serializeServiceError(error) {
  return {
    name: String(error?.name || 'Error'),
    message: String(error?.message || error || 'Unknown service lifecycle error.')
  };
}

function createMainServiceLifecycle({
  definitions = [],
  context = {}
} = {}) {
  const orderedDefinitions = orderServiceDefinitions(definitions);
  const services = new Map();
  const states = new Map();
  let ipcRegistered = false;
  let startPromise = null;
  let startResults = null;
  let stopPromise = null;

  function getService(key) {
    return services.get(String(key || '').trim()) || null;
  }

  function getDependencies(definition) {
    return Object.fromEntries(
      definition.dependsOn.map((dependencyKey) => [dependencyKey, getService(dependencyKey)])
    );
  }

  orderedDefinitions.forEach((definition) => {
    let service;
    try {
      service = definition.create({
        context,
        dependencies: getDependencies(definition),
        getService
      });
    } catch (error) {
      const wrapped = new Error(
        `Failed to construct main service "${definition.key}": ${error?.message || error}`
      );
      wrapped.cause = error;
      throw wrapped;
    }
    if (service && typeof service.then === 'function') {
      throw new Error(
        `Main service "${definition.key}" create() must be synchronous; use start() for async work.`
      );
    }
    services.set(definition.key, service ?? {});
    states.set(definition.key, {
      key: definition.key,
      dependsOn: [...definition.dependsOn],
      policy: definition.policy,
      ipc: 'pending',
      startup: 'pending',
      shutdown: 'pending'
    });
  });

  function buildHookContext(definition) {
    return {
      context,
      dependencies: getDependencies(definition),
      getService,
      service: getService(definition.key)
    };
  }

  function registerIpcHandlers() {
    if (ipcRegistered) {
      return listServices();
    }
    orderedDefinitions.forEach((definition) => {
      const state = states.get(definition.key);
      if (state.ipc === 'registered' || state.ipc === 'not-applicable') {
        return;
      }
      if (typeof definition.registerIpc !== 'function') {
        state.ipc = 'not-applicable';
        return;
      }
      try {
        definition.registerIpc(buildHookContext(definition));
        state.ipc = 'registered';
      } catch (error) {
        state.ipc = 'failed';
        state.ipcError = serializeServiceError(error);
        const wrapped = new Error(
          `Failed to register IPC for main service "${definition.key}": ${error?.message || error}`
        );
        wrapped.cause = error;
        throw wrapped;
      }
    });
    ipcRegistered = true;
    return listServices();
  }

  async function startServices() {
    if (startResults) {
      return startResults;
    }
    if (startPromise) {
      return startPromise;
    }
    startPromise = (async () => {
      const results = [];
      for (const definition of orderedDefinitions) {
        const state = states.get(definition.key);
        if (state.startup === 'started' || state.startup === 'not-applicable') {
          results.push({
            key: definition.key,
            ok: true,
            status: state.startup
          });
          continue;
        }
        if (typeof definition.start !== 'function') {
          state.startup = 'not-applicable';
          results.push({ key: definition.key, ok: true, status: state.startup });
          continue;
        }
        try {
          const value = await definition.start(buildHookContext(definition));
          state.startup = 'started';
          results.push({
            key: definition.key,
            ok: true,
            status: state.startup,
            value
          });
        } catch (error) {
          state.startup = 'failed';
          state.startupError = serializeServiceError(error);
          const result = {
            key: definition.key,
            ok: false,
            status: state.startup,
            policy: definition.policy,
            error: state.startupError
          };
          results.push(result);
          if (definition.policy === SERVICE_POLICIES.REQUIRED) {
            const wrapped = new Error(
              `Failed to start required main service "${definition.key}": ${error?.message || error}`
            );
            wrapped.cause = error;
            wrapped.serviceResults = results;
            throw wrapped;
          }
        }
      }
      startResults = results;
      return results;
    })();
    try {
      return await startPromise;
    } finally {
      if (!startResults) {
        startPromise = null;
      }
    }
  }

  async function stopServices() {
    if (stopPromise) {
      return stopPromise;
    }
    stopPromise = (async () => {
      const results = [];
      const errors = [];
      for (const definition of [...orderedDefinitions].reverse()) {
        const state = states.get(definition.key);
        if (typeof definition.stop !== 'function') {
          state.shutdown = 'not-applicable';
          results.push({ key: definition.key, ok: true, status: state.shutdown });
          continue;
        }
        try {
          const value = await definition.stop(buildHookContext(definition));
          state.shutdown = 'stopped';
          results.push({
            key: definition.key,
            ok: true,
            status: state.shutdown,
            value
          });
        } catch (error) {
          state.shutdown = 'failed';
          state.shutdownError = serializeServiceError(error);
          results.push({
            key: definition.key,
            ok: false,
            status: state.shutdown,
            error: state.shutdownError
          });
          errors.push({ definition, error });
        }
      }
      if (errors.length) {
        const first = errors[0];
        const wrapped = new Error(
          `Failed to stop main service "${first.definition.key}": ${first.error?.message || first.error}`
        );
        wrapped.cause = first.error;
        wrapped.serviceResults = results;
        throw wrapped;
      }
      return results;
    })();
    return stopPromise;
  }

  function listServices() {
    return orderedDefinitions.map((definition) => ({
      ...states.get(definition.key)
    }));
  }

  return {
    getService,
    listServices,
    registerIpcHandlers,
    startServices,
    stopServices
  };
}

module.exports = {
  SERVICE_POLICIES,
  createMainServiceLifecycle,
  orderServiceDefinitions
};
