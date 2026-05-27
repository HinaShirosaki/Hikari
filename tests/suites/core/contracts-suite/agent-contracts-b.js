module.exports = function registerAgentContractsB(context = {}) {
  const registerParts = [
    require('./agent-contracts-b/part-01.js'),
    require('./agent-contracts-b/part-02.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
