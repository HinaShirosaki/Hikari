module.exports = function registerAppLabAndProjectSuite(context = {}) {
  const registerParts = [
    require('./lab-and-project-suite/part-01.js'),
    require('./lab-and-project-suite/part-02.js'),
    require('./lab-and-project-suite/part-03.js'),
    require('./lab-and-project-suite/part-04.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
