module.exports = function registerAppLabAndProjectSuite(context = {}) {
  const registerParts = [
    require('./lab-and-project-suite/dashboard-and-inventory-samples.js'),
    require('./lab-and-project-suite/notebook-projects.js'),
    require('./lab-and-project-suite/notebook-page-editing.js'),
    require('./lab-and-project-suite/notebook-experiments-and-pdf-export.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
