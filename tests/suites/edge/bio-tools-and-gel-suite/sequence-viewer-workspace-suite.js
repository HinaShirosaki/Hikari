module.exports = function registerEdgeSequenceViewerWorkspaceSuite(context = {}) {
  const registerParts = [
    require('./sequence-viewer-workspace-suite/part-01.js'),
    require('./sequence-viewer-workspace-suite/part-02.js'),
    require('./sequence-viewer-workspace-suite/part-03.js'),
    require('./sequence-viewer-workspace-suite/part-04.js'),
    require('./sequence-viewer-workspace-suite/part-05.js'),
    require('./sequence-viewer-workspace-suite/part-06.js'),
    require('./sequence-viewer-workspace-suite/part-07.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
