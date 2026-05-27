module.exports = function registerAgentIntentAndNotebookSuite(context = {}) {
  const registerParts = [
    require('./intent-and-notebook-suite/part-01.js'),
    require('./intent-and-notebook-suite/part-02.js'),
    require('./intent-and-notebook-suite/part-03.js'),
    require('./intent-and-notebook-suite/part-04.js'),
    require('./intent-and-notebook-suite/part-05.js'),
    require('./intent-and-notebook-suite/part-06.js'),
    require('./intent-and-notebook-suite/part-07.js'),
    require('./intent-and-notebook-suite/part-08.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
