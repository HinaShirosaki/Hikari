module.exports = function registerEdgeSequenceViewerFoundationsSuite(context = {}) {
  const registerParts = [
    require('./sequence-viewer-foundations-suite/sequence-parsing-and-alignment.js'),
    require('./sequence-viewer-foundations-suite/feature-building-and-rendering.js'),
    require('./sequence-viewer-foundations-suite/feature-details-and-sequence-maps.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
