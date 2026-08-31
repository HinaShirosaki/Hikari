module.exports = function registerAgentContextMemoryAndRuntimeSuite(context = {}) {
  const registerParts = [
    require('./context-memory-and-runtime-suite/long-term-memory.js'),
    require('./context-memory-and-runtime-suite/chat-log-persistence.js'),
    require('./context-memory-and-runtime-suite/observability-lifecycle.js'),
    require('./context-memory-and-runtime-suite/chat-log-fallback-and-tool-smoke-test.js'),
    require('./context-memory-and-runtime-suite/python-sandbox-runtime.js'),
    require('./context-memory-and-runtime-suite/provider-bridge-and-web-search.js'),
    require('./context-memory-and-runtime-suite/tool-executor-registration.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
