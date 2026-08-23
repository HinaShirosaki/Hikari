module.exports = function registerEdgeSequenceViewerInteractionsSuite(context = {}) {
  const registerParts = [
    require('./sequence-viewer-interactions-suite/track-toggles-and-selection-menu.js'),
    require('./sequence-viewer-interactions-suite/feature-editing-and-primer-design.js'),
    require('./sequence-viewer-interactions-suite/keyboard-editing-and-cloning-notebook.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
