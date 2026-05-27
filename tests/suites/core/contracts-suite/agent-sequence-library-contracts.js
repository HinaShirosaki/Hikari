module.exports = function registerAgentSequenceLibraryContracts(context = {}) {
  const registerParts = [
    require('./agent-sequence-library-contracts/part-01.js'),
    require('./agent-sequence-library-contracts/part-02.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
