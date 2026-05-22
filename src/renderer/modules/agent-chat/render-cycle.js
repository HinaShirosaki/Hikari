export function renderAgentChat({
  api,
  state,
  dom,
  runtime,
  shell,
  sessionManager,
  developerToolUi,
  developerContextController,
  attachmentsController
}) {
  shell.ensureAgentState();
  shell.renderProjectOptions();
  shell.renderDeepResearchToggle();
  developerToolUi.renderDeveloperToolOptions();
  shell.renderContextSummary();
  sessionManager.renderSessionList();
  void sessionManager.refreshPersistentSessions();
  if (dom.developerTools) {
    dom.developerTools.hidden = !(state.settings?.agent?.developerMode === true && api?.agentDeveloperTestTools);
  }
  developerContextController.render();
  shell.syncComposerHeight();
  attachmentsController.render();
  shell.renderHistoryView();
  if (!runtime.inFlight) {
    shell.setStatus('Ready.');
  }
}
