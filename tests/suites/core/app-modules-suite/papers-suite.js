module.exports = function registerAppPapersSuite(context = {}) {
  const registerParts = [
    require('./papers-suite/part-01.js'),
    require('./papers-suite/part-02.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
