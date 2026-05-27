module.exports = function registerEdgeToolBoxSuite(context = {}) {
  const registerParts = [
    require('./tool-box-suite/part-01.js'),
    require('./tool-box-suite/part-02.js'),
    require('./tool-box-suite/part-03.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
