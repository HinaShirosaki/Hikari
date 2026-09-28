import {
  ensureDashboardState,
  ensureSamplesState,
  migrateLegacyPassageSamples
} from './utils.js';
import { initContributionWidget } from './contribution.js';
import { initIncubationWidget } from './incubation.js';
import { initNotebookWidget } from './notebook.js';
import { initPaperFindingWidget } from './paper-finding.js';
import { initPassageWidget } from './passage.js';
import { initQuickLogWidget } from './quick-log.js';
import { initTimerWidget } from './timer.js';

// Home dashboard controller.
//
// Acts as a thin orchestrator: looks up the dashboard DOM elements,
// short-circuits if any are missing, hands typed element bundles to each
// independent widget, and exposes a master render() that dispatches to
// every widget. Widget logic itself lives under ./home-dashboard/.
export function initHomeDashboard({
  state,
  persist,
  createId = () => '',
  safeText,
  onOpenNotebook = () => {},
  onOpenPaper = null,
  onSendQuickLogToAgent = async () => ({ ok: false, reason: 'unavailable' }),
  api = null
}) {
  const passageElements = {
    summary: document.getElementById('dashboard-passage-summary'),
    list: document.getElementById('dashboard-passage-list'),
    panelList: document.getElementById('dashboard-passage-panel-list'),
    addBtn: document.getElementById('dashboard-passage-add-btn'),
    closeBtn: document.getElementById('dashboard-passage-dialog-close-btn'),
    dialogOverlay: document.getElementById('dashboard-passage-dialog-overlay'),
    dialogForm: document.getElementById('dashboard-passage-dialog-form'),
    strainInput: document.getElementById('dashboard-passage-strain-input'),
    intervalInput: document.getElementById('dashboard-passage-interval-input'),
    numberInput: document.getElementById('dashboard-passage-number-input')
  };

  const contributionElements = {
    monthLabels: document.getElementById('dashboard-contribution-months'),
    grid: document.getElementById('dashboard-contribution-grid'),
    summary: document.getElementById('dashboard-contribution-summary'),
    selected: document.getElementById('dashboard-contribution-selected')
  };

  const paperFindingElements = {
    summary: document.getElementById('dashboard-paper-finding-summary'),
    list: document.getElementById('dashboard-paper-finding-list'),
    openBtn: document.getElementById('dashboard-paper-finding-open-btn'),
    runBtn: document.getElementById('dashboard-paper-finding-run-btn'),
    nextRun: document.getElementById('dashboard-paper-finding-next-run')
  };

  const notebookOpenBtn = document.getElementById('dashboard-notebook-open-btn');
  if (notebookOpenBtn) {
    notebookOpenBtn.addEventListener('click', () => onOpenNotebook());
  }

  const incubationElements = {
    summary: document.getElementById('dashboard-incubation-summary'),
    list: document.getElementById('dashboard-incubation-list'),
    panelList: document.getElementById('dashboard-incubation-panel-list'),
    addBtn: document.getElementById('dashboard-incubation-add-btn'),
    closeBtn: document.getElementById('dashboard-incubation-dialog-close-btn'),
    dialogOverlay: document.getElementById('dashboard-incubation-dialog-overlay'),
    locationList: document.getElementById('dashboard-incubation-location-list'),
    locationForm: document.getElementById('dashboard-incubation-location-form'),
    locationInput: document.getElementById('dashboard-incubation-location-input')
  };

  const quickLogElements = {
    quickLogInput: document.getElementById('dashboard-quick-log-input'),
    quickLogStatus: document.getElementById('dashboard-quick-log-status'),
    quickLogSaveBtn: document.getElementById('dashboard-quick-log-save-btn'),
    quickLogAgentBtn: document.getElementById('dashboard-quick-log-agent-btn'),
    quickLogRecent: document.getElementById('dashboard-quick-log-recent')
  };

  const notebookElements = {
    pagesStatus: document.getElementById('dashboard-notebook-pages-status'),
    pageList: document.getElementById('dashboard-notebook-page-list')
  };

  const timerElements = {
    timerStatus: document.getElementById('dashboard-timer-status'),
    timerActiveList: document.getElementById('dashboard-timer-active-list'),
    timerPresetList: document.getElementById('dashboard-timer-preset-list'),
    timerOpenBtn: document.getElementById('dashboard-timer-open-btn'),
    timerDialogOverlay: document.getElementById('dashboard-timer-dialog-overlay'),
    timerDialogCloseBtn: document.getElementById('dashboard-timer-dialog-close-btn'),
    timerDialogForm: document.getElementById('dashboard-timer-dialog-form'),
    timerNameInput: document.getElementById('dashboard-timer-name-input'),
    timerMinutesInput: document.getElementById('dashboard-timer-minutes-input'),
    timerTemplateList: document.getElementById('dashboard-timer-template-list')
  };
  const topbarTimerElements = {
    topbarLocalTime: document.getElementById('topbar-local-time'),
    topbarTimer: document.getElementById('topbar-active-timer'),
    topbarTimerTime: document.getElementById('topbar-timer-time'),
    topbarTimerProgress: document.getElementById('topbar-timer-progress')
  };

  const requiredElements = [
    ...Object.values(passageElements),
    ...Object.values(contributionElements),
    ...Object.values(incubationElements),
    ...Object.values(quickLogElements),
    ...Object.values(notebookElements),
    ...Object.values(timerElements)
  ];

  if (requiredElements.some((element) => !element)) {
    return {
      render: () => {}
    };
  }

  function masterRender() {
    let changed = ensureDashboardState(state);
    changed = ensureSamplesState(state) || changed;
    changed = migrateLegacyPassageSamples(state) || changed;
    if (changed) {
      persist();
    }
    Object.values(widgets).forEach((widget) => widget.render());
  }

  // Escape priority must match the original: passage > timer > notebook > incubation.
  const escapeOrder = ['passage', 'timer', 'notebook', 'incubation'];

  const widgets = {
    contribution: initContributionWidget({
      state,
      safeText,
      elements: contributionElements
    }),
    paperFinding: initPaperFindingWidget({
      api,
      safeText,
      onOpenNotebook,
      onOpenPaper,
      elements: paperFindingElements
    }),
    passage: initPassageWidget({
      state,
      persist,
      safeText,
      createId,
      render: masterRender,
      elements: passageElements
    }),
    incubation: initIncubationWidget({
      state,
      persist,
      safeText,
      render: masterRender,
      elements: incubationElements
    }),
    notebook: initNotebookWidget({
      state,
      persist,
      safeText,
      render: masterRender,
      elements: notebookElements
    }),
    timer: initTimerWidget({
      state,
      persist,
      safeText,
      render: masterRender,
      elements: { ...timerElements, ...topbarTimerElements }
    }),
    quickLog: initQuickLogWidget({
      state,
      persist,
      createId,
      safeText,
      render: masterRender,
      onSendQuickLogToAgent,
      elements: quickLogElements
    })
  };

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    for (const key of escapeOrder) {
      if (widgets[key].handleEscape()) {
        event.preventDefault();
        return;
      }
    }
  });

  return {
    render: masterRender
  };
}
