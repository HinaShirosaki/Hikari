module.exports = function registerLoopRuntimeCoreSuite(context = {}) {
  const registerParts = [
    require('./loop-runtime-core-suite/part-01.js'),
    require('./loop-runtime-core-suite/part-02.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
