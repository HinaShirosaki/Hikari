module.exports = function registerContractsSuite(context = {}) {
  const registerUiAndLayoutContracts = require('./ui-and-layout-contracts.js');
  const registerStorageAndImportContracts = require('./storage-and-import-contracts.js');
  const registerAgentContractsA = require('./agent-contracts-a.js');
  const registerAgentContractsB = require('./agent-contracts-b.js');
  const registerAgentSequenceLibraryContracts = require('./agent-sequence-library-contracts.js');
  const registerTelegramAndManifestContracts = require('./telegram-and-manifest-contracts.js');

  registerUiAndLayoutContracts(context);
  registerStorageAndImportContracts(context);
  registerAgentContractsA(context);
  registerAgentContractsB(context);
  registerAgentSequenceLibraryContracts(context);
  registerTelegramAndManifestContracts(context);
};
