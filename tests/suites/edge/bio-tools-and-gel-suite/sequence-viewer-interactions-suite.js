module.exports = function registerEdgeSequenceViewerInteractionsSuite(context = {}) {
  const registerParts = [
    require('./sequence-viewer-interactions-suite/part-01.js'),
    require('./sequence-viewer-interactions-suite/part-02.js'),
    require('./sequence-viewer-interactions-suite/part-03.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
