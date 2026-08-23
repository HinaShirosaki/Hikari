module.exports = function registerAppPapersSuite(context = {}) {
  const registerParts = [
    require('./papers-suite/paper-library-folders.js'),
    require('./papers-suite/pdf-viewer-highlights-and-search.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
