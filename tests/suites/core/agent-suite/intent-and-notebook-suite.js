module.exports = function registerAgentIntentAndNotebookSuite(context = {}) {
  const registerParts = [
    require('./intent-and-notebook-suite/controller-skill-dispatch.js'),
    require('./intent-and-notebook-suite/controller-codex-routing.js'),
    require('./intent-and-notebook-suite/protocol-matching.js'),
    require('./intent-and-notebook-suite/notebook-placeholder-resolution.js'),
    require('./intent-and-notebook-suite/notebook-draft-runtime.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
