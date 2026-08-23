module.exports = function registerEdgeSequenceViewerWorkspaceSuite(context = {}) {
  const registerParts = [
    require('./sequence-viewer-workspace-suite/home-and-detail-navigation.js'),
    require('./sequence-viewer-workspace-suite/library-folders-and-import.js'),
    require('./sequence-viewer-workspace-suite/protein-builder-blocks.js'),
    require('./sequence-viewer-workspace-suite/protein-builder-assembly.js'),
    require('./sequence-viewer-workspace-suite/protein-builder-backbone-selection.js'),
    require('./sequence-viewer-workspace-suite/annotation-and-alignment-workspace.js'),
    require('./sequence-viewer-workspace-suite/sequencing-alignment-persistence.js'),
    require('./sequence-viewer-workspace-suite/vector-builder.js')
  ];

  registerParts.forEach((registerPart) => registerPart(context));
};
