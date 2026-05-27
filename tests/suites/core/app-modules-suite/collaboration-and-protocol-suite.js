module.exports = function registerAppCollaborationAndProtocolSuite(context = {}) {
  const registerParts = [
    require('./collaboration-and-protocol-suite/part-01.js'),
    require('./collaboration-and-protocol-suite/part-02.js'),
    require('./collaboration-and-protocol-suite/part-03.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
