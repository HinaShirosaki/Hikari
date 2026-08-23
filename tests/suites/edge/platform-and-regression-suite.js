module.exports = function registerPlatformAndRegressionSuite(context = {}) {
  const registerParts = [
    require('./platform-and-regression-suite/state-normalization.js'),
    require('./platform-and-regression-suite/module-boundary-guards.js'),
    require('./platform-and-regression-suite/data-file-path-normalization.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
