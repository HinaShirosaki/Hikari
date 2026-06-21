export function renderAgentChat({
  api,
  state,
  dom,
  runtime,
  shell,
  sessionManager,
  developerToolUi,
  developerContextController,
  attachmentsController,
  loadPersistentSessions = true
}) {
  shell.ensureAgentState();
  shell.renderProjectOptions();
  developerToolUi.renderDeveloperToolOptions();
  shell.renderContextSummary();
  sessionManager.renderSessionList();
  if (loadPersistentSessions) {
    void sessionManager.refreshPersistentSessions();
  }
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
