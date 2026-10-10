import { getSectionDisplay } from './constants.js';
import { createContainerStateHelpers } from './state-containers.js';
import { createSampleStateHelpers } from './state-samples.js';
import { createSampleRenderingStateHelpers } from './state-sample-rendering.js';

export function createPersonalInventoryStateHelpers({ state, safeText, uiState }) {
  const containerHelpers = createContainerStateHelpers({ state, uiState });
  const sampleHelpers = createSampleStateHelpers({ state, safeText });
  const sampleRenderingHelpers = createSampleRenderingStateHelpers({
    state,
    safeText,
    sampleHelpers
  });

  return {
    getContainer: containerHelpers.getContainer,
    getFolders: containerHelpers.getFolders,
    getFolder: containerHelpers.getFolder,
    getFolderChildren: containerHelpers.getFolderChildren,
    getRootFolders: containerHelpers.getRootFolders,
    getContainersInFolder: containerHelpers.getContainersInFolder,
    getFolderAncestorIds: containerHelpers.getFolderAncestorIds,
    getLinkedSamples: containerHelpers.getLinkedSamples,
    getContainerSampleCount: containerHelpers.getContainerSampleCount,
    getSectionContainerCount: containerHelpers.getSectionContainerCount,
    getSectionFolderCount: containerHelpers.getSectionFolderCount,
    getSectionSampleCount: containerHelpers.getSectionSampleCount,
    getPreferredSection: containerHelpers.getPreferredSection,
    getWellLabel: containerHelpers.getWellLabel,
    ensureSamples: sampleHelpers.ensureSamples,
    makeDefaultSampleCode: sampleHelpers.makeDefaultSampleCode,
    normalizeSampleCode: sampleHelpers.normalizeSampleCode,
    getSampleById: sampleHelpers.getSampleById,
    isLocationEmpty: sampleHelpers.isLocationEmpty,
    buildAutoLocationFromLink: sampleHelpers.buildAutoLocationFromLink,
    normalizeSampleType: sampleHelpers.normalizeSampleType,
    getSampleTypeColor: sampleHelpers.getSampleTypeColor,
    getSampleTypeLabel: sampleHelpers.getSampleTypeLabel,
    renderSampleTypeOptions: sampleHelpers.renderSampleTypeOptions,
    getInventorySummaryCounts: sampleHelpers.getInventorySummaryCounts,
    buildSampleDotFill: sampleRenderingHelpers.buildSampleDotFill,
    renderSampleLegendForContainer: sampleRenderingHelpers.renderSampleLegendForContainer,
    getWellDataForType: sampleRenderingHelpers.getWellDataForType,
    getSectionNames: containerHelpers.getSectionNames,
    getSectionDisplay
  };
}
