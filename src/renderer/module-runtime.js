import { initProtocolManagement } from './modules/protocol-management.js';
import { initLabNotebook as initBiologyNotebook } from './modules/biology-notebook.js';
import { initPersonalInventory } from './modules/personal-inventory.js';
import { initSettings } from './modules/settings.js';
import { initProjectManagement } from './modules/project-management.js';
import { initWorkflowManagement } from './modules/workflow-management.js';
import { initLabCommonInventory } from './modules/lab-common-inventory.js';
import { initSampleRegistry } from './modules/sample-registry.js';
import { initAssay } from './modules/assay.js';
import { initGelAnalysis } from './modules/gel-analysis.js';
import { initPapersManagement } from './modules/papers-management.js';
import { initToolBox } from './modules/tool-box.js';
import { initAgentChat } from './modules/agent-chat.js';
import { initHomeDashboard } from './modules/home-dashboard.js';
import { initSequenceViewer } from './modules/sequence-viewer.js';
import { createSelectionInsightsController } from './modules/selection-insights.js';

function renderBiologyNotebook(modules) {
  modules.biologyNotebook.renderProjectOptions();
  modules.biologyNotebook.renderProtocolOptions();
  modules.biologyNotebook.renderEntries();
}

function renderProtocolManagement(modules) {
  modules.protocol.renderShareTargets();
  modules.protocol.renderList();
}

function renderSampleRegistryWorkspace(modules) {
  modules.personalInventory.renderSections();
  modules.sampleRegistry.render();
}

function initAndRegisterModule(moduleRegistry, key, initializer, options) {
  const module = initializer(options);
  moduleRegistry.register(key, module);
  return module;
}

export function createRendererModuleRuntime(config = {}) {
  const state = config?.state || {};
  const persist = config?.persist || (() => {});
  const createId = config?.createId || (() => '');
  const safeText = config?.safeText || ((value) => String(value || ''));
  const cssEscape = config?.cssEscape || ((value) => String(value || ''));
  const rendererServices = config?.rendererServices || {};
  const moduleRegistry = config?.moduleRegistry;
  const trackGrowthEvent = config?.trackGrowthEvent || (() => {});
  const showView = config?.showView || (() => {});
  const views = config?.views || {};
  const sequenceViewerDetailViewId = String(config?.sequenceViewerDetailViewId || '').trim();
  const onStoragePathSaved = config?.onStoragePathSaved || (async () => {});
  const rootDocument = config?.rootDocument || globalThis?.document || null;
  const selectionInsightsController = createSelectionInsightsController({
    state,
    persist,
    createId,
    safeText,
    rootDocument,
    windowObject: globalThis?.window || null
  });

  const modules = {
    biologyNotebook: initAndRegisterModule(moduleRegistry, 'biologyNotebook', initBiologyNotebook, {
      state,
      persist,
      createId,
      safeText,
      notebookType: 'biology',
      importProtocolsFromJson: rendererServices.protocol.importProtocolsFromJson,
      onCreateLinkedAssay: rendererServices.analysis.openAssayForNotebook,
      onCreateLinkedGel: rendererServices.analysis.openGelForNotebook,
      onOpenSampleRecorder: (context = {}) => {
        showView(views.SAMPLE_REGISTRY);
        modules.sampleRegistry?.startNotebookSampleCapture?.(context);
      },
      onNotebookEntriesChanged: rendererServices.notebook.handleNotebookEntriesChanged,
      selectionInsightsController
    }),
    protocol: initAndRegisterModule(moduleRegistry, 'protocol', initProtocolManagement, {
      state,
      persist,
      createId,
      safeText,
      onProtocolsChanged: rendererServices.protocol.handleProtocolsChanged,
      trackGrowthEvent,
      selectionInsightsController
    }),
    projectManagement: initAndRegisterModule(moduleRegistry, 'projectManagement', initProjectManagement, {
      state,
      persist,
      createId,
      safeText,
      onProjectsChanged: rendererServices.project.handleProjectsChanged
    }),
    agentChat: initAndRegisterModule(moduleRegistry, 'agentChat', initAgentChat, {
      state,
      persist,
      createId,
      safeText,
      onNotebookEntriesChanged: rendererServices.notebook.handleAgentNotebookEntriesChanged,
      onOpenNotebookEntry: (entryId = '') => {
        showView(views.BIOLOGY_NOTEBOOK);
        modules.biologyNotebook?.openEntry?.(entryId);
      }
    }),
    workflowManagement: initAndRegisterModule(moduleRegistry, 'workflowManagement', initWorkflowManagement, {
      state,
      persist,
      createId,
      safeText,
      onWorkflowsChanged: () => {},
      onOpenNotebookEntry: (entryId = '') => {
        showView(views.BIOLOGY_NOTEBOOK);
        modules.biologyNotebook?.openEntry?.(entryId);
      },
      onCreateLinkedAssay: rendererServices.analysis.openAssayForNotebook,
      onCreateLinkedGel: rendererServices.analysis.openGelForNotebook
    }),
    papers: initAndRegisterModule(moduleRegistry, 'papers', initPapersManagement, {
      state,
      persist,
      createId,
      safeText,
      onCreateProtocolDraft: rendererServices.protocol.createDraftFromPaper
    }),
    labCommonInventory: initAndRegisterModule(moduleRegistry, 'labCommonInventory', initLabCommonInventory, {
      state,
      persist,
      createId,
      safeText
    }),
    personalInventory: initAndRegisterModule(moduleRegistry, 'personalInventory', initPersonalInventory, {
      state,
      persist,
      createId,
      safeText,
      cssEscape,
      onSamplesChanged: rendererServices.inventory.handleSamplesChanged
    }),
    sampleRegistry: initAndRegisterModule(moduleRegistry, 'sampleRegistry', initSampleRegistry, {
      state,
      persist,
      safeText,
      onNotebookSampleCaptured: rendererServices.notebook.handleNotebookEntriesChanged
    }),
    assay: initAndRegisterModule(moduleRegistry, 'assay', initAssay, {
      state,
      persist,
      createId,
      safeText,
      onAssaysChanged: rendererServices.analysis.handleAssaysChanged
    }),
    gel: initAndRegisterModule(moduleRegistry, 'gel', initGelAnalysis, {
      state,
      persist,
      createId,
      safeText,
      onGelAnalysesChanged: rendererServices.analysis.handleGelAnalysesChanged
    }),
    sequenceViewer: initAndRegisterModule(moduleRegistry, 'sequenceViewer', initSequenceViewer, {
      homeViewId: views.SEQUENCE_VIEWER,
      detailViewId: sequenceViewerDetailViewId,
      onNavigateHome: () => {
        showView(views.SEQUENCE_VIEWER);
      },
      onNavigateDetail: () => {
        showView(sequenceViewerDetailViewId);
      },
      state,
      persist,
      createId,
      onNotebookEntriesChanged: () => {
        rendererServices.project.handleProjectsChanged();
        rendererServices.protocol.handleProtocolsChanged();
        rendererServices.notebook.handleNotebookEntriesChanged();
      }
    }),
    toolBox: initAndRegisterModule(moduleRegistry, 'toolBox', initToolBox, {
      onOpenSequenceViewer: rendererServices.sequence.openFromToolBox
    }),
    settings: initAndRegisterModule(moduleRegistry, 'settings', initSettings, {
      state,
      persist,
      onStoragePathSaved
    }),
    homeDashboard: initAndRegisterModule(moduleRegistry, 'homeDashboard', initHomeDashboard, {
      state,
      persist,
      createId,
      safeText,
      onOpenSampleSearch: rendererServices.inventory.openSampleSearch,
      onOpenSamples: () => rendererServices.inventory.openSampleSearch(''),
      onOpenNotebook: () => showView(views.BIOLOGY_NOTEBOOK),
      onOpenWorkflow: () => showView(views.WORKFLOW_MANAGEMENT),
      onOpenAssistant: () => showView(views.AGENT),
      onSendQuickLogToAgent: (message) => {
        const draft = String(message || '').trim();
        if (!draft) {
          return false;
        }
        showView(views.AGENT);
        const agentInput = rootDocument?.getElementById?.('agent-message-input');
        const sendButton = rootDocument?.getElementById?.('agent-send-btn');
        if (!(agentInput instanceof HTMLTextAreaElement) || !(sendButton instanceof HTMLButtonElement)) {
          return false;
        }
        agentInput.value = draft;
        sendButton.click();
        return true;
      }
    })
  };

  const renderByViewId = new Map([
    [views.HOME, () => modules.homeDashboard?.render()],
    [views.BIOLOGY_NOTEBOOK, () => renderBiologyNotebook(modules)],
    [views.PROTOCOL_MANAGEMENT, () => renderProtocolManagement(modules)],
    [views.SAMPLE_REGISTRY, () => renderSampleRegistryWorkspace(modules)],
    [views.ASSAY, () => modules.assay.render()],
    [views.GEL, () => modules.gel.render()],
    [views.LAB_COMMON_INVENTORY, () => modules.labCommonInventory.renderAll()],
    [views.PROJECT_MANAGEMENT, () => modules.projectManagement.render()],
    [views.WORKFLOW_MANAGEMENT, () => modules.workflowManagement.render()],
    [views.PAPERS, () => modules.papers.render()],
    [views.AGENT, () => modules.agentChat.render()]
  ]);

  function renderView(viewId) {
    if (viewId === views.SEQUENCE_VIEWER || viewId === sequenceViewerDetailViewId) {
      modules.sequenceViewer?.render?.({ activeViewId: viewId });
      return;
    }
    renderByViewId.get(viewId)?.();
  }

  function renderAll() {
    renderProtocolManagement(modules);
    modules.projectManagement.render();
    modules.workflowManagement.render();
    modules.labCommonInventory.renderAll();
    renderBiologyNotebook(modules);
    renderSampleRegistryWorkspace(modules);
    modules.assay.render();
    modules.gel.render();
    modules.settings.renderForms();
    modules.settings.applyAppearance();
    modules.homeDashboard?.render();
    modules.papers.render();
    modules.agentChat.render();
  }

  return {
    modules,
    renderAll,
    renderView
  };
}
