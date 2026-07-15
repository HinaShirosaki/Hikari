module.exports = function registerAgentScienceAndProtocolSuite(context = {}) {
  const registerLoopRuntimeEdgeAndProtocolSuite = require('./loop-runtime-edge-and-protocol-suite.js');

  registerLoopRuntimeEdgeAndProtocolSuite(context);
};
