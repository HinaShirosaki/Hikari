module.exports = function registerAgentScienceAndProtocolSuite(context = {}) {
  const registerRoutePlanningSuite = require('./route-planning-suite.js');
  const registerSynthesisAndVerificationSuite = require('./synthesis-and-verification-suite.js');
  const registerPromptAndFallbackSuite = require('./prompt-and-fallback-suite.js');
  const registerJudgeAndTraceSuite = require('./judge-and-trace-suite.js');
  const registerLoopRuntimeCoreSuite = require('./loop-runtime-core-suite.js');
  const registerLoopRuntimeFollowupSuite = require('./loop-runtime-followup-suite.js');
  const registerLoopRuntimeEdgeAndProtocolSuite = require('./loop-runtime-edge-and-protocol-suite.js');

  registerRoutePlanningSuite(context);
  registerSynthesisAndVerificationSuite(context);
  registerPromptAndFallbackSuite(context);
  registerJudgeAndTraceSuite(context);
  registerLoopRuntimeCoreSuite(context);
  registerLoopRuntimeFollowupSuite(context);
  registerLoopRuntimeEdgeAndProtocolSuite(context);
};
