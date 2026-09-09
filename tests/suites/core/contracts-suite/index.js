module.exports = function registerContractsSuite(context = {}) {
  const registerShellAndPackagingContracts = require('./shell-and-packaging-contracts.js');
  const registerStorageAndImportContracts = require('./storage-and-import-contracts.js');
  const registerAgentContractsA = require('./agent-contracts-a.js');
  const registerAgentContractsB = require('./agent-contracts-b.js');
  const registerAgentSequenceLibraryContracts = require('./agent-sequence-library-contracts.js');
  const registerManifestContracts = require('./manifest-contracts.js');

  registerShellAndPackagingContracts(context);
  registerStorageAndImportContracts(context);
  registerAgentContractsA(context);
  registerAgentContractsB(context);
  registerAgentSequenceLibraryContracts(context);
  registerManifestContracts(context);
  require('./sequence-mcp-contracts.js')(context);
};
