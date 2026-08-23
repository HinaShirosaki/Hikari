module.exports = function registerAgentContractsB(context = {}) {
  const registerParts = [
    require('./agent-contracts-b/agent-runtime-contracts.js'),
    require('./agent-contracts-b/legacy-orchestration-removal.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
