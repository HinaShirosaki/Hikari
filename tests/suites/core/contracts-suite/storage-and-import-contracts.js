module.exports = function registerStorageAndImportContracts(context = {}) {
  const registerParts = [
    require('./storage-and-import-contracts/storage-bundle-hydration.js'),
    require('./storage-and-import-contracts/startup-hydration-and-refresh.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
