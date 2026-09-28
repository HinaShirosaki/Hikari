import { initToolBoxViewManager } from './view-manager.js';
import { initMolarityTool } from './molarity-ui.js';
import { initPeptideTool } from './peptide-tool.js';
import { initTranslationTool } from './translation-tool.js';
import { initOligoTool } from './oligo-tool.js';
import { initExtinctionTool } from './extinction-tool.js';
import { initBufferTool } from './buffer-ui.js';
import { initFixedReactionTool } from './fixed-reaction-ui.js';

export function initToolBox(options = {}) {
  const rootDocument = options?.document || globalThis?.document || null;

  const viewManager = initToolBoxViewManager({
    document: rootDocument,
    defaultViewId: 'tool-molarity-view'
  });

  const sharedOptions = {
    document: rootDocument,
    safeText: options?.safeText,
    getStoredCompounds: options?.getStoredCompounds
  };

  initMolarityTool(sharedOptions);
  initPeptideTool(sharedOptions);
  initTranslationTool(sharedOptions);
  initOligoTool(sharedOptions);
  initExtinctionTool(sharedOptions);
  initBufferTool(sharedOptions);
  initFixedReactionTool(sharedOptions);

  return viewManager;
}
