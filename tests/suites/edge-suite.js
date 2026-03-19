module.exports = function registerEdgeSuite(context = {}) {
  const registerPlatformAndRegressionSuite = require('./edge/platform-and-regression-suite.js');
  const registerBioToolsAndGelSuite = require('./edge/bio-tools-and-gel-suite.js');

  registerPlatformAndRegressionSuite(context);
  registerBioToolsAndGelSuite(context);
};
