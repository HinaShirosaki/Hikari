module.exports = function registerEdgeSequenceViewerFoundationsSuite(context = {}) {
  const registerParts = [
    require('./sequence-viewer-foundations-suite/part-01.js'),
    require('./sequence-viewer-foundations-suite/part-02.js'),
    require('./sequence-viewer-foundations-suite/part-03.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
