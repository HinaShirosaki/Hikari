module.exports = function registerStorageAndImportContracts(context = {}) {
  const registerParts = [
    require('./storage-and-import-contracts/part-01.js'),
    require('./storage-and-import-contracts/part-02.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
