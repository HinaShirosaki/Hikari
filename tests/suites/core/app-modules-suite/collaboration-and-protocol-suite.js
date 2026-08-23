module.exports = function registerAppCollaborationAndProtocolSuite(context = {}) {
  const registerParts = [
    require('./collaboration-and-protocol-suite/protocol-draft-lifecycle.js'),
    require('./collaboration-and-protocol-suite/protocol-generation-and-import.js'),
    require('./collaboration-and-protocol-suite/protocol-editing-and-polish.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
