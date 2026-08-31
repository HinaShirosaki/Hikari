module.exports = function registerBioToolsAndGelSuite(context = {}) {
  const registerEdgeSequenceViewerFoundationsSuite = require('./bio-tools-and-gel-suite/sequence-viewer-foundations-suite.js');
  const registerEdgeSequenceViewerWorkspaceSuite = require('./bio-tools-and-gel-suite/sequence-viewer-workspace-suite.js');
  const registerEdgeSequenceViewerInteractionsSuite = require('./bio-tools-and-gel-suite/sequence-viewer-interactions-suite.js');
  const registerEdgeToolBoxSuite = require('./bio-tools-and-gel-suite/tool-box-suite.js');
  const registerEdgeGelAnalysisSuite = require('./bio-tools-and-gel-suite/gel-analysis-suite.js');
  const registerEdgeCloningAssemblySuite = require('./bio-tools-and-gel-suite/cloning-assembly-suite.js');

  registerEdgeSequenceViewerFoundationsSuite(context);
  registerEdgeSequenceViewerWorkspaceSuite(context);
  registerEdgeSequenceViewerInteractionsSuite(context);
  registerEdgeToolBoxSuite(context);
  registerEdgeGelAnalysisSuite(context);
  registerEdgeCloningAssemblySuite(context);
};
