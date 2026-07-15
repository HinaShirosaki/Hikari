module.exports = function registerAgentScienceAndProtocolSuite(context = {}) {
  // The self-agent science-reasoning-loop suites were removed when /self-agent was
  // isolated; only the src-backed protocol-generation and runtime-support tests remain.
  const registerPromptAndFallbackSuite = require('./prompt-and-fallback-suite.js');
  const registerLoopRuntimeEdgeAndProtocolSuite = require('./loop-runtime-edge-and-protocol-suite.js');

  registerPromptAndFallbackSuite(context);
  registerLoopRuntimeEdgeAndProtocolSuite(context);
};
