module.exports = function registerPlatformAndRegressionSuite(context = {}) {
  const registerParts = [
    require('./platform-and-regression-suite/part-01.js'),
    require('./platform-and-regression-suite/part-02.js'),
    require('./platform-and-regression-suite/part-03.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
