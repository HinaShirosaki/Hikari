import { initProtocolManagement } from './modules/protocol-management.js';
import { initLabNotebook as initBiologyNotebook } from './modules/biology-notebook/index.js';
import { initPersonalInventory } from './modules/personal-inventory/index.js';
import { initSettings } from './modules/settings/index.js';
import { initProjectManagement } from './modules/project-management/index.js';
import { initWorkflowManagement } from './modules/workflow/index.js';
import { initLabCommonInventory } from './modules/lab-common-inventory/index.js';
import { initSampleRegistry } from './modules/sample-registry/index.js';
import { initAssay } from './modules/assay/index.js';
import { initGelAnalysis } from './modules/gel-analysis.js';
import { initPapersManagement } from './modules/papers-management.js';
import { initToolBox } from './modules/tool-box.js';
import { initAgentChat } from './modules/agent-chat.js';
import { createPaperScopedAgentChatState } from './modules/agent-chat/scoped-state.js';
import { initHomeDashboard } from './modules/home-dashboard.js';
import { initSequenceViewer } from './modules/sequence-viewer.js';
import { createSelectionInsightsController } from './modules/selection-insights/index.js';

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
  const apiBridge = config?.apiBridge || globalThis?.window?.enanaApi || globalThis?.enanaApi || null;
  const getApiBridge = typeof config?.getApiBridge === 'function'
    ? config.getApiBridge
    : () => apiBridge || globalThis?.window?.enanaApi || globalThis?.enanaApi || null;
  const selectionInsightsController = createSelectionInsightsController({
    state,
    persist,
    createId,
    safeText,
    rootDocument,
    windowObject: globalThis?.window || null
  });
  let modules = null;

  function getActivePaperAgentChatContext() {
    const paperId = String(modules?.papers?.getActivePaperId?.() || '').trim();
    const paper = paperId
      ? (state.papers || []).find((item) => String(item?.id || '').trim() === paperId)
      : null;
    const projectId = paper?.linkedType === 'project'
      ? String(paper?.linkedId || '').trim()
      : '';
    return {
      paperId,
      paperTitle: String(paper?.title || paper?.fileName || '').trim(),
      projectId,
      knowledgeMarkdownRelativePath: String(paper?.knowledgeMarkdownRelativePath || paper?.knowledge_markdown_relative_path || '').trim(),
      knowledgeExtractedTextRelativePath: String(paper?.knowledgeExtractedTextRelativePath || paper?.knowledge_extracted_text_relative_path || '').trim(),
      knowledgeMetaRelativePath: String(paper?.knowledgeMetaRelativePath || paper?.knowledge_meta_relative_path || '').trim(),
      knowledgeStatus: String(paper?.knowledgeStatus || paper?.knowledge_status || '').trim()
    };
  }

  const paperAgentChatState = createPaperScopedAgentChatState(state, {
    getPaperContext: getActivePaperAgentChatContext
  });

  function openPaperAgentChatWithSelection(selection = {}) {
    const selectedText = String(selection?.text || '').replace(/\s+/g, ' ').trim();
    if (!selectedText) {
      return false;
    }
    const paperTitle = String(selection?.paperTitle || '').trim();
    modules?.agentChatRail?.primeHiddenContext?.({
      kind: 'paper-selection',
      label: 'Selected paper text',
      text: selectedText,
      paperId: String(selection?.paperId || '').trim(),
      paperTitle,
      pageNumber: Number.isFinite(Number(selection?.pageNumber))
        ? Math.max(1, Math.round(Number(selection.pageNumber)))
        : 0
    });
    const EventCtor = rootDocument?.defaultView?.CustomEvent || globalThis?.CustomEvent;
    if (rootDocument && typeof EventCtor === 'function') {
      rootDocument.dispatchEvent(new EventCtor('enana:open-agent-chat-rail'));
    }
    modules?.agentChatRail?.focusComposer?.();
    return true;
  }

  modules = {
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
      onProtocolsChanged: () => {
        rendererServices.protocol.handleProtocolsChanged();
        modules.protocol?.renderList?.();
      },
      onOpenNotebookEntry: (entryId = '') => {
        showView(views.BIOLOGY_NOTEBOOK);
        modules.biologyNotebook?.openEntry?.(entryId);
      }
    }),
    agentChatRail: initAndRegisterModule(moduleRegistry, 'agentChatRail', initAgentChat, {
      idPrefix: 'agent-rail',
      loadPersistentSessions: false,
      state: paperAgentChatState,
      persist,
      createId,
      safeText,
      onNotebookEntriesChanged: rendererServices.notebook.handleAgentNotebookEntriesChanged,
      onProtocolsChanged: () => {
        rendererServices.protocol.handleProtocolsChanged();
        modules.protocol?.renderList?.();
      },
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
      onCreateProtocolDraft: rendererServices.protocol.createDraftFromPaper,
      onActivePaperChanged: () => {
        modules?.agentChatRail?.render?.();
      },
      onAskSelectedText: openPaperAgentChatWithSelection
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
      apiBridge,
      getApiBridge,
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
    renderAgentChatRail: () => modules.agentChatRail.render(),
    renderView
  };
}
