module.exports = function registerAgentSequenceLibraryContracts(context = {}) {
  const registerParts = [
    require('./agent-sequence-library-contracts/sequence-library-storage.js'),
    require('./agent-sequence-library-contracts/backbone-recognition.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
